import { scanGenericAiAnswers } from "./shared";
import { injectSaveButton } from "./inject";
import type { AiPlatformAdapter, AiPlatformContext } from "./types";

export const geminiAdapter: AiPlatformAdapter = {
  name: "Gemini",
  matches(hostname) {
    return (
      hostname === "gemini.google.com" ||
      hostname.endsWith(".gemini.google.com") ||
      hostname === "aistudio.google.com" ||
      hostname.endsWith(".aistudio.google.com")
    );
  },
  scan(context: AiPlatformContext) {
    scanGenericAiAnswers(context, {
      platformName: "Gemini",
      selectors: [
        "model-response",
        "message-content",
        "response-container",
        "[id^='model-response-message-content']",
        "[id*='model-response']",
        ".model-response-text",
        "[class*='model-response']",
        "[class*='response-content']",
        "[class*='response-container']",
        "[class*='response-text']",
        "[class*='markdown']",
        "[class*='prose']",
      ],
      answerHints: ["model-response", "response-container", "message-content"],
    });

    collectGeminiAnswerNodes().forEach((node) => {
      const answerElement = findAnswerElement(node);
      if (!looksLikeGeminiAnswer(answerElement)) {
        return;
      }

      injectSaveButton(answerElement, "Gemini", context, findButtonHost(answerElement));
    });
  },
};

function collectGeminiAnswerNodes(): HTMLElement[] {
  const found = new Set<HTMLElement>();

  document
    .querySelectorAll<HTMLElement>(
      [
        "model-response",
        "message-content",
        "response-container",
        "[id^='model-response-message-content']",
        "[id*='model-response']",
        ".model-response-text",
        "[class*='model-response']",
        "[class*='response-content']",
        "[class*='response-container']",
        "[class*='response-text']",
        "[class*='markdown']",
        "[class*='prose']",
      ].join(", "),
    )
    .forEach((node) => {
      if (isInsideComposer(node) || isLikelyUserMessage(node)) {
        return;
      }

      const answer = findAnswerElement(node);
      if (!isInsideComposer(answer) && !isLikelyUserMessage(answer)) {
        found.add(answer);
      }
    });

  return [...found];
}

function findAnswerElement(node: HTMLElement): HTMLElement {
  return (
    node.querySelector<HTMLElement>(
      [
        "message-content",
        "[id^='model-response-message-content']",
        ".model-response-text",
        "[class*='model-response-text']",
        "[class*='response-content']",
        "[class*='response-text']",
        "[class*='markdown']",
        "[class*='prose']",
      ].join(", "),
    ) ?? node
  );
}

function findButtonHost(answerElement: HTMLElement): HTMLElement {
  return (
    answerElement.closest<HTMLElement>(
      [
        "model-response",
        "response-container",
        "[class*='model-response']",
        "[class*='response-container']",
        "[data-testid*='message']",
        "[class*='message']",
      ].join(", "),
    ) ?? answerElement
  );
}

function looksLikeGeminiAnswer(node: HTMLElement): boolean {
  if (isInsideComposer(node) || isLikelyUserMessage(node)) {
    return false;
  }

  const text = node.textContent?.trim() ?? "";
  if (text.length < 8) {
    return false;
  }

  return (
    Boolean(node.querySelector("p, pre, code, ol, ul, table, h1, h2, h3")) ||
    node.matches("p, pre, code, ol, ul, table, h1, h2, h3, model-response, message-content") ||
    /model-response|response|message-content|markdown|prose/.test(elementLabel(node))
  );
}

function isLikelyUserMessage(node: HTMLElement): boolean {
  const label = elementLabel(node);
  const userRoot = node.closest<HTMLElement>(
    [
      "user-query",
      "[data-message-author-role='user']",
      "[data-role='user']",
      "[aria-label*='user' i]",
      "[aria-label*='You' i]",
      "[class*='user-query']",
      "[class*='user-message']",
      "[class*='prompt-container']",
    ].join(", "),
  );

  return Boolean(userRoot) || label.includes("human") || label.includes("composer");
}

function isInsideComposer(node: HTMLElement): boolean {
  return Boolean(
    node.closest(
      [
        "form",
        "textarea",
        "input",
        "[contenteditable='true']",
        "[data-testid*='composer']",
        "[data-testid*='input']",
        "[class*='composer']",
        "[class*='input-area']",
        "[class*='text-input']",
        "[class*='prompt-input']",
      ].join(", "),
    ),
  );
}

function elementLabel(node: HTMLElement): string {
  return [
    node.tagName,
    node.id,
    node.getAttribute("data-testid"),
    node.getAttribute("data-role"),
    node.getAttribute("aria-label"),
    node.getAttribute("role"),
    node.className.toString(),
    node.closest<HTMLElement>("[data-testid]")?.getAttribute("data-testid"),
    node.closest<HTMLElement>("[data-role]")?.getAttribute("data-role"),
  ]
    .join(" ")
    .toLowerCase();
}
