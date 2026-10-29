import { createScopedTranslator } from "../../i18n";
import { computed, ref, shallowRef, watch } from "vue";
import {
  RevisionAnalysisInputSchema,
  REVISION_TEXT_LIMIT,
  type DeepWriteApi,
  type RevisionAnalysisProfile,
  type ModelConfig,
  type RevisionChange,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { selectableModels } from "../../utils/selectableModelSettings";
import { compareRevisionParagraphs } from "./paragraph-diff";
import { createPromptProfile } from "../agent-runtime/promptProfile";
import {
  createRevisionAnalysisRun,
  revisionAnalysisInputKey
} from "./analysis-run";
import { createRevisionSkillSave } from "./skill-save";

const t = createScopedTranslator("extras.revisionAnalysis");
export type RevisionAnalysisController = ReturnType<typeof useRevisionAnalysis>;
export function useRevisionAnalysis(options: {
  api: () => DeepWriteApi | undefined;
}) {
  const api = () => {
    const current = options.api();
    if (!current) throw new Error(t("revisionUnavailable"));
    return current;
  };
  const run = createRevisionAnalysisRun(api);
  const beforeText = ref(""),
    afterText = ref(""),
    overallReason = ref("");
  const method = createPromptProfile(api, "revision-analysis", () =>
    t("methodRequired")
  );
  const systemPrompt = method.systemPrompt;
  const changes = ref<RevisionChange[]>([]);
  const comparedText = ref("");
  const selectedModelId = ref(""),
    selectedThinkingLevel = ref<ThinkingLevel>("off");
  const models = shallowRef<readonly ModelConfig[]>([]);
  const loading = ref(false);
  let loaded = false,
    disposed = false;
  const textKey = () => JSON.stringify([beforeText.value, afterText.value]);
  const comparisonCurrent = computed(() => comparedText.value === textKey());
  const input = computed(() => ({
    beforeText: beforeText.value,
    afterText: afterText.value,
    changes: changes.value,
    overallReason: overallReason.value
  }));
  const inputKey = computed(() => {
    const parsed = RevisionAnalysisInputSchema.safeParse(input.value);
    return parsed.success
      ? revisionAnalysisInputKey(parsed.data, systemPrompt.value.trim())
      : "";
  });
  const isStale = computed(
    () =>
      Boolean(run.result.value) && inputKey.value !== run.completedInput.value
  );
  const skillSave = createRevisionSkillSave(api, run.result);
  const disabled = computed(
    () => run.isBusy.value || loading.value || skillSave.saving.value
  );
  const isPreviousResult = computed(
    () =>
      Boolean(run.result.value) && (run.resultIsPrevious.value || isStale.value)
  );
  const selectedModel = computed(() =>
    models.value.find((m) => m.id === selectedModelId.value)
  );
  const canStart = computed(
    () =>
      !disabled.value &&
      Boolean(beforeText.value.trim()) &&
      Boolean(afterText.value.trim()) &&
      beforeText.value.length <= REVISION_TEXT_LIMIT &&
      afterText.value.length <= REVISION_TEXT_LIMIT &&
      Boolean(selectedModel.value)
  );
  function editable() {
    if (disabled.value || disposed) throw new Error(t("busyEditLater"));
  }
  function compare() {
    editable();
    if (!beforeText.value.trim() || !afterText.value.trim())
      throw new Error(t("bothTextsRequired"));
    if (
      beforeText.value.length > REVISION_TEXT_LIMIT ||
      afterText.value.length > REVISION_TEXT_LIMIT
    )
      throw new Error(t("revisionLengthLimit"));
    changes.value = compareRevisionParagraphs(
      beforeText.value,
      afterText.value,
      changes.value
    );
    comparedText.value = textKey();
  }
  const stopModelWatch = watch(selectedModelId, () => {
    selectedThinkingLevel.value =
      selectedModel.value?.defaultThinkingLevel ?? "off";
  });
  return {
    ...run,
    ...skillSave,
    beforeText,
    afterText,
    overallReason,
    systemPrompt,
    changes,
    selectedModelId,
    selectedThinkingLevel,
    comparisonCurrent,
    isStale,
    isPreviousResult,
    loading,
    disabled,
    canStart,
    resetWorkspace() {
      editable();
      run.clear();
      beforeText.value = "";
      afterText.value = "";
      overallReason.value = "";
      changes.value = [];
      comparedText.value = "";
      skillSave.savedKey.value = "";
      skillSave.savedEntry.value = null;
    },
    setConfiguredModels(next: readonly ModelConfig[], defaultModelId?: string) {
      const available = selectableModels(next);
      models.value = available;
      const model =
        available.find((m) => m.id === selectedModelId.value) ??
        available.find((m) => m.id === defaultModelId) ??
        available[0];
      selectedModelId.value = model?.id ?? "";
      if (
        model &&
        selectedThinkingLevel.value !== "off" &&
        !model.thinkingLevelOptions.includes(selectedThinkingLevel.value)
      )
        selectedThinkingLevel.value = model.defaultThinkingLevel;
    },
    async loadSettings() {
      if (loaded || loading.value || disposed) return;
      loading.value = true;
      try {
        await method.load();
        loaded = !disposed;
      } finally {
        loading.value = false;
      }
    },
    async saveSettings(reset = false) {
      editable();
      loading.value = true;
      try {
        await (reset ? method.reset() : method.save());
        loaded = true;
      } finally {
        loading.value = false;
      }
    },
    compare,
    async persistSkill(library: Parameters<typeof skillSave.persistSkill>[0]) {
      if (run.isBusy.value || loading.value)
        throw new Error(t("waitBeforeSavingSkill"));
      return skillSave.persistSkill(library);
    },
    retry() {
      editable();
      run.retry();
    },
    async start() {
      editable();
      if (!comparisonCurrent.value) compare();
      if (!changes.value.length) throw new Error(t("noDifferencesToAnalyze"));
      const model = selectedModel.value;
      if (!canStart.value || !model)
        throw new Error(t("textsAndModelRequired"));
      const parsed = RevisionAnalysisInputSchema.parse(input.value);
      let profile: RevisionAnalysisProfile;
      loading.value = true;
      try {
        profile = (await method.ensureSaved()) as RevisionAnalysisProfile;
      } finally {
        loading.value = false;
      }
      if (disposed) return;
      run.start(parsed, profile, model, selectedThinkingLevel.value);
    },
    dispose() {
      disposed = true;
      stopModelWatch();
      run.dispose();
    }
  };
}
