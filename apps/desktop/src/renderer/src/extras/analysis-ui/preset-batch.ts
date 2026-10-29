import {
  computed,
  markRaw,
  reactive,
  ref,
  shallowRef,
  toRaw,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
  type WatchStopHandle
} from "vue";
import type { SystemEventEnvelope } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";
import { localizedTextRef, type LocalizedText } from "./localized-text";
import type { AnalysisPresetRunner, PresetRunStatus } from "./preset-runner";

const t = createScopedTranslator("extras.analysisUi");

/** At most this many presets run in one analysis. */
export const PRESET_BATCH_MAX_PRESETS = 6;
/** Runs one page keeps in flight; the Agent Utility allows three extras runs. */
export const PRESET_BATCH_CONCURRENCY = 3;
const CAPACITY_RETRY_MS = 3000;
const CAPACITY_CODES = new Set([
  "agent.extras_capacity_reached",
  "agent.capacity_reached"
]);

export type PresetItemState = Exclude<PresetRunStatus, "idle"> | "queued";
export type PresetBatchStatus = PresetRunStatus | "partial";

export interface PresetBatchItem<P, R> {
  readonly id: string;
  readonly preset: P;
  readonly runner: AnalysisPresetRunner<R>;
  state: PresetItemState;
  /** Queued again because the Agent Utility had no free run slot. */
  waiting: boolean;
  started: boolean;
  failure: string | null;
}

export interface SavedLibraryEntry {
  libraryId: string;
  entryId: string;
}

export interface PresetBatchResult<P, R> {
  readonly id: string;
  readonly preset: P;
  readonly order: number;
  result: R;
  saved: boolean;
  savedEntry?: SavedLibraryEntry;
}

export interface PresetBatchCounts {
  total: number;
  queued: number;
  running: number;
  stopping: number;
  completed: number;
  failed: number;
  stopped: number;
}

export interface PresetBatch<P, R> {
  items: Readonly<ShallowRef<readonly PresetBatchItem<P, R>[]>>;
  results: Readonly<ShallowRef<readonly PresetBatchResult<P, R>[]>>;
  /** Task rows stay visible until the inputs change. */
  tasksVisible: Readonly<Ref<boolean>>;
  context: Readonly<Ref<string>>;
  counts: ComputedRef<PresetBatchCounts>;
  status: ComputedRef<PresetBatchStatus>;
  isBusy: ComputedRef<boolean>;
  canRetry: ComputedRef<boolean>;
  unsavedCount: ComputedRef<number>;
  /** "预设：原因" of the latest failure, for the workspace notification. */
  error: ComputedRef<string | null>;
  startedAt: Readonly<Ref<number | null>>;
  endedAt: Readonly<Ref<number | null>>;
  start(
    entries: readonly { preset: P; runner: AnalysisPresetRunner<R> }[],
    context: LocalizedText
  ): void;
  stop(): Promise<void>;
  stopItem(id: string): Promise<void>;
  retryItem(id: string): boolean;
  retryFailed(): boolean;
  settle(): void;
  clear(): void;
  updateResult(id: string, result: R): void;
  markSaved(id: string, savedEntry?: SavedLibraryEntry): void;
  handleEvent(event: SystemEventEnvelope): void;
  dispose(): void;
}

function isActive(state: PresetItemState): boolean {
  return state === "running" || state === "stopping";
}

/** Runs one runner per preset with a concurrency limit and shared status. */
export function createPresetBatch<P extends { id: string }, R>(
  options: {
    concurrency?: number;
    retryDelayMs?: number;
    label?: (preset: P) => string;
  } = {}
): PresetBatch<P, R> {
  const concurrency = options.concurrency ?? PRESET_BATCH_CONCURRENCY;
  const retryDelay = options.retryDelayMs ?? CAPACITY_RETRY_MS;
  const items = shallowRef<PresetBatchItem<P, R>[]>([]);
  const results = shallowRef<PresetBatchResult<P, R>[]>([]);
  const tasksVisible = ref(false);
  const context = localizedTextRef();
  const startedAt = ref<number | null>(null);
  const endedAt = ref<number | null>(null);
  const watchers = new Map<string, WatchStopHandle>();
  const lastFailed = shallowRef<PresetBatchItem<P, R> | null>(null);
  let blockedUntil = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pumping = false;
  let disposed = false;

  const counts = computed<PresetBatchCounts>(() => {
    const next = {
      total: items.value.length,
      queued: 0,
      running: 0,
      stopping: 0,
      completed: 0,
      failed: 0,
      stopped: 0
    };
    for (const item of items.value) {
      if (item.state === "error") next.failed += 1;
      else next[item.state] += 1;
    }
    return next;
  });
  const status = computed<PresetBatchStatus>(() => {
    const c = counts.value;
    if (!c.total) return "idle";
    if (c.running || c.queued) return "running";
    if (c.stopping) return "stopping";
    if (c.completed === c.total) return "completed";
    if (c.completed) return "partial";
    return c.failed ? "error" : "stopped";
  });
  const isBusy = computed(
    () => status.value === "running" || status.value === "stopping"
  );
  const canRetry = computed(() =>
    items.value.some(
      (item) => item.state === "error" || item.state === "stopped"
    )
  );
  const unsavedCount = computed(
    () => results.value.filter((entry) => !entry.saved).length
  );
  const error = computed(() => {
    const item = lastFailed.value;
    if (!item || item.state !== "error") return null;
    const message =
      item.failure ?? item.runner.error.value ?? t("analysisFailed");
    return options.label
      ? `${options.label(item.preset)}：${message}`
      : message;
  });
  const stopBusyWatch = watch(
    isBusy,
    (busy) => {
      if (busy) {
        startedAt.value = Date.now();
        endedAt.value = null;
      } else if (items.value.length) endedAt.value = Date.now();
    },
    { flush: "sync" }
  );

  function find(id: string): PresetBatchItem<P, R> | undefined {
    return items.value.find((item) => item.id === id);
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      pump();
    }, retryDelay);
  }

  function launch(item: PresetBatchItem<P, R>): void {
    const resume = item.started;
    item.state = "running";
    item.waiting = false;
    item.started = true;
    item.failure = null;
    try {
      if (resume) item.runner.retry();
      else item.runner.start();
    } catch (error: unknown) {
      item.failure = formatError(error, t("analysisFailed"));
      item.state = "error";
      lastFailed.value = item;
      return;
    }
    const current = item.runner.status.value;
    if (current !== "running" && current !== "stopping") {
      item.state = current === "idle" ? "error" : current;
    }
  }

  function pump(): void {
    if (pumping || disposed || Date.now() < blockedUntil) return;
    pumping = true;
    try {
      for (const item of items.value) {
        const active = items.value.filter((entry) => isActive(entry.state));
        if (active.length >= concurrency) break;
        if (item.state === "queued") launch(item);
      }
    } finally {
      pumping = false;
    }
  }

  function keepResult(item: PresetBatchItem<P, R>, order: number): void {
    const value = item.runner.result.value;
    if (!value) return;
    const entry = reactive({
      id: item.id,
      preset: item.preset,
      order,
      result: structuredClone(toRaw(value)),
      saved: false
    }) as PresetBatchResult<P, R>;
    results.value = [
      ...results.value.filter((existing) => existing.id !== item.id),
      entry
    ].sort((a, b) => a.order - b.order);
  }

  function track(item: PresetBatchItem<P, R>, order: number): WatchStopHandle {
    return watch(
      item.runner.status,
      (next) => {
        if (next === "idle") return;
        if (next === "running" || next === "stopping") {
          item.state = next;
          return;
        }
        if (
          next === "error" &&
          item.state === "running" &&
          CAPACITY_CODES.has(item.runner.errorCode() ?? "")
        ) {
          item.state = "queued";
          item.waiting = true;
          blockedUntil = Date.now() + retryDelay;
          schedule();
          return;
        }
        if (next === "completed") keepResult(item, order);
        item.state = next;
        if (next === "error") lastFailed.value = item;
        blockedUntil = 0;
        pump();
      },
      { flush: "sync" }
    );
  }

  function release(ids: readonly string[]): void {
    for (const id of ids) {
      watchers.get(id)?.();
      watchers.delete(id);
      find(id)?.runner.dispose();
    }
  }

  function assertIdle(): void {
    if (isBusy.value) throw new Error(t("batchInputsLocked"));
  }

  function clear(): void {
    assertIdle();
    clearTimeout(timer);
    blockedUntil = 0;
    release(items.value.map((item) => item.id));
    lastFailed.value = null;
    items.value = [];
    results.value = [];
    tasksVisible.value = false;
    context.value = "";
    startedAt.value = null;
    endedAt.value = null;
  }

  function retryItem(id: string): boolean {
    const item = find(id);
    if (!item || (item.state !== "error" && item.state !== "stopped"))
      return false;
    item.state = "queued";
    item.failure = null;
    if (lastFailed.value === item) lastFailed.value = null;
    tasksVisible.value = true;
    pump();
    return true;
  }

  return {
    items,
    results,
    tasksVisible,
    context,
    counts,
    status,
    isBusy,
    canRetry,
    unsavedCount,
    error,
    startedAt,
    endedAt,
    start(entries, nextContext) {
      clear();
      const next = entries.map(
        ({ preset, runner }) =>
          reactive({
            id: preset.id,
            preset: markRaw(preset),
            runner: markRaw(runner),
            state: "queued",
            waiting: false,
            started: false,
            failure: null
          }) as PresetBatchItem<P, R>
      );
      items.value = next;
      next.forEach((item, order) => watchers.set(item.id, track(item, order)));
      context.value = nextContext;
      tasksVisible.value = true;
      pump();
    },
    async stop() {
      for (const item of items.value) {
        if (item.state !== "queued") continue;
        item.state = "stopped";
        item.waiting = false;
      }
      clearTimeout(timer);
      blockedUntil = 0;
      const outcomes = await Promise.allSettled(
        items.value
          .filter((item) => item.state === "running")
          .map((item) => item.runner.stop())
      );
      const failed = outcomes.find((outcome) => outcome.status === "rejected");
      if (failed) throw failed.reason;
    },
    async stopItem(id) {
      const item = find(id);
      if (item?.state === "queued") {
        item.state = "stopped";
        item.waiting = false;
        pump();
      } else if (item?.state === "running") await item.runner.stop();
    },
    retryItem,
    retryFailed() {
      let retried = false;
      for (const item of items.value) retried = retryItem(item.id) || retried;
      return retried;
    },
    settle() {
      assertIdle();
      clearTimeout(timer);
      release(items.value.map((item) => item.id));
      lastFailed.value = null;
      items.value = [];
      tasksVisible.value = false;
    },
    clear,
    updateResult(id, result) {
      const entry = results.value.find((existing) => existing.id === id);
      if (entry) entry.result = result;
    },
    markSaved(id, savedEntry) {
      const entry = results.value.find((existing) => existing.id === id);
      if (entry) {
        entry.saved = true;
        if (savedEntry) entry.savedEntry = savedEntry;
      }
    },
    handleEvent(event) {
      for (const item of items.value) item.runner.handleEvent(event);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      stopBusyWatch();
      release(items.value.map((item) => item.id));
    }
  };
}
