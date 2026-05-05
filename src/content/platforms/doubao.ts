import { injectSaveButton } from "./inject";
import type { AiPlatformAdapter, AiPlatformContext } from "./types";

export const doubaoAdapter: AiPlatformAdapter = {
  name: "豆包",
  matches(hostname) {
    return hostname === "www.doubao.com" || hostname === "doubao.com" || hostname.endsWith(".doubao.com");
  },
  scan(context: AiPlatformContext) {
    const candidates = document.querySelectorAll<HTMLElement>(
      '[data-testid*="assistant"], [class*="assistant"] [class*="markdown"], [class*="bot"] [class*="markdown"]',
    );

    candidates.forEach((node) => {
      if (!looksLikeAnswer(node)) {
        return;
      }

      const answerElement = findAnswerElement(node);
      injectSaveButton(answerElement, "豆包", context, answerElement);
    });
  },
};

function looksLikeAnswer(node: HTMLElement): boolean {
  if (isLikelyUserMessage(node)) {
    return false;
  }

  const text = node.textContent?.trim() ?? "";
  return text.length >= 12 && Boolean(node.querySelector("p, pre, code, ol, ul"));
}

function findAnswerElement(node: HTMLElement): HTMLElement {
  return node.querySelector<HTMLElement>("[class*='markdown'], .markdown") ?? node;
}

function isLikelyUserMessage(node: HTMLElement): boolean {
  const label = [
    node.getAttribute("data-testid"),
    node.getAttribute("aria-label"),
    node.className.toString(),
  ]
    .join(" ")
    .toLowerCase();

  return label.includes("user") || label.includes("human") || label.includes("question");
}
