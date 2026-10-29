import "./analysis-probe-i18n";
import { createApp, h, nextTick, ref } from "vue";
import ShortBookAnalysisPage from "../../src/renderer/src/extras/short-book-analysis/ShortBookAnalysisPage.vue";
import { useShortBookAnalysis } from "../../src/renderer/src/extras/short-book-analysis/useShortBookAnalysis";
import { verifyShortSourceErrors } from "./short-book-analysis-source-errors-probe";
import {
  probeCatalog,
  savedProbeEntries,
  verifyHeaderModelSettings,
  verifyEmptyResultDestination,
  verifyManualResultSave
} from "./short-book-analysis-options-probe";
import {
  applyAppearanceThemeToDocument,
  defaultAppearanceTheme
} from "../../src/renderer/src/composables/appearanceThemeRuntime";
import {
  ShortBookAnalysisPresetSchema,
  type DeepWriteApi,
  type ExtrasAgentRunRequest,
  type ModelConfig,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import "../../src/renderer/src/styles.css";
// Exercise the feature at the width available inside the workspace shell.
document.body.style.minWidth = "0";
document.body.style.margin = "0";
const presets = [
  ShortBookAnalysisPresetSchema.parse({
    id: "plot",
    name: "剧情结构",
    description: "联合拆解冲突、反转与结尾，比较多篇的异同。",
    systemPrompt: "分析短篇结构",
    selectionMode: "multiple",
    output: { domain: "material", kind: "plot", stageId: "pacing" }
  }),
  ShortBookAnalysisPresetSchema.parse({
    id: "single",
    name: "人物",
    description: "提炼人物目标与选择。",
    systemPrompt: "分析人物",
    selectionMode: "single",
    output: { domain: "material", kind: "character", stageId: "character" }
  }),
  ShortBookAnalysisPresetSchema.parse({
    id: "style",
    name: "文风",
    description: "提炼适用于短篇写作的行文规则与检查清单。",
    systemPrompt: "分析文风",
    selectionMode: "single",
    output: { domain: "skill", kind: "style", stageId: "expert_section_writer" }
  })
];
const probeResult = {
  name: "综合分析",
  description: "用于提炼写作方法。",
  content: "# 核心发现\n\n两篇都通过迟到的消息引出人物选择，结尾呈现不同代价。"
};
const models = [
  {
    id: "model",
    label: "验证模型",
    provider: "test",
    modelId: "test",
    api: "openai-completions",
    baseUrl: "https://example.test",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["off"],
    contextWindow: 100000,
    maxTokens: 16000
  }
] as ModelConfig[];
models.push({
  ...models[0]!,
  id: "reasoning-model",
  label: "验证推理模型",
  reasoning: true,
  defaultThinkingLevel: "low",
  thinkingLevelOptions: ["low", "high"]
});
const sources = Array.from({ length: 11 }, (_, i) => ({
  id: `book-${i}`,
  title: `${i + 1} · 雨夜来信与归途`,
  text: "第一章 来信\n雨夜里，她收到一封迟到的来信。\n第二章 归来\n她决定回到故乡，面对那个未曾兑现的承诺。",
  kind: "paste" as const,
  importedAt: "2026-01-01T00:00:00.000Z"
}));
let request: ExtrasAgentRunRequest | undefined;
const requests: ExtrasAgentRunRequest[] = [];
const presetSettings = {
  agentId: "short-book-analysis",
  profiles: presets
};
const api = {
  catalog: {
    createLibraryEntry: async (input: unknown) => {
      savedProbeEntries.push(input);
      return {};
    }
  },
  extrasAgents: {
    run: async (input: ExtrasAgentRunRequest) => {
      request = input;
      requests.push(input);
      return {
        sessionId: input.sessionId,
        runId: "probe-run",
        acceptedAt: new Date().toISOString(),
        runtime: { provider: "test", model: "test", mode: "provider" }
      };
    },
    profiles: {
      list: async () => presetSettings,
      save: async () => presetSettings,
      reset: async () => presetSettings
    }
  },
  shortBookAnalysis: {
    sources: {
      list: async () => ({
        sources: sources.map(({ text, ...s }) => ({
          ...s,
          characterCount: text.length
        }))
      }),
      load: async (id: string) => sources.find((s) => s.id === id),
      delete: async (id: string) => id
    },
    addText: async (input: { title: string; text: string }) => ({
      ...sources[0],
      ...input,
      id: "pasted"
    }),
    chooseSources: async () => [sources[0]]
  },
  session: { abort: async () => ({}) }
} as unknown as DeepWriteApi;
const c = useShortBookAnalysis({ api: () => api });
c.setConfiguredModels(models);
c.drafts.value = sources;
c.activeId.value = "book-0";
const visible = ref(true);
createApp({
  render: () =>
    visible.value
      ? h(ShortBookAnalysisPage, {
          controller: c,
          models,
          catalogSnapshot: probeCatalog
        })
      : h("p", "其他页面")
}).mount("#app");
const frame = async () => {
  await nextTick();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
};
function check(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
function button(text: string) {
  const el = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).find((b) => b.textContent?.trim() === text);
  if (!el) throw new Error(`Missing button ${text}`);
  return el;
}
function emit(
  type: string,
  payload: Record<string, unknown> = {},
  target = request
) {
  check(target, "Expected a model request");
  c.handleEvent({
    type,
    payload: { sessionId: target!.sessionId, runId: "probe-run", ...payload }
  } as SystemEventEnvelope);
}
async function until(predicate: () => boolean, message: string) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await frame();
}
function presetOption(name: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".popup-select-option")
  ).find(
    (el) =>
      el
        .querySelector(".popup-select-option-copy > span")
        ?.textContent?.trim() === name
  );
}
async function togglePresetMenu() {
  document
    .querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="拆书预设"]'
    )!
    .click();
  await frame();
}
async function verifyParallelPresets() {
  c.selectedIds.value = [];
  c.toggleBook("book-0");
  await togglePresetMenu();
  presetOption("人物")!.click();
  await frame();
  presetOption("文风")!.click();
  await frame();
  await togglePresetMenu();
  check(
    document.querySelectorAll(".preset-task-row").length === 3 &&
      document
        .querySelector(".short-selection-summary")
        ?.textContent?.includes("已选预设含单本预设"),
    "Three presets are listed and limit the scope to one story"
  );
  const nativeConfirm = window.confirm;
  let asked = 0;
  window.confirm = () => {
    asked += 1;
    return true;
  };
  try {
    const before = requests.length;
    button("重新分析 · 3 项").click();
    await until(() => requests.length === before + 3, "Three runs start");
    check(asked === 1, "Replacing an unsaved result asks first");
    check(
      document
        .querySelector(".analysis-status-trigger")
        ?.textContent?.includes("3 个运行"),
      "Batch status shows the running count"
    );
    for (const [index, target] of requests.slice(before).entries()) {
      emit(
        "extras_agent.output_updated",
        {
          agentId: "short-book-analysis",
          jobId: target.task.input.jobId,
          output: {
            kind: "book-analysis-result",
            result: { ...probeResult, name: `并行结果 ${index + 1}` }
          }
        },
        target
      );
      emit("agent.message_completed", {}, target);
    }
    await until(() => c.status.value === "completed", "All presets complete");
    check(
      document.querySelectorAll(".analysis-result-tab").length === 3,
      "Each preset has a result tab"
    );
  } finally {
    window.confirm = nativeConfirm;
  }
}
async function run() {
  await frame();
  await verifyHeaderModelSettings(frame);
  await verifyShortSourceErrors(api, frame);
  c.drafts.value = [];
  await frame();
  check(
    document.querySelector(".analysis-empty-source"),
    "Empty state matches analysis layout"
  );
  button("导入文本").click();
  await frame();
  check(c.drafts.value.length === 1, "Header imports complete text");
  button("粘贴文本").click();
  await frame();
  const pasteDialog = document.querySelector<HTMLElement>(
    ".short-paste-dialog"
  )!;
  const titleInput = pasteDialog.querySelector<HTMLInputElement>("input")!;
  const textInput = pasteDialog.querySelector<HTMLTextAreaElement>("textarea")!;
  titleInput.value = "虚构短篇";
  textInput.value = "第一章\n一封虚构来信。\n第二章\n一个新的选择。";
  titleInput.dispatchEvent(new Event("input", { bubbles: true }));
  textInput.dispatchEvent(new Event("input", { bubbles: true }));
  button("添加短篇").click();
  await frame();
  check(
    c.drafts.value.some(
      (book) => book.id === "pasted" && book.text === textInput.value
    ),
    "Header paste retains full text"
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="已保存短篇"]')!
    .click();
  await frame();
  const option = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="option"]')
  ).find((el) => el.textContent?.includes(sources[2]!.title))!;
  option.click();
  await frame();
  check(
    c.drafts.value.some((book) => book.id === "book-2") &&
      c.activeId.value === "book-2",
    "Saved source loads directly from header"
  );
  const nativeConfirm = window.confirm;
  try {
    window.confirm = () => {
      throw new Error("Removal must not ask for confirmation");
    };
    c.toggleBook("book-2");
    document
      .querySelector<HTMLButtonElement>(
        `[aria-label="去除 ${sources[2]!.title}"]`
      )!
      .click();
    await frame();
    check(
      !c.drafts.value.some((book) => book.id === "book-2") &&
        !c.selectedIds.value.includes("book-2"),
      "Removal clears current draft and selection"
    );
    check(
      c.savedSources.value.some((book) => book.id === "book-2"),
      "Removal retains saved source"
    );
    const openHistory = async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="已保存短篇"]')!
        .click();
      await frame();
    };
    await openHistory();
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((el) => el.textContent?.includes(sources[2]!.title))!
      .click();
    await frame();
    check(
      c.drafts.value.some((book) => book.id === "book-2"),
      "Removed source can be selected again immediately"
    );
    window.confirm = () => false;
    const deleteButton = () =>
      document.querySelector<HTMLButtonElement>(
        `[aria-label="彻底删除 ${sources[2]!.title}"]`
      )!;
    await openHistory();
    deleteButton().click();
    await frame();
    check(
      c.drafts.value.some((book) => book.id === "book-2"),
      "Cancel retains source"
    );
    window.confirm = () => true;
    await openHistory();
    deleteButton().click();
    await frame();
    check(
      !c.drafts.value.some((book) => book.id === "book-2"),
      "Delete removes source from current list"
    );
    check(
      !c.savedSources.value.some((book) => book.id === "book-2"),
      "Delete removes saved source option"
    );
    check(
      c.activeId.value === "pasted",
      "Delete switches editor to remaining source"
    );
    check(
      document
        .querySelector('[aria-label="已保存短篇"]')
        ?.textContent?.includes("选择已导入短篇"),
      "History selection clears after deletion"
    );
  } finally {
    window.confirm = nativeConfirm;
  }
  c.drafts.value = [...sources];
  c.activeId.value = "book-0";
  c.selectedIds.value = [];
  for (let i = 0; i < 10; i++) c.toggleBook(`book-${i}`);
  await frame();
  check(
    document.querySelector<HTMLInputElement>(
      '[aria-label="选择 11 · 雨夜来信与归途"]'
    )?.disabled,
    "Eleventh book is disabled"
  );
  check(
    c.presetBlock(presets[1]!) === "single",
    "Single-story presets are blocked while ten stories are selected"
  );
  await togglePresetMenu();
  const blocked = presetOption("人物");
  check(
    blocked?.disabled && blocked.textContent?.includes("当前已选 10 本"),
    "The menu explains why a single-story preset is unavailable"
  );
  await togglePresetMenu();
  c.selectedIds.value = ["book-0"];
  c.selectPresets(["single"]);
  await frame();
  check(
    !button("开始分析").disabled && c.selectedIds.value.length === 1,
    "Single mode keeps one story for quick start"
  );
  c.toggleBook("book-1");
  check(
    c.selectedIds.value.length === 1 && c.selectedIds.value[0] === "book-1",
    "Single selection replaces the previous book"
  );
  c.selectPresets(["plot"]);
  c.selectedIds.value = [];
  for (let i = 0; i < 10; i++) c.toggleBook(`book-${i}`);
  await frame();
  button("开始分析").click();
  await frame();
  check(
    request?.task.agentId === "short-book-analysis" &&
      request.modelId === "reasoning-model" &&
      request.thinkingLevel === "high" &&
      request.task.profileId === "plot" &&
      request.task.input.books.length === 10,
    "Ten complete texts submitted"
  );
  check(
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(".short-book-remove")
    ).every((el) => el.disabled),
    "Removal is disabled during analysis"
  );
  check(
    !document.querySelector(":popover-open"),
    "Run details stay closed on start"
  );
  const statusTrigger = document.querySelector<HTMLButtonElement>(
    ".analysis-status-trigger"
  )!;
  statusTrigger.click();
  await frame();
  check(document.querySelector(":popover-open"), "Status opens run details");
  emit("agent.thinking_delta", { delta: "Private test reasoning" });
  emit("agent.message_delta", { delta: "公开分析：人物目标与冲突正在整理。" });
  await frame();
  check(
    document
      .querySelector(".analysis-process-output")
      ?.textContent?.includes("公开分析"),
    "Public stream is visible in details"
  );
  check(
    !document
      .querySelector(".analysis-process-drawer")
      ?.textContent?.includes("Private test reasoning"),
    "Internal reasoning is not exposed"
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="关闭执行过程"]')!
    .click();
  await frame();
  check(
    !document.querySelector(":popover-open") && c.isBusy.value,
    "Closing details leaves analysis running"
  );
  check(
    document.activeElement === statusTrigger,
    "Closing details restores focus"
  );
  visible.value = false;
  await frame();
  emit("extras_agent.output_updated", {
    agentId: "short-book-analysis",
    jobId: request!.task.input.jobId,
    output: { kind: "book-analysis-result", result: probeResult }
  });
  emit("agent.message_completed");
  visible.value = true;
  await frame();
  check(
    document.querySelector(".analysis-result-reading"),
    "Background result survives page change"
  );
  await verifyManualResultSave(frame);
  button("重新分析").click();
  await frame();
  emit("extras_agent.output_updated", {
    agentId: "short-book-analysis",
    jobId: request!.task.input.jobId,
    output: { kind: "book-analysis-result", result: probeResult }
  });
  emit("agent.message_completed");
  await frame();
  verifyEmptyResultDestination();
  check(
    savedProbeEntries.length === 1,
    "A new result never reuses the earlier save destination"
  );
  await verifyParallelPresets();
  document.querySelector<HTMLButtonElement>('[aria-label="预设管理"]')!.click();
  await frame();
  if (!document.querySelector('[aria-label="可选择书本数量"]')) {
    document
      .querySelector<HTMLButtonElement>(".preset-card-heading .preset-summary")
      ?.click();
    await frame();
  }
  check(
    document.querySelector('[aria-label="可选择书本数量"]'),
    "Selection mode is configurable"
  );
  document
    .querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="可选择书本数量"]'
    )!
    .click();
  await frame();
  const menu = document.querySelector<HTMLElement>(
    '[role="listbox"][aria-label="可选择书本数量"]'
  )!;
  check(
    menu && Number(getComputedStyle(menu).zIndex) >= 3200,
    "Preset menu renders above modal"
  );
  document
    .querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="可选择书本数量"]'
    )!
    .click();
  await frame();
  button("取消").click();
  await frame();
  return { passed: true, checks: 35 };
}
async function show(
  scheme: "light" | "dark",
  size: number,
  modal: boolean,
  state = "page"
) {
  if (state === "empty") {
    c.batch.clear();
    c.drafts.value = [];
    c.selectedIds.value = [];
  }
  applyAppearanceThemeToDocument({
    scheme,
    theme: {
      ...defaultAppearanceTheme(scheme),
      uiFontSize: size,
      accent: "#8a4bc2"
    },
    uiFontFamily: "system",
    editorFontFamily: "song"
  });
  await frame();
  if (modal)
    document
      .querySelector<HTMLButtonElement>('[aria-label="预设管理"]')!
      .click();
  else
    document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.click();
  await frame();
  const el = document.querySelector<HTMLElement>(
    modal ? ".analysis-preset-modal" : ".short-book-analysis-page"
  )!;
  const page = document.querySelector<HTMLElement>(
    ".short-book-analysis-page"
  )!;
  page.scrollTop = 0;
  if (state === "setup")
    document.querySelector(".setup-card")!.scrollIntoView({ block: "start" });
  await frame();
  check(el.scrollWidth <= el.clientWidth + 1, "No horizontal page overflow");
  check(
    el.getBoundingClientRect().right <= innerWidth,
    "Feature fits available width"
  );
  if (modal) {
    const rect = el.getBoundingClientRect();
    check(rect.left >= 0 && rect.right <= innerWidth, "Modal fits viewport");
  }
  return {
    scheme,
    size,
    modal,
    width: innerWidth,
    height: innerHeight,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  };
}
Object.assign(window, {
  runShortAnalysisProbe: run,
  showShortAnalysisProbe: show
});
