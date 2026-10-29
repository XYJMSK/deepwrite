import { effectScope, nextTick, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePresetDraft } from "./usePresetDraft";
import { uiMessage } from "../../ui-feedback";

type Preset = { id: string; name: string; output: { kind: string } };
const preset = (id: string): Preset => ({
  id,
  name: id,
  output: { kind: "plot" }
});
const scopes: ReturnType<typeof effectScope>[] = [];
function fixture() {
  const props = reactive({ open: true, presets: [preset("a"), preset("b")] });
  const defaults = [preset("a"), preset("b")];
  const loadDefaults = vi.fn(async () => defaults);
  const scope = effectScope();
  scopes.push(scope);
  const editor = scope.run(() =>
    usePresetDraft({
      open: () => props.open,
      presets: () => props.presets,
      loadDefaults
    })
  )!;
  return { props, defaults, loadDefaults, ...editor };
}
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.restoreAllMocks();
});
describe("preset editing protection", () => {
  it("detects content, nested output, creation, deletion and ordering changes, including undo", () => {
    const f = fixture();
    expect(f.dirty.value).toBe(false);
    f.draft.value[0]!.name = "edited";
    expect(f.dirty.value).toBe(true);
    f.draft.value[0]!.name = "a";
    expect(f.dirty.value).toBe(false);
    f.draft.value[0]!.output.kind = "character";
    expect(f.dirty.value).toBe(true);
    f.draft.value[0]!.output.kind = "plot";
    expect(f.props.presets[0]!.output.kind).toBe("plot");
    f.draft.value.reverse();
    expect(f.dirty.value).toBe(true);
    f.draft.value.reverse();
    expect(f.dirty.value).toBe(false);
    f.draft.value.push(preset("c"));
    expect(f.dirty.value).toBe(true);
    f.draft.value.pop();
    expect(f.dirty.value).toBe(false);
    f.draft.value.shift();
    expect(f.dirty.value).toBe(true);
  });
  it("retains unsaved edits when authoritative settings refresh and resets only on reopening", async () => {
    const f = fixture();
    f.draft.value[0]!.name = "unsaved";
    f.props.presets = [preset("fresh")];
    await nextTick();
    expect(f.draft.value[0]!.name).toBe("unsaved");
    expect(f.dirty.value).toBe(true);
    f.props.open = false;
    await nextTick();
    f.props.open = true;
    await nextTick();
    expect(f.draft.value).toEqual(f.props.presets);
    expect(f.dirty.value).toBe(false);
  });
  it("restores one default without overwriting another edit or persisting changes", async () => {
    const f = fixture();
    f.draft.value[0]!.name = "edited a";
    f.draft.value[1]!.name = "edited b";
    await f.reset("a");
    expect(f.draft.value.map((item) => item.name)).toEqual(["a", "edited b"]);
    expect(f.props.presets.map((item) => item.name)).toEqual(["a", "b"]);
    f.draft.value[0]!.output.kind = "other";
    expect(f.defaults[0]!.output.kind).toBe("plot");
  });
  it("keeps the complete draft if loading defaults fails and allows retry", async () => {
    const f = fixture();
    const error = vi.spyOn(uiMessage, "error");
    f.draft.value[0]!.name = "unsaved";
    f.loadDefaults.mockRejectedValueOnce(new Error("test failure"));
    await f.reset();
    expect(f.draft.value[0]!.name).toBe("unsaved");
    expect(f.resetting.value).toBe(false);
    expect(error).toHaveBeenCalled();
    await f.reset();
    expect(f.draft.value).toEqual(f.defaults);
  });
  it("hands saving an isolated snapshot and rejects overlapping resets", async () => {
    const f = fixture();
    const snapshot = f.snapshot();
    f.draft.value[0]!.name = "later edit";
    expect(snapshot[0]!.name).toBe("a");
    let finish!: (value: Preset[]) => void;
    f.loadDefaults.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = f.reset();
    expect(f.resetting.value).toBe(true);
    await f.reset();
    expect(f.loadDefaults).toHaveBeenCalledTimes(1);
    finish(f.defaults);
    await first;
    expect(f.resetting.value).toBe(false);
  });
});
