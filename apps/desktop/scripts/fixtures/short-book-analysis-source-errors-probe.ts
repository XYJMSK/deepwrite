import type { DeepWriteApi } from "@deepwrite/contracts/renderer";
import {
  dismissUiMessage,
  uiMessageItems
} from "../../src/renderer/src/ui-feedback";

export async function verifyShortSourceErrors(
  api: DeepWriteApi,
  frame: () => Promise<void>
) {
  const sources = api.shortBookAnalysis;
  const choose = sources.chooseSources;
  const add = sources.addText;
  const list = sources.sources.list;
  const button = (text: string) => {
    const node = [
      ...document.querySelectorAll<HTMLButtonElement>("button")
    ].find((candidate) => candidate.textContent?.trim() === text);
    if (!node) throw new Error(`Missing source button: ${text}`);
    return node;
  };
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Short source error probe: ${reason}`);
  };
  const reason = "测试工作目录无法写入，请选择可写的工作目录。";
  try {
    sources.chooseSources = async () => {
      throw { code: "short_book_analysis.command_failed", message: reason };
    };
    button("导入文本").click();
    await frame();
    ensure(
      uiMessageItems.value.at(-1)?.content === reason,
      "import hid the structured failure reason"
    );
    ensure(
      !button("导入文本").disabled,
      "failed import left controls disabled"
    );

    sources.chooseSources = async () => {
      throw null;
    };
    button("导入文本").click();
    await frame();
    ensure(
      uiMessageItems.value.at(-1)?.content === "来源操作失败。",
      "unknown failure lost the translated fallback"
    );

    uiMessageItems.value.forEach(({ id }) => dismissUiMessage(id));
    sources.sources.list = async () => {
      throw {
        code: "short_book_analysis.command_failed",
        message: "历史来源读取失败。"
      };
    };
    sources.chooseSources = choose;
    button("导入文本").click();
    await frame();
    ensure(
      uiMessageItems.value.length === 0,
      "history failure turned a successful import into a failed save"
    );

    sources.addText = async () => {
      throw { code: "short_book_analysis.command_failed", message: reason };
    };
    button("粘贴文本").click();
    await frame();
    const dialog = document.querySelector<HTMLElement>(".short-paste-dialog")!;
    const title = dialog.querySelector<HTMLInputElement>("input")!;
    const text = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    title.value = "失败后保留的短篇";
    text.value = "第一章\n主角收到了一封信。\n第二章\n故事完整结束。";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    text.dispatchEvent(new Event("input", { bubbles: true }));
    button("添加短篇").click();
    await frame();
    ensure(
      uiMessageItems.value.at(-1)?.content === reason,
      "paste hid the structured failure reason"
    );
    ensure(
      dialog.isConnected &&
        title.value === "失败后保留的短篇" &&
        text.value.includes("故事完整结束。"),
      "failed paste discarded the entered title or story"
    );
    ensure(!button("添加短篇").disabled, "failed paste prevented retry");
    uiMessageItems.value.forEach(({ id }) => dismissUiMessage(id));
    sources.addText = add;
    button("添加短篇").click();
    await frame();
    ensure(
      !dialog.isConnected,
      "successful retry did not close the paste dialog"
    );
    ensure(
      uiMessageItems.value.length === 0,
      "history failure turned a successful paste into a failed save"
    );
  } finally {
    sources.chooseSources = choose;
    sources.addText = add;
    sources.sources.list = list;
    uiMessageItems.value.forEach(({ id }) => dismissUiMessage(id));
  }
}
