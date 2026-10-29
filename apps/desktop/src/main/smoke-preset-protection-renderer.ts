import type { DeepWriteApi } from "@deepwrite/contracts";

/** Real DOM checks run only inside the disposable desktop smoke profile. */
export async function presetProtectionUiSmoke() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
  function ensure(value: unknown, message: string): asserts value {
    if (!value) throw new Error(`Preset protection: ${message}`);
  }
  async function until(read: () => unknown, message: string) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (read()) return;
      await pause();
    }
    throw new Error(`Preset protection timeout: ${message}`);
  }
  const modal = () =>
    document.querySelector<HTMLElement>(
      '.analysis-preset-modal[role="dialog"]'
    );
  const confirmation = () =>
    document.querySelector<HTMLElement>(".preset-confirmation");
  async function click(element: Element | null | undefined) {
    ensure(element instanceof HTMLElement, "missing clickable element");
    element.click();
    await pause();
  }
  function button(label: string, root: ParentNode = document) {
    return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) =>
        item.textContent?.trim() === label ||
        item.getAttribute("aria-label") === label
    );
  }
  async function input(
    element: HTMLInputElement | HTMLTextAreaElement | null,
    value: string
  ) {
    ensure(element, "missing editor field");
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await pause();
  }
  await until(
    () => document.querySelector('[data-nav-id="more"]'),
    "workspace ready"
  );
  document.querySelector<HTMLButtonElement>(".startup-alert-close")?.click();
  const results = [];
  for (const agentId of [
    "short-book-analysis",
    "long-book-analysis",
    "long-book-decomposition"
  ] as const) {
    const decomposition = agentId === "long-book-decomposition";
    const more = document.querySelector('[data-nav-id="more"]');
    if (more?.getAttribute("aria-expanded") !== "true") await click(more);
    await click(document.querySelector(`[data-feature-id="${agentId}"]`));
    const manageLabel = decomposition ? "方案管理" : "预设管理";
    await until(() => button(manageLabel), "manager entry");
    const original = await api.extrasAgents.profiles.list(agentId);
    const open = async () => {
      await click(button(manageLabel));
      await until(modal, "manager opened");
    };
    await open();
    await click(modal()!.querySelector("header button"));
    await until(
      () => !modal(),
      "unchanged manager closed without confirmation"
    );
    ensure(!confirmation(), "unchanged draft should not prompt");
    await open();
    await click(button(decomposition ? "新建方案" : "新增预设", modal()!));
    const created = modal()!.querySelector<HTMLInputElement>(
      "article.is-expanded input"
    );
    await input(created, "Smoke newly created rule");
    await click(document.querySelector(".analysis-modal-backdrop"));
    ensure(
      created?.value === "Smoke newly created rule" && modal(),
      "outside click lost new rule"
    );
    await click(button("取消", modal()!));
    await click(button("放弃修改", confirmation()!));
    await until(() => !modal(), "new draft discarded");
    await open();
    await click(modal()!.querySelector(".preset-summary"));
    const editor = () =>
      modal()!.querySelector<HTMLInputElement>("article input");
    await input(editor(), "Smoke unsaved rule");
    const prompt = modal()!.querySelector<HTMLTextAreaElement>("textarea");
    await input(
      prompt,
      "Smoke draft prompt remains intact after accidental dismissal."
    );
    await click(document.querySelector(".analysis-modal-backdrop"));
    ensure(
      modal() && editor()?.value === "Smoke unsaved rule",
      "outside click lost draft"
    );
    await click(modal()!.querySelector("header button"));
    await until(confirmation, "dirty close confirmation");
    ensure(
      document.activeElement === confirmation()!.querySelector("button"),
      "continue editing must receive focus"
    );
    await click(confirmation()!.parentElement);
    ensure(confirmation(), "confirmation backdrop dismissed the dialog");
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await pause();
    ensure(
      !confirmation() && editor()?.value === "Smoke unsaved rule",
      "Escape must return to editing"
    );
    ensure(prompt?.value.includes("remains intact"), "prompt was cleared");
    await click(button("取消", modal()!));
    await until(confirmation, "cancel confirmation");
    await click(button("放弃修改", confirmation()!));
    await until(() => !modal(), "discard closed manager");
    await open();
    await click(modal()!.querySelector(".preset-summary"));
    ensure(editor()?.value !== "Smoke unsaved rule", "discard failed");
    await input(editor(), "");
    await input(
      modal()!.querySelector("textarea"),
      "Keep this prompt after validation failure."
    );
    await click(modal()!.querySelector("footer .analysis-primary-button"));
    ensure(
      modal() &&
        modal()!.querySelector<HTMLTextAreaElement>("textarea")?.value ===
          "Keep this prompt after validation failure.",
      "failed save lost draft"
    );
    await input(editor(), "Smoke saved rule");
    await click(modal()!.querySelector("footer .analysis-primary-button"));
    await until(() => !modal(), "successful save closed manager");
    ensure(
      (await api.extrasAgents.profiles.list(agentId)).profiles[0]?.name ===
        "Smoke saved rule",
      "save did not persist"
    );
    await open();
    if (!decomposition) {
      const articles = [...modal()!.querySelectorAll("article")];
      await click(articles[1]!.querySelector(".preset-summary"));
      await input(articles[1]!.querySelector("input"), "Other unsaved rule");
      await click(button("恢复默认", articles[0]!));
      await until(
        () =>
          articles[0]!.querySelector("strong")?.textContent?.trim() ===
          original.profiles[0]?.name,
        "single default restored"
      );
      ensure(
        articles[1]!.querySelector<HTMLInputElement>("input")?.value ===
          "Other unsaved rule",
        "single reset replaced another draft"
      );
      await click(button("恢复全部默认", modal()!));
      await until(confirmation, "reset all confirmation");
      await click(button("继续编辑", confirmation()!));
      ensure(
        articles[1]!.querySelector<HTMLInputElement>("input")?.value ===
          "Other unsaved rule",
        "cancel reset lost draft"
      );
      await click(button("恢复全部默认", modal()!));
      await click(button("恢复默认", confirmation()!));
      await until(
        () =>
          modal()!
            .querySelectorAll("article")[1]
            ?.querySelector("strong")
            ?.textContent?.trim() === original.profiles[1]?.name,
        "all defaults restored"
      );
    } else {
      await click(modal()!.querySelector(".preset-summary"));
      await click(button("恢复默认", modal()!));
      await until(
        () => editor()?.value === original.profiles[0]?.name,
        "decomposition default restored"
      );
    }
    ensure(
      (await api.extrasAgents.profiles.list(agentId)).profiles[0]?.name ===
        "Smoke saved rule",
      "reset persisted before saving"
    );
    await click(button("取消", modal()!));
    await until(confirmation, "reset draft discard");
    await click(button("放弃修改", confirmation()!));
    await until(() => !modal(), "manager closed");
    await api.extrasAgents.profiles.save({
      agentId,
      profiles: original.profiles.map(
        ({ builtin: _builtin, ...profile }) => profile
      )
    } as Parameters<typeof api.extrasAgents.profiles.save>[0]);
    results.push(agentId);
  }
  return { status: "ok", agents: results };
}
