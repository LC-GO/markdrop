import { injectSaveButton } from "./inject";
import type { AiPlatformAdapter, AiPlatformContext } from "./types";

export const chatgptAdapter: AiPlatformAdapter = {
  name: "ChatGPT",
  matches(hostname) {
    return hostname === "chat.openai.com" || hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com");
  },
  scan(context: AiPlatformContext) {
    const nodes = collectChatGptAnswerNodes();

    nodes.forEach((node) => {
      if (!looksLikeAssistantAnswer(node)) {
        return;
      }

      const answerElement = findAnswerElement(node);
      injectSaveButton(answerElement, "ChatGPT", context, answerElement);
    });
  },
};

function collectChatGptAnswerNodes(): HTMLElement[] {
  const found = new Set<HTMLElement>();

  document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]').forEach((node) => {
    found.add(findAnswerElement(node));
  });

  document.querySelectorAll<HTMLElement>('[data-testid="markdown"], .markdown, [class*="markdown"]').forEach((node) => {
    if (isInsideComposer(node) || isInsideUserMessage(node)) {
      return;
    }

    const message = node.closest<HTMLElement>('[data-message-author-role], article, [data-testid*="conversation"]');
    if (message && isInsideUserMessage(message)) {
      return;
    }

    found.add(node);
  });

  return [...found];
}

function findAnswerElement(node: HTMLElement): HTMLElement {
  return (
    node.querySelector<HTMLElement>('[data-testid="markdown"]') ??
    node.querySelector<HTMLElement>(".markdown") ??
    node.querySelector<HTMLElement>('[class*="markdown"]') ??
    node
  );
}

function looksLikeAssistantAnswer(node: HTMLElement): boolean {
  if (isInsideComposer(node) || isInsideUserMessage(node)) {
    return false;
  }

  const text = node.textContent?.trim() ?? "";
  return text.length >= 8 && Boolean(node.querySelector("p, pre, code, ol, ul") || node.matches("p, pre, code, ol, ul, .markdown, [class*='markdown']"));
}

function isInsideUserMessage(node: HTMLElement): boolean {
  const roleNode = node.closest<HTMLElement>("[data-message-author-role]");
  if (roleNode?.getAttribute("data-message-author-role") === "user") {
    return true;
  }

  const label = [
    node.getAttribute("data-testid"),
    node.getAttribute("aria-label"),
    node.className.toString(),
    node.closest<HTMLElement>("[data-testid]")?.getAttribute("data-testid"),
  ]
    .join(" ")
    .toLowerCase();

  return label.includes("user") || label.includes("human");
}

function isInsideComposer(node: HTMLElement): boolean {
  return Boolean(node.closest("form, textarea, [contenteditable='true'], [data-testid*='composer']"));
}
