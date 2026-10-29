import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, nextTick, ref, ssrContextKey } from "vue";
import type { UserPromptAttachment } from "@deepwrite/contracts";
import ChatAssistantComposer from "./ChatAssistantComposer.vue";

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: () => ({
    generalSettings: {
      textAttachmentMaxCharacters: 10_000,
      contextCompaction: { budgetTokens: 64_000 }
    }
  })
}));
vi.mock("../../composables/useVoiceInput", () => ({
  useVoiceInput: () => ({ active: ref(false) })
}));
vi.mock("../../ui-feedback", () => ({
  uiMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

const renderer = createRenderer({
  patchProp: () => {},
  insert: () => {},
  remove: () => {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null
});
interface ComposerState {
  attachmentInput: HTMLInputElement;
  pendingAttachments: UserPromptAttachment[];
  readingAttachments: boolean;
  canSubmit: boolean;
  openAttachmentPicker(): void;
  handleAttachmentChange(event: Event): void;
  addAttachmentFiles(files: File[]): Promise<void>;
  removePendingAttachment(id: string): void;
  submit(): void;
}
const unmounts: Array<() => void> = [];
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
  vi.clearAllMocks();
});

function mount() {
  const props = {
    sessionId: "chat-session",
    draft: "",
    runtimeAvailable: true,
    busy: false,
    canSend: false,
    canSendAttachments: true,
    canStop: false,
    selectedModelId: "test-model",
    modelOptions: [],
    thinkingLevel: "off" as const,
    thinkingOptions: [],
    webSearchEnabled: false,
    webSearchAvailable: false,
    webSearchDisabledReason: ""
  };
  const send = vi.fn();
  // Exercise the real SFC setup and shared upload flow without a native dialog.
  const app = renderer.createApp(
    { ...ChatAssistantComposer, render: () => null },
    { ...props, onSend: send }
  );
  app.provide(ssrContextKey, { modules: new Set() });
  const vm = app.mount({});
  unmounts.push(() => app.unmount());
  const { setupState: state } = vm.$ as unknown as {
    setupState: ComposerState;
  };
  return { state, send, vm };
}

describe("chat composer attachments", () => {
  it("opens the picker, reads a selected file and sends an attachment-only turn", async () => {
    const { state, send, vm } = mount();
    const click = vi.fn();
    const file = new File(["小说正文"], "novel.txt", { type: "text/plain" });
    const input = { click, value: "novel.txt", files: [file] };
    state.attachmentInput = input as unknown as HTMLInputElement;
    state.openAttachmentPicker();
    expect(click).toHaveBeenCalledOnce();
    expect(state.canSubmit).toBe(false);

    state.handleAttachmentChange({ target: input } as unknown as Event);
    expect(input.value).toBe("");
    expect(state.readingAttachments).toBe(true);
    expect(state.canSubmit).toBe(false);
    await vi.waitFor(() => expect(state.readingAttachments).toBe(false));
    expect(state.pendingAttachments).toEqual([
      expect.objectContaining({ name: "novel.txt", content: "小说正文" })
    ]);
    expect(state.canSubmit).toBe(true);
    vm.$.props.busy = true;
    expect(state.canSubmit).toBe(false);
    state.submit();
    expect(send).not.toHaveBeenCalled();
    vm.$.props.busy = false;
    state.submit();
    expect(send).toHaveBeenCalledWith([
      expect.objectContaining({ name: "novel.txt", content: "小说正文" })
    ]);
    expect(state.pendingAttachments).toEqual([]);
  });

  it("deduplicates files and allows removal before sending", async () => {
    const { state, send } = mount();
    const file = new File(["notes"], "notes.md", { type: "text/markdown" });
    await state.addAttachmentFiles([file, file]);
    expect(state.pendingAttachments).toHaveLength(1);
    state.removePendingAttachment(state.pendingAttachments[0]!.id);
    expect(state.canSubmit).toBe(false);
    state.submit();
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a file read that finishes after switching conversation", async () => {
    const { state, vm } = mount();
    let resolveText!: (text: string) => void;
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    vi.spyOn(file, "text").mockImplementation(
      () => new Promise<string>((resolve) => (resolveText = resolve))
    );
    const reading = state.addAttachmentFiles([file]);
    // Updating the reactive component prop also covers the composable watcher.
    vm.$.props.sessionId = "another-chat";
    await nextTick();
    resolveText("old conversation attachment");
    await reading;
    expect(state.pendingAttachments).toEqual([]);
    expect(state.readingAttachments).toBe(false);
  });
});
