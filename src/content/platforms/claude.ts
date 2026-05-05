import { injectSaveButton } from "./inject";
import type { AiPlatformAdapter, AiPlatformContext } from "./types";

export const claudeAdapter: AiPlatformAdapter = {
  name: "Claude",
  matches(hostname) {
    return hostname === "claude.ai" || hostname.endsWith(".claude.ai");
  },
  scan(context: AiPlatformContext) {
    const candidates = collectClaudeAnswerNodes();

    candidates.forEach((node) => {
      if (!looksLikeAssistantAnswer(node)) {
        return;
      }

      const answerElement = findAnswerElement(node);
      injectSaveButton(answerElement, "Claude", context, answerElement);
    });
  },
};

function collectClaudeAnswerNodes(): HTMLElement[] {
  const found = new Set<HTMLElement>();

  document
    .querySelectorAll<HTMLElement>(
      [
        '[data-testid*="assistant"]',
        '[data-testid*="message"] div.font-claude-message',
        "div.font-claude-message",
        "[class*='font-claude-message']",
        "[class*='assistant'] [class*='markdown']",
        "[class*='message'] [class*='markdown']",
        "[class*='prose']",
      ].join(", "),
    )
    .forEach((node) => {
      const answer = findAnswerElement(node);
      if (!isLikelyUserMessage(answer) && !isInsideComposer(answer)) {
        found.add(answer);
      }
    });

  return [...found];
}

function looksLikeAssistantAnswer(node: HTMLElement): boolean {
  if (isLikelyUserMessage(node) || isInsideComposer(node)) {
    return false;
  }

  const text = node.textContent?.trim() ?? "";

  if (text.length < 12) {
    return false;
  }

  return (
    Boolean(node.querySelector("p, pre, code, ol, ul")) ||
    node.matches("p, pre, code, ol, ul") ||
    node.className.toString().includes("claude-message") ||
    node.className.toString().includes("prose")
  );
}

function findAnswerElement(node: HTMLElement): HTMLElement {
  return (
    node.querySelector<HTMLElement>(
      ".font-claude-message, [class*='font-claude-message'], .markdown, [class*='markdown'], [class*='prose']",
    ) ?? node
  );
}

function isLikelyUserMessage(node: HTMLElement): boolean {
  const label = [
    node.getAttribute("data-testid"),
    node.getAttribute("aria-label"),
    node.className.toString(),
  ]
    .join(" ")
    .toLowerCase();

  return label.includes("user") || label.includes("human") || label.includes("composer");
}

function isInsideComposer(node: HTMLElement): boolean {
  return Boolean(node.closest("form, textarea, [contenteditable='true'], [data-testid*='composer']"));
}
