import { installAiSaveButtons } from "./platforms";
import { ensureAiButtonStyle } from "./platforms/inject";
import { MARKDROP_BUILD_ID } from "../utils/buildInfo";
import { formatUserFacingError } from "../utils/errors";
import { getI18n } from "../utils/i18n";
import { markdownToNotionBlocks, type NotionBlock } from "../utils/notionBlocks";
import { getDefaultTarget, getSettings } from "../utils/storage";
import { formatDefaultTitle } from "../utils/title";
import { extractMathExpression, htmlToMarkdown } from "../utils/markdown";
import { cleanCodeBlockText } from "../utils/codeLanguage";
import { targetProvider } from "../utils/types";
import type { CapturedContent, MarkdropSettings, SaveRequest, SaveResult } from "../utils/types";

let activePanel: HTMLElement | null = null;
let latestSettings: MarkdropSettings | null = null;
let aiRuntimeBadge: HTMLElement | null = null;

const contentScriptState = globalThis as typeof globalThis & {
  __markdropContentScriptState?: {
    bootId: number;
    cleanup?: () => void;
  };
};

const state = (contentScriptState.__markdropContentScriptState ??= { bootId: 0 });
try {
  state.cleanup?.();
} catch {
  // A previous content script instance can outlive an extension reload.
}
cleanupStaleInjectedUi();
state.bootId += 1;
void boot(state.bootId);

function cleanupStaleInjectedUi(): void {
  document
    .querySelectorAll(
      ".markdrop-ai-host, #markdrop-ai-style, .markdrop-floating-save, .markdrop-save-overlay, .markdrop-runtime-badge, .markdrop-ai-overlay-host",
    )
    .forEach((node) => node.remove());

  document.querySelectorAll<HTMLElement>("[data-markdrop-injected]").forEach((node) => {
    delete node.dataset.markdropInjected;
  });
}

async function boot(bootId: number): Promise<void> {
  const abortController = new AbortController();
  let aiButtonsCleanup: (() => void) | undefined;
  let directAiButtonsCleanup: (() => void) | undefined;
  const messageHandler = (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if ((message as { type?: string })?.type === "MARKDROP_DIAGNOSTIC") {
      sendResponse(getRuntimeDiagnostics());
      return false;
    }

    if ((message as { type?: string })?.type === "MARKDROP_CAPTURE_DEBUG") {
      sendResponse(getCaptureDebugPayload());
      return false;
    }

    if ((message as { type?: string })?.type === "MARKDROP_CONTEXT_MENU_SAVE") {
      const content = captureSelection(
        "context-menu",
        ((message as { selectionText?: string }).selectionText ?? ""),
      );
      if (content) {
        openSavePanel(content);
      }
    }

    return false;
  };

  state.cleanup = () => {
    abortController.abort();
    aiButtonsCleanup?.();
    directAiButtonsCleanup?.();
    try {
      chrome.runtime.onMessage.removeListener(messageHandler);
    } catch {
      // Ignore cleanup failures from an invalidated extension context.
    }
    activePanel?.remove();
    aiRuntimeBadge?.remove();
    activePanel = null;
    aiRuntimeBadge = null;
    cleanupStaleInjectedUi();
  };

  latestSettings = await getSettings();
  if (state.bootId !== bootId || abortController.signal.aborted) {
    return;
  }

  if (latestSettings.preferences.enableAiButtons) {
    if (usesDirectInlineAiButtons(location.hostname)) {
      directAiButtonsCleanup = installDirectAiSaveButtons(abortController.signal);
    } else {
      aiButtonsCleanup = installAiSaveButtons({
        captureAnswer,
        openSavePanel,
      });
    }
  }

  chrome.runtime.onMessage.addListener(messageHandler);
}

function installAiRuntimeBadge(signal: AbortSignal): void {
  if (!isSupportedAiHost(location.hostname)) {
    return;
  }

  aiRuntimeBadge?.remove();

  const host = document.createElement("div");
  host.className = "markdrop-runtime-badge";
  host.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: 72px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(360px, calc(100vw - 32px));
    border: 1px solid rgba(37, 99, 235, 0.28);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.96);
    color: #0f172a;
    padding: 7px 8px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
    font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: auto;
  `;

  const status = document.createElement("span");
  status.dataset.markdropStatus = "true";
  status.style.cssText = "white-space:nowrap;color:#334155;";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Save";
  button.title = "Save latest AI answer to Markdrop";
  button.style.cssText = `
    appearance: none;
    border: 0;
    border-radius: 6px;
    background: #2563eb;
    color: #ffffff;
    padding: 5px 9px;
    font: 600 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
  `;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const contentElement = findLatestAiContentElement() ?? findLargestVisibleContentBlock();
    if (!contentElement) {
      showToast(ct("content.noAiAnswer"), "error");
      return;
    }

    openSavePanel(captureAnswer(contentElement, platformNameForHost(location.hostname)));
  });

  host.append(status, button);
  document.documentElement.append(host);
  aiRuntimeBadge = host;

  const update = () => {
    if (signal.aborted || !aiRuntimeBadge) {
      return;
    }

    const settingsText = latestSettings ? (latestSettings.preferences.enableAiButtons ? "AI on" : "AI off") : "loading";
    status.textContent = `Markdrop ${settingsText} · ${countAiContentCandidates()} found`;
  };

  update();
  const intervalId = window.setInterval(update, 1200);
  signal.addEventListener(
    "abort",
    () => {
      window.clearInterval(intervalId);
      host.remove();
      if (aiRuntimeBadge === host) {
        aiRuntimeBadge = null;
      }
    },
    { once: true },
  );
}

function installDirectAiSaveButtons(signal: AbortSignal): () => void {
  if (!isSupportedAiHost(location.hostname)) {
    return () => undefined;
  }

  if (!document.body) {
    return installWhenBodyExists(() => installDirectAiSaveButtons(signal), signal);
  }

  let scheduled = false;
  let timerId: number | undefined;

  const scan = () => {
    scheduled = false;
    if (signal.aborted) {
      return;
    }

    renderDirectAiInlineButtons(selectDirectAiSaveTargets());
  };

  const schedule = () => {
    if (scheduled || signal.aborted) {
      return;
    }

    scheduled = true;
    timerId = window.setTimeout(scan, 200);
  };

  scan();

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("scroll", schedule, { passive: true, signal });
  window.addEventListener("resize", schedule, { signal });

  return () => {
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
    }
    observer.disconnect();
  };
}

function selectDirectAiSaveTargets(): Array<{ answerElement: HTMLElement; root: HTMLElement }> {
  const byRoot = new Map<HTMLElement, HTMLElement>();

  collectAiContentCandidates()
    .map(normalizeAiAnswerElement)
    .filter((node): node is HTMLElement => Boolean(node))
    .filter(
      (node) =>
        isCapturableAiContentCandidate(node) &&
        hasAnswerContentShape(node) &&
        !isClaudeIntermediateToolPreamble(node),
    )
    .forEach((node) => {
      const root = findAiMessageRoot(node);
      const existing = byRoot.get(root);
      if (!existing || directTargetScore(node) > directTargetScore(existing)) {
        byRoot.set(root, node);
      }
    });

  return chooseNonOverlappingDirectTargets(
    Array.from(byRoot.entries()).map(([root, answerElement]) => ({ answerElement, root })),
  );
}

function chooseNonOverlappingDirectTargets(
  targets: Array<{ answerElement: HTMLElement; root: HTMLElement }>,
): Array<{ answerElement: HTMLElement; root: HTMLElement }> {
  const chosen: Array<{ answerElement: HTMLElement; root: HTMLElement }> = [];

  targets
    .sort((left, right) => directTargetScore(right.answerElement) - directTargetScore(left.answerElement))
    .forEach((target) => {
      if (chosen.some((existing) => directTargetsOverlap(existing, target))) {
        return;
      }

      chosen.push(target);
    });

  return chosen.sort((left, right) => {
    if (left.root === right.root) {
      return 0;
    }

    return left.root.compareDocumentPosition(right.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

function directTargetsOverlap(
  left: { answerElement: HTMLElement; root: HTMLElement },
  right: { answerElement: HTMLElement; root: HTMLElement },
): boolean {
  return (
    left.root === right.root ||
    left.root.contains(right.root) ||
    right.root.contains(left.root) ||
    left.answerElement === right.answerElement ||
    left.answerElement.contains(right.answerElement) ||
    right.answerElement.contains(left.answerElement)
  );
}

function renderDirectAiInlineButtons(targets: Array<{ answerElement: HTMLElement; root: HTMLElement }>): void {
  removeStaleDirectSaveHosts(targets);

  targets.forEach((target) => {
    ensureDirectAiSaveButton(target);
  });
}

function removeStaleDirectSaveHosts(targets: Array<{ answerElement: HTMLElement; root: HTMLElement }>): void {
  document.querySelectorAll<HTMLElement>(".markdrop-ai-direct-host").forEach((host) => {
    const previous = host.previousElementSibling;
    const stillValid = targets.some((target) => previous === target.answerElement || previous === target.root);
    if (!stillValid) {
      host.remove();
    }
  });
}

function ensureDirectAiSaveButton(target: { answerElement: HTMLElement; root: HTMLElement }): void {
  if (!target.root.isConnected || !target.answerElement.isConnected || findExistingDirectSaveButton(target)) {
    return;
  }

  const host = document.createElement("div");
  host.className = "markdrop-ai-host markdrop-ai-direct-host";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "markdrop-ai-save markdrop-ai-direct-save";
  button.textContent = "Save";
  button.title = "Save this answer to Markdrop";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const currentAnswer = target.answerElement.isConnected
      ? target.answerElement
      : normalizeAiAnswerElement(target.root) ?? target.root;
    openSavePanel(captureAnswer(currentAnswer, platformNameForHost(location.hostname)));
  });

  host.append(button);
  placeDirectSaveHost(target, host);
  ensureAiButtonStyle();
}

function findExistingDirectSaveButton(target: { answerElement: HTMLElement; root: HTMLElement }): Element | null {
  removeMisplacedRootSaveHost(target);

  const hosts = collectNearbySaveHosts(target);
  const directHost = hosts.find((host) => host.classList.contains("markdrop-ai-direct-host"));

  if (directHost) {
    hosts.forEach((host) => {
      if (host !== directHost) {
        host.remove();
      }
    });
    if (target.answerElement.nextElementSibling !== directHost) {
      placeDirectSaveHost(target, directHost);
    }
    return directHost.querySelector(".markdrop-ai-save");
  }

  hosts.forEach((host) => host.remove());
  return null;
}

function collectNearbySaveHosts(target: { answerElement: HTMLElement; root: HTMLElement }): HTMLElement[] {
  const hosts = new Set<HTMLElement>();
  const add = (node: Element | null) => {
    if (node instanceof HTMLElement && node.classList.contains("markdrop-ai-host") && node.isConnected) {
      hosts.add(node);
    }
  };

  let next = target.answerElement.nextElementSibling;
  while (next instanceof HTMLElement && next.classList.contains("markdrop-ai-host")) {
    add(next);
    next = next.nextElementSibling;
  }

  add(target.root.nextElementSibling);
  target.root.querySelectorAll<HTMLElement>(".markdrop-ai-host").forEach(add);

  return [...hosts];
}

function removeMisplacedRootSaveHost(target: { answerElement: HTMLElement; root: HTMLElement }): void {
  if (target.root === target.answerElement) {
    return;
  }

  const next = target.root.nextElementSibling;
  if (next instanceof HTMLElement && next.classList.contains("markdrop-ai-direct-host")) {
    next.remove();
  }
}

function placeDirectSaveHost(target: { answerElement: HTMLElement; root: HTMLElement }, host: HTMLElement): void {
  const answerParent = target.answerElement.parentElement;
  if (answerParent) {
    answerParent.insertBefore(host, target.answerElement.nextSibling);
    return;
  }

  const rootParent = target.root.parentElement;
  if (rootParent && target.root !== document.body && target.root !== document.documentElement) {
    rootParent.insertBefore(host, target.root.nextSibling);
    return;
  }

  document.body?.append(host);
}

function installWhenBodyExists(installer: () => () => void, signal: AbortSignal): () => void {
  let cleanup: (() => void) | undefined;
  const observer = new MutationObserver(() => {
    if (signal.aborted || cleanup || !document.body) {
      return;
    }

    observer.disconnect();
    cleanup = installer();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  if (document.body && !signal.aborted) {
    observer.disconnect();
    cleanup = installer();
  }

  return () => {
    observer.disconnect();
    cleanup?.();
  };
}

function normalizeAiAnswerElement(node: HTMLElement): HTMLElement | null {
  if (node.closest(".markdrop-ai-host, .markdrop-runtime-badge, .markdrop-save-overlay")) {
    return null;
  }

  if (isDeepSeekHost(location.hostname)) {
    return normalizeDeepSeekAnswerElement(node);
  }

  if (isTongyiHost(location.hostname)) {
    return normalizeTongyiAnswerElement(node);
  }

  return (
    node.querySelector<HTMLElement>(
      [
        '[data-testid="markdown"]',
        ".markdown",
        '[class*="ds-markdown"]',
        '[class*="markdown"]',
        "message-content",
        ".font-claude-message",
        '[class*="font-claude-message"]',
        '[class*="response-content"]',
        '[class*="model-response-text"]',
        '[class*="prose"]',
      ].join(", "),
    ) ?? node
  );
}

function normalizeTongyiAnswerElement(node: HTMLElement): HTMLElement | null {
  const seed =
    node.closest<HTMLElement>(
      [
        '[data-testid*="assistant"]',
        '[data-testid*="message"]',
        '[class*="qwen"]',
        '[class*="tongyi"]',
        '[class*="qianwen"]',
        '[class*="markdown"]',
        '[class*="prose"]',
        '[class*="answer"]',
        '[class*="response"]',
        '[class*="message-content"]',
        '[class*="chat-content"]',
      ].join(", "),
    ) ?? node;

  const answer = findTongyiWholeAnswerContainer(seed) ?? findTongyiFallbackContainer(seed);
  return answer && !isLikelyThinkingContent(answer) ? answer : null;
}

function findTongyiWholeAnswerContainer(seed: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = seed;
  let depth = 0;

  while (current && current !== document.body && current !== document.documentElement && depth < 10) {
    if (current.matches("main, [role='main']")) {
      break;
    }

    if (isTongyiWholeAnswerCandidate(current)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function findTongyiFallbackContainer(seed: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = seed;
  let depth = 0;

  while (current && current !== document.body && current !== document.documentElement && depth < 5) {
    if (current.matches("main, [role='main']")) {
      return null;
    }

    if (!isLeafContentBlock(current) && hasAnswerContentShape(current) && !isLikelyThinkingContent(current)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function isTongyiWholeAnswerCandidate(node: HTMLElement): boolean {
  if (isLeafContentBlock(node)) {
    return false;
  }

  const text = compactElementText(node);
  if (text.length < 20 || isThinkingLeadText(text.slice(0, 160))) {
    return false;
  }

  const label = elementLabel(node);
  if (label.includes("user") || label.includes("human") || label.includes("composer") || label.includes("prompt") || label.includes("toolbar")) {
    return false;
  }

  const hasAnswerHint =
    label.includes("markdown") ||
    label.includes("prose") ||
    label.includes("answer") ||
    label.includes("response") ||
    label.includes("assistant") ||
    label.includes("qwen") ||
    label.includes("tongyi") ||
    label.includes("qianwen") ||
    Boolean(
      node.querySelector(
        [
          '[class*="markdown"]',
          '[class*="prose"]',
          '[class*="answer"]',
          '[class*="response"]',
          '[data-testid*="assistant"]',
        ].join(", "),
      ),
    );

  if (!hasAnswerHint) {
    return false;
  }

  const blockCount = node.querySelectorAll("h1, h2, h3, h4, p, blockquote, pre, ol, ul, table, li").length;
  const hasHeading = Boolean(node.querySelector("h1, h2, h3"));
  return hasHeading || blockCount >= 2 || text.length >= 220;
}

function normalizeDeepSeekAnswerElement(node: HTMLElement): HTMLElement | null {
  const seed =
    node.closest<HTMLElement>(
      [
        '[class*="ds-markdown"]',
        '[class*="markdown"]',
        '[class*="prose"]',
        '[class*="answer"]',
        '[class*="response"]',
      ].join(", "),
    ) ?? node;

  if (isDeepSeekReasoningRegion(seed)) {
    return null;
  }

  const answer = findDeepSeekWholeAnswerContainer(seed) ?? findDeepSeekFallbackContainer(seed);
  return answer && !isDeepSeekReasoningRegion(answer) ? answer : null;
}

function findDeepSeekWholeAnswerContainer(seed: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = seed;
  let depth = 0;

  while (current && current !== document.body && current !== document.documentElement && depth < 10) {
    if (current.matches("main, [role='main']")) {
      break;
    }

    if (isDeepSeekWholeAnswerCandidate(current)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function findDeepSeekFallbackContainer(seed: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = seed;
  let depth = 0;

  while (current && current !== document.body && current !== document.documentElement && depth < 5) {
    if (current.matches("main, [role='main']")) {
      return null;
    }

    if (!isLeafContentBlock(current) && hasAnswerContentShape(current) && !isThinkingLeadText(compactElementText(current).slice(0, 160))) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function isDeepSeekWholeAnswerCandidate(node: HTMLElement): boolean {
  if (isLeafContentBlock(node)) {
    return false;
  }

  const text = compactElementText(node);
  if (text.length < 20 || isThinkingLeadText(text.slice(0, 160)) || containsDeepSeekThinkingMarker(node)) {
    return false;
  }

  const label = [
    node.tagName,
    node.id,
    node.getAttribute("data-testid"),
    node.getAttribute("data-role"),
    node.getAttribute("aria-label"),
    node.getAttribute("role"),
    node.className.toString(),
  ]
    .join(" ")
    .toLowerCase();

  if (label.includes("composer") || label.includes("prompt") || label.includes("input") || label.includes("toolbar")) {
    return false;
  }

  const blockCount = node.querySelectorAll("h1, h2, h3, h4, p, blockquote, pre, ol, ul, table, li").length;
  const hasHeading = Boolean(node.querySelector("h1, h2, h3"));
  return hasHeading || blockCount >= 3 || text.length >= 500;
}

function isLeafContentBlock(node: HTMLElement): boolean {
  return node.matches("p, li, h1, h2, h3, h4, h5, h6, blockquote");
}

function findAiMessageRoot(node: HTMLElement): HTMLElement {
  if (isDeepSeekHost(location.hostname) || isTongyiHost(location.hostname)) {
    return node;
  }

  return (
    node.closest<HTMLElement>(
      [
        '[data-message-author-role="assistant"]',
        '[data-testid*="assistant"]',
        '[data-testid*="conversation-turn"]',
        '[data-testid*="message"]',
        "[data-turn-id]",
        "model-response",
        '[class*="model-response"]',
        '[class*="response-container"]',
        '[class*="ds-markdown"]',
        ".font-claude-message",
        '[class*="font-claude-message"]',
        "article",
      ].join(", "),
    ) ?? node
  );
}

function hasAnswerContentShape(node: HTMLElement): boolean {
  const textLength = node.textContent?.trim().length ?? 0;
  return textLength >= 12;
}

function directTargetScore(node: HTMLElement): number {
  let score = 0;
  const label = [
    node.getAttribute("data-testid"),
    node.className.toString(),
    node.tagName,
  ]
    .join(" ")
    .toLowerCase();

  if (
    label.includes("markdown") ||
    label.includes("ds-markdown") ||
    label.includes("font-claude-message") ||
    node.matches("message-content")
  ) {
    score += 1000;
  }

  if (label.includes("response") || label.includes("assistant")) {
    score += 300;
  }

  if (label.includes("prose")) {
    score += 160;
  }

  score += Math.min(node.textContent?.trim().length ?? 0, 2000) / 10;
  score += node.querySelectorAll("p, pre, code, ol, ul, table, h1, h2, h3").length * 20;
  return score;
}

function getRuntimeDiagnostics(): Record<string, unknown> {
  return {
    ok: true,
    buildId: MARKDROP_BUILD_ID,
    url: location.href,
    hostname: location.hostname,
    aiHost: isSupportedAiHost(location.hostname),
    aiButtonsEnabled: Boolean(latestSettings?.preferences.enableAiButtons),
    settingsLoaded: Boolean(latestSettings),
    candidateCount: countAiContentCandidates(),
    directTargetCount: selectDirectAiSaveTargets().length,
    visibleCandidateCount: collectAiContentCandidates().filter(isCapturableAiContentCandidate).length,
    saveButtonCount: document.querySelectorAll(".markdrop-ai-save").length,
    directSaveButtonCount: document.querySelectorAll(".markdrop-ai-direct-save").length,
    runtimeBadge: Boolean(document.querySelector(".markdrop-runtime-badge")),
    bootId: state.bootId,
  };
}

function getCaptureDebugPayload(): Record<string, unknown> {
  const contentElement = findLatestCapturableAiAnswerElement();
  if (!contentElement) {
    return {
      ok: false,
      error: "No capturable AI answer found on this page.",
      diagnostics: getRuntimeDiagnostics(),
    };
  }

  const platformName = platformNameForHost(location.hostname);
  const content = captureAnswer(contentElement, platformName);

  return {
    ok: true,
    url: location.href,
    hostname: location.hostname,
    platformName,
    title: content.title,
    textLength: content.text.length,
    htmlLength: content.html.length,
    markdownLength: content.markdown.length,
    markdown: content.markdown,
    notionBlockPreview: summarizeNotionBlocks(markdownToNotionBlocks(content.markdown)),
    doubaoMathDebug: isDoubaoHost(location.hostname) ? collectDoubaoMathDebug(contentElement) : undefined,
    htmlPreview: content.html.slice(0, 8000),
    htmlTailPreview: content.html.slice(-8000),
    diagnostics: getRuntimeDiagnostics(),
  };
}

function summarizeNotionBlocks(blocks: NotionBlock[]): unknown[] {
  return blocks.slice(0, 80).map(summarizeNotionBlock);
}

function summarizeNotionBlock(block: NotionBlock): Record<string, unknown> {
  const value = block[block.type] as { rich_text?: unknown[]; checked?: boolean; children?: NotionBlock[] } | undefined;
  return {
    type: block.type,
    text: summarizeRichText(value?.rich_text),
    checked: value?.checked,
    children: value?.children?.slice(0, 20).map(summarizeNotionBlock),
  };
}

function summarizeRichText(richText: unknown[] | undefined): string {
  if (!Array.isArray(richText)) {
    return "";
  }

  return richText
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const richTextItem = item as { type?: string; text?: { content?: string }; equation?: { expression?: string } };
      if (richTextItem.type === "equation") {
        return richTextItem.equation?.expression ?? "";
      }

      return richTextItem.text?.content ?? "";
    })
    .join("")
    .slice(0, 160);
}

function isSupportedAiHost(hostname: string): boolean {
  return (
    usesDirectInlineAiButtons(hostname) ||
    hostname === "claude.ai" ||
    hostname.endsWith(".claude.ai") ||
    hostname.includes("doubao.com") ||
    hostname.includes("deepseek.com") ||
    isTongyiHost(hostname)
  );
}

function usesDirectInlineAiButtons(hostname: string): boolean {
  return (
    isChatGptHost(hostname) ||
    hostname === "claude.ai" ||
    hostname.endsWith(".claude.ai") ||
    hostname === "gemini.google.com" ||
    hostname.endsWith(".gemini.google.com") ||
    hostname === "aistudio.google.com" ||
    hostname.endsWith(".aistudio.google.com") ||
    isDeepSeekHost(hostname) ||
    isTongyiHost(hostname)
  );
}

function isChatGptHost(hostname: string): boolean {
  return hostname === "chat.openai.com" || hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com");
}

function isDeepSeekHost(hostname: string): boolean {
  return hostname === "chat.deepseek.com" || hostname.endsWith(".deepseek.com");
}

function isTongyiHost(hostname: string): boolean {
  return (
    hostname === "tongyi.aliyun.com" ||
    hostname.endsWith(".tongyi.aliyun.com") ||
    hostname === "qianwen.aliyun.com" ||
    hostname.endsWith(".qianwen.aliyun.com") ||
    hostname === "qianwen.com" ||
    hostname.endsWith(".qianwen.com") ||
    hostname === "chat.qwen.ai" ||
    hostname.endsWith(".qwen.ai") ||
    hostname === "tongyi.com" ||
    hostname.endsWith(".tongyi.com") ||
    hostname.includes("qwen")
  );
}

function isDoubaoHost(hostname: string): boolean {
  return hostname === "www.doubao.com" || hostname === "doubao.com" || hostname.endsWith(".doubao.com");
}

function isClaudeHost(hostname: string): boolean {
  return hostname === "claude.ai" || hostname.endsWith(".claude.ai");
}

function platformNameForHost(hostname: string): string {
  if (hostname === "gemini.google.com" || hostname.endsWith(".gemini.google.com") || hostname.includes("aistudio")) {
    return "Gemini";
  }

  if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
    return "Claude";
  }

  if (hostname === "www.doubao.com" || hostname === "doubao.com" || hostname.endsWith(".doubao.com")) {
    return "Doubao";
  }

  if (hostname === "chat.deepseek.com" || hostname.endsWith(".deepseek.com")) {
    return "DeepSeek";
  }

  if (
    hostname === "tongyi.aliyun.com" ||
    hostname.endsWith(".tongyi.aliyun.com") ||
    hostname === "qianwen.aliyun.com" ||
    hostname.endsWith(".qianwen.aliyun.com") ||
    hostname === "qianwen.com" ||
    hostname.endsWith(".qianwen.com") ||
    hostname === "chat.qwen.ai" ||
    hostname.endsWith(".qwen.ai") ||
    hostname === "tongyi.com" ||
    hostname.endsWith(".tongyi.com") ||
    hostname.includes("qwen")
  ) {
    return "Qianwen";
  }

  return "ChatGPT";
}

function countAiContentCandidates(): number {
  return collectAiContentCandidates().filter(isCapturableAiContentCandidate).length;
}

function findLatestAiContentElement(): HTMLElement | null {
  const candidates = collectAiContentCandidates().filter(isCapturableAiContentCandidate);
  return candidates[candidates.length - 1] ?? null;
}

function findLatestCapturableAiAnswerElement(): HTMLElement | null {
  const directTargets = selectDirectAiSaveTargets().filter(
    (target) => target.answerElement.isConnected && isVisible(target.answerElement),
  );

  return directTargets[directTargets.length - 1]?.answerElement ?? findLatestAiContentElement() ?? findLargestVisibleContentBlock();
}

function collectAiContentCandidates(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        '[data-message-author-role="assistant"] [data-testid="markdown"]',
        '[data-message-author-role="assistant"] .markdown',
        '[data-message-author-role="assistant"] [class*="markdown"]',
        '[data-message-author-role="assistant"]',
        '[data-testid="markdown"]',
        ".markdown",
        '[class*="ds-markdown"]',
        '[class*="qwen"] [class*="markdown"]',
        '[class*="tongyi"] [class*="markdown"]',
        '[class*="qianwen"] [class*="markdown"]',
        '[class*="qwen"] [class*="prose"]',
        '[class*="tongyi"] [class*="prose"]',
        '[class*="qianwen"] [class*="prose"]',
        '[class*="markdown"]',
        "div.font-claude-message",
        '[class*="font-claude-message"]',
        '[data-testid*="assistant"]',
        '[data-testid*="message"] [class*="prose"]',
        '[class*="assistant"] [class*="prose"]',
        '[class*="prose"]',
        "model-response message-content",
        "model-response",
        "message-content",
        '[class*="model-response"]',
        '[class*="response-container"]',
        '[class*="response-content"]',
        "main article",
        "article",
      ].join(", "),
    ),
  );
}

function isCapturableAiContentCandidate(node: HTMLElement): boolean {
  if (isLikelyUserContent(node) || isDeepSeekReasoningRegion(node) || !isVisible(node)) {
    return false;
  }

  if (isLikelyThinkingContent(node) && !isChatGptAnswerWithThinkingLead(node)) {
    return false;
  }

  return true;
}

function isClaudeIntermediateToolPreamble(node: HTMLElement): boolean {
  if (!isClaudeHost(location.hostname)) {
    return false;
  }

  const text = compactElementText(node);
  if (text.length < 8 || text.length > 320) {
    return false;
  }

  if (node.querySelector("h1, h2, h3, h4, pre, table, ol, ul")) {
    return false;
  }

  return hasClaudeToolActivityAfter(node);
}

function hasClaudeToolActivityAfter(node: HTMLElement): boolean {
  let anchor: HTMLElement | null = node;
  let depth = 0;

  while (anchor && anchor !== document.body && anchor !== document.documentElement && depth < 5) {
    let sibling = anchor.nextElementSibling;
    let siblingCount = 0;

    while (sibling instanceof HTMLElement && siblingCount < 8) {
      if (sibling.classList.contains("markdrop-ai-host")) {
        sibling = sibling.nextElementSibling;
        siblingCount += 1;
        continue;
      }

      if (isClaudeToolActivityNode(sibling)) {
        return true;
      }

      const siblingText = compactElementText(sibling);
      if (siblingText.length > 80 && hasAnswerContentShape(sibling)) {
        break;
      }

      sibling = sibling.nextElementSibling;
      siblingCount += 1;
    }

    anchor = anchor.parentElement;
    depth += 1;
  }

  return false;
}

function isClaudeToolActivityNode(node: HTMLElement): boolean {
  const text = compactElementText(node).slice(0, 260);
  const label = elementLabel(node);

  if (
    /\b(?:created|read|edited|updated|wrote|saved|opened|generated|ran|called)\b[\s\S]{0,120}\b(?:file|document|tool|artifact|command)\b/i.test(
      text,
    ) ||
    /(?:创建|读取|编辑|更新|写入|保存|打开|生成|运行|调用)[\s\S]{0,80}(?:文件|文档|工具|命令)/.test(text)
  ) {
    return true;
  }

  return (
    /\b(?:tool|artifact|file|attachment|operation)\b/.test(label) &&
    text.length > 0 &&
    text.length <= 220 &&
    !node.querySelector("h1, h2, h3, h4, pre, table, ol, ul")
  );
}

function isChatGptAnswerWithThinkingLead(node: HTMLElement): boolean {
  if (!isChatGptHost(location.hostname)) {
    return false;
  }

  const text = compactElementText(node);
  if (text.length < 80) {
    return false;
  }

  const contentBlocks = collectMeaningfulAnswerBlocks(node);
  if (contentBlocks.length >= 2) {
    return true;
  }

  const textWithoutThinkingLead = text.replace(/^(?:thought|thinking|reasoning)\s*(?:for)?\s*\d*\s*\w*\s*[›>：:]?\s*/i, "").trim();
  return textWithoutThinkingLead.length >= 60;
}

function collectMeaningfulAnswerBlocks(node: HTMLElement): HTMLElement[] {
  const blockSelector = "h1, h2, h3, h4, p, li, blockquote, pre, table";
  const blocks = [
    ...(node.matches(blockSelector) ? [node] : []),
    ...Array.from(node.querySelectorAll<HTMLElement>(blockSelector)),
  ];

  return blocks.filter((block) => {
    if (block.closest(".markdrop-ai-host, .markdrop-save-overlay")) {
      return false;
    }

    const text = compactElementText(block);
    return text.length >= 8 && !isThinkingLeadText(text.slice(0, 160));
  });
}

function isLikelyUserContent(node: HTMLElement): boolean {
  const role = node.closest<HTMLElement>("[data-message-author-role]")?.getAttribute("data-message-author-role");
  if (role === "user") {
    return true;
  }

  const label = [
    node.tagName,
    node.id,
    node.getAttribute("data-testid"),
    node.getAttribute("data-role"),
    node.getAttribute("aria-label"),
    node.getAttribute("role"),
    node.className.toString(),
    node.closest<HTMLElement>("[data-testid]")?.getAttribute("data-testid"),
  ]
    .join(" ")
    .toLowerCase();

  return label.includes("user") || label.includes("human") || label.includes("composer") || label.includes("prompt");
}

function isLikelyThinkingContent(node: HTMLElement): boolean {
  const label = elementLabel(node);

  if (/\b(?:thinking|reasoning|thought|think|deepthink|deep-think|chain-of-thought|chain_of_thought|cot|reasoner)\b/.test(label)) {
    return true;
  }

  const text = compactElementText(node).slice(0, 160);
  if (isThinkingLeadText(text)) {
    return true;
  }

  return hasCompactThinkingHeaderNear(node);
}

function hasCompactThinkingHeaderNear(node: HTMLElement): boolean {
  let current: HTMLElement | null = node;
  let depth = 0;

  while (current && current !== document.body && depth < 3) {
    const previous = current.previousElementSibling;
    if (previous instanceof HTMLElement && compactElementText(previous).length <= 120 && isThinkingLeadText(compactElementText(previous))) {
      return true;
    }

    current = current.parentElement;
    depth += 1;
  }

  return false;
}

function isDeepSeekReasoningRegion(node: HTMLElement): boolean {
  if (!isDeepSeekHost(location.hostname)) {
    return false;
  }

  if (containsDeepSeekThinkingMarker(node)) {
    return true;
  }

  if (node.matches("h1, h2, h3") || node.querySelector("h1, h2, h3")) {
    return false;
  }

  return hasDeepSeekThinkingMarkerBefore(node) && isBeforeDeepSeekFinalHeading(node);
}

function hasDeepSeekThinkingMarkerBefore(node: HTMLElement): boolean {
  let current: HTMLElement | null = node;
  let depth = 0;

  while (current && current !== document.body && current !== document.documentElement && depth < 8) {
    let previous = current.previousElementSibling;
    let siblingCount = 0;

    while (previous instanceof HTMLElement && siblingCount < 10) {
      if (containsDeepSeekThinkingMarker(previous)) {
        return true;
      }

      previous = previous.previousElementSibling;
      siblingCount += 1;
    }

    current = current.parentElement;
    depth += 1;
  }

  return false;
}

function isBeforeDeepSeekFinalHeading(node: HTMLElement): boolean {
  const nodeRect = node.getBoundingClientRect();

  return Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3")).some((heading) => {
    if (node === heading || node.contains(heading) || isThinkingLeadText(compactElementText(heading).slice(0, 160))) {
      return false;
    }

    const position = node.compareDocumentPosition(heading);
    if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) {
      return false;
    }

    const headingRect = heading.getBoundingClientRect();
    if (headingRect.width <= 0 || headingRect.height <= 0) {
      return false;
    }

    if (nodeRect.width > 0 || nodeRect.height > 0) {
      const verticalDistance = headingRect.top - nodeRect.bottom;
      return verticalDistance > -16 && verticalDistance < 1600;
    }

    return true;
  });
}

function containsDeepSeekThinkingMarker(node: HTMLElement): boolean {
  const label = [
    node.tagName,
    node.id,
    node.getAttribute("data-testid"),
    node.getAttribute("data-role"),
    node.getAttribute("aria-label"),
    node.getAttribute("role"),
    node.className.toString(),
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(?:thinking|reasoning|thought|deepthink|deep-think|chain-of-thought|chain_of_thought|cot|reasoner)\b/.test(label)) {
    return true;
  }

  const text = compactElementText(node).slice(0, 260);
  return /(?:\u5df2\u601d\u8003|\u601d\u8003\s*[\uff08(]?\u7528\u65f6|\u63a8\u7406\u8fc7\u7a0b|thinking\b|reasoning\b|thought\b)/i.test(
    text,
  );
}

function isThinkingLeadText(text: string): boolean {
  return /^(?:\u5df2\u601d\u8003|\u601d\u8003|\u63a8\u7406|thinking\b|reasoning\b|thought\b)/i.test(text.trim());
}

function compactElementText(node: HTMLElement): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
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
  ]
    .join(" ")
    .toLowerCase();
}

function findLargestVisibleContentBlock(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("main article, main section, article, [role='main'], main"),
  ).filter((node) => isCapturableAiContentCandidate(node) && (node.textContent?.trim().length ?? 0) >= 12);

  return candidates.sort((left, right) => contentScore(right) - contentScore(left))[0] ?? null;
}

function contentScore(node: HTMLElement): number {
  const textLength = node.textContent?.trim().length ?? 0;
  const contentBlocks = node.querySelectorAll("p, pre, code, ol, ul, table, h1, h2, h3").length;
  return textLength + contentBlocks * 200;
}

function isVisible(node: HTMLElement): boolean {
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function captureSelection(
  sourceType: CapturedContent["sourceType"],
  textFallback = "",
): CapturedContent | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim() || textFallback.trim();

  if (!text) {
    showToast(ct("content.noSelection"), "error");
    return null;
  }

  let html = "";
  const aiPlatformName = isSupportedAiHost(location.hostname) ? platformNameForHost(location.hostname) : "";
  let answerElement: HTMLElement | null = null;
  let capturedElement: HTMLElement | null = null;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const selectionElement = rangeContainerElement(range);
    answerElement = aiPlatformName && selectionElement ? findContainingAiAnswerElement(selectionElement) : null;

    const wrapper = document.createElement("div");
    wrapper.append(range.cloneContents());
    if (aiPlatformName) {
      preservePlatformMath(wrapper, aiPlatformName);
    }
    sanitizeCapturedClone(wrapper);
    capturedElement = wrapper;
    html = wrapper.innerHTML;
  }

  const rawMarkdown = htmlToMarkdown(html, text);
  const markdown = aiPlatformName ? normalizeCapturedMarkdown(rawMarkdown, aiPlatformName) : rawMarkdown;
  const titleBase = aiPlatformName
    ? resolveCaptureTitleBase(aiPlatformName, {
        answerElement,
        capturedElement,
        markdown,
      })
    : resolvePageSelectionTitleBase({
        capturedElement,
        markdown,
      });
  const content: CapturedContent = {
    html,
    text,
    markdown,
    title: buildTitle(titleBase),
    sourceUrl: location.href,
    sourceType,
  };

  if (aiPlatformName) {
    content.platformName = aiPlatformName;
  }

  return content;
}

function captureAnswer(element: HTMLElement, platformName: string): CapturedContent {
  const clone = element.cloneNode(true) as HTMLElement;
  preservePlatformMath(clone, platformName);
  sanitizeCapturedClone(clone);

  const markdown = normalizeCapturedMarkdown(htmlToMarkdown(clone.innerHTML, clone.textContent ?? ""), platformName);
  const title = buildTitle(resolveCaptureTitleBase(platformName, {
    answerElement: element,
    capturedElement: clone,
    markdown,
  }));
  return {
    html: clone.innerHTML,
    text: clone.textContent?.trim() ?? "",
    markdown,
    title,
    sourceUrl: location.href,
    sourceType: "ai-answer",
    platformName,
  };
}

function rangeContainerElement(range: Range): HTMLElement | null {
  const common = nodeToElement(range.commonAncestorContainer);
  if (common && !["BODY", "HTML"].includes(common.tagName)) {
    return common;
  }

  return nodeToElement(range.startContainer) ?? nodeToElement(range.endContainer);
}

function nodeToElement(node: Node): HTMLElement | null {
  return node instanceof HTMLElement ? node : node.parentElement;
}

function findContainingAiAnswerElement(element: HTMLElement): HTMLElement | null {
  const root = findAiMessageRoot(element);
  return normalizeAiAnswerElement(root) ?? normalizeAiAnswerElement(element) ?? root;
}

function resolveCaptureTitleBase(
  platformName: string,
  sources: {
    answerElement?: HTMLElement | null;
    capturedElement?: HTMLElement | null;
    markdown?: string;
  },
): string {
  const answerTitle =
    extractAnswerTitleFromElement(sources.answerElement) ||
    extractAnswerTitleFromElement(sources.capturedElement) ||
    extractAnswerTitleFromMarkdown(sources.markdown ?? "");

  if (!answerTitle) {
    return ct("content.answerTitle", { platform: platformName });
  }

  return titleAlreadyMentionsPlatform(answerTitle, platformName) ? answerTitle : `${answerTitle} - ${platformName}`;
}

function resolvePageSelectionTitleBase(sources: {
  capturedElement?: HTMLElement | null;
  markdown?: string;
}): string {
  const selectionTitle =
    extractAnswerTitleFromElement(sources.capturedElement) ||
    extractAnswerTitleFromMarkdown(sources.markdown ?? "");

  if (selectionTitle) {
    return selectionTitle;
  }

  const pageTitle = cleanupAnswerTitle(document.title || "");
  return pageTitle.length >= 2 ? pageTitle : "Selection";
}

function extractAnswerTitleFromElement(element?: HTMLElement | null): string {
  if (!element) {
    return "";
  }

  const headings = Array.from(
    element.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, [role='heading']"),
  );

  for (const heading of headings) {
    if (heading.closest("pre, code, table, .markdrop-ai-host, .markdrop-save-overlay")) {
      continue;
    }

    const title = cleanupAnswerTitle(heading.textContent ?? "");
    if (isUsableAnswerTitle(title)) {
      return title;
    }
  }

  return "";
}

function extractAnswerTitleFromMarkdown(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }

    const title = cleanupAnswerTitle(match[1]);
    if (isUsableAnswerTitle(title)) {
      return title;
    }
  }

  return "";
}

function cleanupAnswerTitle(title: string): string {
  return title
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function isUsableAnswerTitle(title: string): boolean {
  if (title.length < 2) {
    return false;
  }

  return !/^(?:source|copy|复制|编辑|下载|运行|python|javascript|typescript|java|bash|shell|sql|text|代码块|表格)$/i.test(title);
}

function titleAlreadyMentionsPlatform(title: string, platformName: string): boolean {
  const normalizedTitle = title.toLowerCase();
  const normalizedPlatform = platformName.toLowerCase();
  return normalizedPlatform ? normalizedTitle.includes(normalizedPlatform) : false;
}

function normalizeCapturedMarkdown(markdown: string, platformName: string): string {
  if (!isTongyiHost(location.hostname) && !platformName.includes("千问")) {
    return markdown;
  }

  return markdown.replace(
    /(^|\n)```([a-z0-9+#.-]*)\s*\n([\s\S]*?)\n```/gi,
    (match, prefix: string, language: string, code: string) => {
      const cleaned = cleanCodeBlockText(code);
      return cleaned === code ? match : `${prefix}\`\`\`${language}\n${cleaned}\n\`\`\``;
    },
  );
}

function preservePlatformMath(clone: HTMLElement, platformName: string): void {
  const mathSource = platformMathSource(platformName);
  if (mathSource === "none") {
    return;
  }

  const candidates = Array.from(clone.querySelectorAll<HTMLElement>(platformMathSelector(mathSource)))
    .filter((node) => !node.closest("table"))
    .filter((node) => isTopLevelPlatformMathCandidate(node, clone, mathSource));

  candidates.forEach((node) => {
    const expression = extractPlatformMathExpression(node, mathSource);
    if (!expression) {
      return;
    }

    const isDisplay = isDisplayPlatformMath(node);
    const replacement = document.createElement(isDisplay ? "div" : "span");
    replacement.className = isDisplay ? "math-block markdrop-preserved-math" : "math-inline markdrop-preserved-math";
    replacement.setAttribute("data-math", expression);
    replacement.setAttribute("data-markdrop-math", isDisplay ? "block" : "inline");
    replacement.textContent = expression;
    node.replaceWith(replacement);
  });
}

type PlatformMathSource = "gemini" | "doubao" | "none";

function platformMathSource(platformName: string): PlatformMathSource {
  const name = platformName.toLowerCase();
  const hostname = location.hostname.toLowerCase();

  if (isDoubaoHost(hostname) || name.includes("豆包")) {
    return "doubao";
  }

  if (
    name.includes("gemini") ||
    hostname === "gemini.google.com" ||
    hostname.endsWith(".gemini.google.com") ||
    hostname.includes("aistudio.google.com")
  ) {
    return "gemini";
  }

  return "none";
}

function shouldPreservePlatformMath(platformName: string): boolean {
  const name = platformName.toLowerCase();
  const hostname = location.hostname.toLowerCase();
  return (
    name.includes("gemini") ||
    name.includes("豆包") ||
    hostname === "gemini.google.com" ||
    hostname.endsWith(".gemini.google.com") ||
    hostname.includes("aistudio.google.com") ||
    hostname === "www.doubao.com" ||
    hostname === "doubao.com" ||
    hostname.endsWith(".doubao.com")
  );
}

function isTopLevelPlatformMathCandidate(node: HTMLElement, root: HTMLElement, mathSource: PlatformMathSource): boolean {
  const expression = extractPlatformMathExpression(node, mathSource);
  if (!expression) {
    return false;
  }

  return !Array.from(root.querySelectorAll<HTMLElement>(platformMathSelector(mathSource))).some(
    (other) =>
      other !== node &&
      other.contains(node) &&
      extractPlatformMathExpression(other, mathSource) &&
      platformMathScore(extractPlatformMathExpression(other, mathSource)) >= platformMathScore(expression),
  );
}

function platformMathSelector(mathSource: PlatformMathSource = "gemini"): string {
  const baseSelectors = [
    ".math-block[data-math]",
    ".katex-display",
    ".katex",
    ".katex-mathml",
    "mjx-container",
    "mjx-assistive-mml",
    "math",
    "[data-tex]",
    "[data-latex]",
    "[data-math]",
    "[data-formula]",
    "[data-expression]",
    "[data-original-tex]",
  ];

  if (mathSource !== "doubao") {
    return baseSelectors.join(",");
  }

  return [
    ...baseSelectors,
    "[class*='math']",
    "[class*='Math']",
    "[class*='latex']",
    "[class*='Latex']",
    "[class*='formula']",
    "[class*='Formula']",
    "[class*='tex']",
    "[class*='Tex']",
    "[copy-text]",
    "[data-clipboard-text]",
    "[data-copy]",
    "[data-content]",
    "[data-value]",
    "img[alt]",
    "svg[aria-label]",
  ].join(",");
}

function extractPlatformMathExpression(node: Element, mathSource: PlatformMathSource = "gemini"): string {
  const candidates = [
    mathSource === "doubao" ? findDoubaoMathAttribute(node) : findPlatformMathAttribute(node),
    findStructuredPlatformMathExpression(node),
  ]
    .map(cleanupPlatformMathExpression)
    .filter((value) => value && !isLikelySpokenMathExpression(value));

  return candidates.sort((left, right) => platformMathScore(right) - platformMathScore(left))[0] ?? "";
}

function findDoubaoMathAttribute(element: Element): string {
  const attributes = [
    "data-tex",
    "data-latex",
    "data-math",
    "data-formula",
    "data-expression",
    "data-original-tex",
    "data-original",
    "copy-text",
    "data-clipboard-text",
    "data-copy",
    "data-content",
    "data-value",
    "aria-label",
    "title",
    "alt",
  ];
  const nodes = [element, ...Array.from(element.querySelectorAll("*"))];

  for (const node of nodes) {
    for (const attribute of attributes) {
      const value = node.getAttribute(attribute);
      if (value && looksLikeDoubaoMathSource(value)) {
        return value;
      }
    }
  }

  return "";
}

function findPlatformMathAttribute(element: Element): string {
  const attributes = [
    "data-tex",
    "data-latex",
    "data-math",
    "data-formula",
    "data-expression",
    "data-original-tex",
  ];
  const nodes = [element, ...Array.from(element.querySelectorAll("*"))];

  for (const node of nodes) {
    for (const attribute of attributes) {
      const value = node.getAttribute(attribute);
      if (value && looksLikeStrongPlatformMathExpression(value)) {
        return value;
      }
    }
  }

  return "";
}

function findStructuredPlatformMathExpression(element: Element): string {
  const annotation = Array.from(element.querySelectorAll("annotation")).find((node) =>
    /tex|latex/i.test(node.getAttribute("encoding") ?? ""),
  );
  if (annotation?.textContent) {
    return annotation.textContent;
  }

  const script = element.querySelector('script[type*="math/tex"], script[type*="math/latex"]');
  if (script?.textContent) {
    return script.textContent;
  }

  const math =
    (element.matches("math") ? element : null) ??
    element.querySelector(".katex-mathml math, mjx-assistive-mml math, math");
  return math ? extractMathExpression(math) : "";
}

function cleanupPlatformMathExpression(expression: string): string {
  return decodeHtmlText(expression)
    .replace(/^(?:\u516c\u5f0f|latex|math|equation)[:\uFF1A\s]*/i, "")
    .replace(/^公式[:：]\s*/, "")
    .replace(/^equation[:：]\s*/i, "")
    .replace(/^\\\(\s*/, "")
    .replace(/\s*\\\)$/, "")
    .replace(/^\\\[\s*/, "")
    .replace(/\s*\\\]$/, "")
    .replace(/^\s*\$+\s*/, "")
    .replace(/\s*\$+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlText(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function looksLikePlatformMathExpression(value: string): boolean {
  const text = cleanupPlatformMathExpression(value);
  return text.length > 0 && text.length < 3000 && /\\[a-zA-Z]+|[_^{}=<>+\-*/]|[∑∫∞πλΛμνθη]/.test(text);
}

function looksLikeStrongPlatformMathExpression(value: string): boolean {
  const text = cleanupPlatformMathExpression(value);
  return looksLikePlatformMathExpression(text) && /\\[a-zA-Z]+|[{}]/.test(text);
}

function looksLikeDoubaoMathSource(value: string): boolean {
  const text = cleanupPlatformMathExpression(value);
  if (!text || text.length > 2000 || /[\u4e00-\u9fff]/.test(text)) {
    return false;
  }

  if (/\\(?:frac|sqrt|sum|prod|int|lim|left|right|begin|end|pm|to|infty|cdot|times)\b/.test(text)) {
    return true;
  }

  if (/[{}]/.test(text) && /[=<>+\-*/^_]/.test(text)) {
    return true;
  }

  if (/[_^]/.test(text) && /[=<>+\-*/]|\\[a-zA-Z]+/.test(text)) {
    return true;
  }

  if (/[=<>+\-*/]/.test(text) && /[a-zA-Z0-9]/.test(text) && /[()^_]|[∑∫∞πθλμνξ]/.test(text)) {
    return true;
  }

  return false;
}

function isLikelySpokenMathExpression(value: string): boolean {
  const text = cleanupPlatformMathExpression(value);
  if (/\\[A-Za-z]+/.test(text) && /[{}]/.test(text)) {
    return false;
  }

  if (/\b(?:munu|pii|frac\d|int\s*_|Lambda_)\b/i.test(text)) {
    return true;
  }

  if (/(^|[^\\])\binfty\b/i.test(text) || /(^|[^\\])\bsqrt\b/i.test(text) || /(^|[^\\])\bsum\b/i.test(text)) {
    return true;
  }

  if (/\\hat\s+[A-Za-z]\s*\(/.test(text) || /(^|[^\\])\bhat\s*[a-z]\b/i.test(text)) {
    return true;
  }

  return false;
}

function platformMathScore(expression: string): number {
  let score = 0;
  if (/\\(?:frac|sqrt|sum|prod|int|lim|hat|mathbf|mathcal|Lambda|lambda|mu|nu|xi|pi|infty)\b/.test(expression)) {
    score += 120;
  }
  if (/[{}]/.test(expression)) {
    score += 80;
  }
  if (/\\(?:hat|int|infty|xi|pi)\b/.test(expression)) {
    score += 70;
  }
  if (/[_^]/.test(expression)) {
    score += 40;
  }
  if (/[=<>+\-*/]/.test(expression)) {
    score += 20;
  }
  score -= Math.max(0, expression.length - 500);
  return score;
}

function isDisplayPlatformMath(node: HTMLElement): boolean {
  const label = [
    node.tagName,
    node.getAttribute("display"),
    node.getAttribute("class"),
    node.getAttribute("data-testid"),
    node.getAttribute("role"),
  ]
    .join(" ")
    .toLowerCase();
  if (/\b(display|block|katex-display)\b/.test(label) || node.getAttribute("display") === "true") {
    return true;
  }

  const ownText = node.textContent?.trim();
  const parentText = node.parentElement?.textContent?.trim();
  return Boolean(ownText && parentText && ownText === parentText);
}

function collectDoubaoMathDebug(root: HTMLElement): unknown[] {
  return Array.from(root.querySelectorAll<HTMLElement>(platformMathSelector("doubao")))
    .filter((node) => !node.closest("table"))
    .slice(0, 30)
    .map((node) => ({
      tag: node.tagName.toLowerCase(),
      className: node.className.toString().slice(0, 160),
      text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
      expression: extractPlatformMathExpression(node, "doubao").slice(0, 300),
      attributes: collectInterestingMathAttributes(node),
    }));
}

function collectInterestingMathAttributes(node: Element): Record<string, string> {
  const result: Record<string, string> = {};
  [
    "data-tex",
    "data-latex",
    "data-math",
    "data-formula",
    "data-expression",
    "data-original-tex",
    "copy-text",
    "data-clipboard-text",
    "data-copy",
    "aria-label",
    "title",
    "alt",
  ].forEach((attribute) => {
    const value = node.getAttribute(attribute);
    if (value) {
      result[attribute] = value.slice(0, 220);
    }
  });
  return result;
}

function sanitizeCapturedClone(clone: HTMLElement): void {
  preserveCheckboxMarkers(clone);

  clone
    .querySelectorAll(
      [
        ".markdrop-ai-host",
        ".markdrop-ai-save",
        "script",
        "style",
        "noscript",
        "button",
        "input",
        "textarea",
        "select",
        "iframe",
        "video",
        "canvas",
      ].join(", "),
    )
    .forEach((node) => node.remove());

  clone.querySelectorAll<HTMLElement>("[hidden], [aria-hidden='true']").forEach((node) => {
    if (!node.closest("pre, code, table, .katex, .katex-display, mjx-container, math")) {
      node.remove();
    }
  });

  clone.querySelectorAll<HTMLElement>("[role='button'], [data-testid], [aria-label], [class]").forEach((node) => {
    if (isLikelyAnswerControl(node)) {
      node.remove();
    }
  });

  clone.querySelectorAll<SVGElement>("svg").forEach((node) => {
    if (!node.closest("mjx-container, math")) {
      node.remove();
    }
  });

  clone.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const src =
      image.getAttribute("src") ||
      image.getAttribute("data-src") ||
      image.getAttribute("data-original") ||
      firstSrcsetUrl(image.getAttribute("srcset") || image.getAttribute("data-srcset") || "");

    if (src) {
      image.setAttribute("src", src);
    }
  });
}

function preserveCheckboxMarkers(clone: HTMLElement): void {
  clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
    input.replaceWith(document.createTextNode(`${input.checked ? "[x]" : "[ ]"} `));
  });
}

function isLikelyAnswerControl(node: HTMLElement): boolean {
  if (
    node.closest("pre, code, table, .katex, .katex-display, mjx-container, math") ||
    node.querySelector("pre, code")
  ) {
    return false;
  }

  const label = [
    node.getAttribute("data-testid"),
    node.getAttribute("aria-label"),
    node.getAttribute("role"),
    node.className.toString(),
  ]
    .join(" ")
    .toLowerCase();

  return [
    "copy",
    "share",
    "regenerate",
    "retry",
    "feedback",
    "like",
    "dislike",
    "toolbar",
    "action",
    "operation",
  ].some((hint) => label.includes(hint));
}

function firstSrcsetUrl(srcset: string): string {
  return srcset.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
}

async function openSavePanel(content: CapturedContent): Promise<void> {
  latestSettings = await getSettings();
  activePanel?.remove();

  const settings = latestSettings;
  const i18n = getI18n(settings.preferences.languagePreference);
  const t = i18n.t;
  const defaultTarget = getDefaultTarget(settings);
  const noTargets = settings.targets.length === 0;
  const overlay = document.createElement("div");
  overlay.className = "markdrop-save-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(15, 23, 42, 0.18);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 9vh 16px 24px;
    box-sizing: border-box;
  `;

  const panel = document.createElement("section");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("content.saveDialog.title"));
  panel.style.cssText = `
    width: min(520px, 100%);
    border: 1px solid rgba(15, 23, 42, 0.14);
    border-radius: 8px;
    background: #ffffff;
    color: #0f172a;
    box-shadow: 0 24px 80px rgba(15, 23, 42, 0.26);
    font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
  `;

  panel.innerHTML = `
    <div style="padding:16px 18px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <strong style="font-size:16px;">${escapeHtml(t("content.saveDialog.title"))}</strong>
      <button data-action="close" type="button" style="${iconButtonCss()}">×</button>
    </div>
    <div style="padding:18px;display:grid;gap:14px;">
      <label style="${labelCss()}">
        <span>${escapeHtml(t("content.field.title"))}</span>
        <input data-field="title" type="text" value="${escapeAttribute(content.title)}" style="${inputCss()}">
      </label>
      <label style="${labelCss()}">
        <span>${escapeHtml(t("content.field.target"))}</span>
        <select data-field="target" style="${inputCss()}" ${settings.targets.length ? "" : "disabled"}>
          ${renderTargetOptions(settings.targets, defaultTarget?.id)}
        </select>
      </label>
      ${
        noTargets
          ? `<p style="margin:0;color:#b91c1c;">${escapeHtml(t("content.noTargets"))}</p>`
          : ""
      }
      <label style="display:flex;align-items:center;gap:8px;color:#334155;">
        <input data-field="source" type="checkbox" ${settings.preferences.includeSourceUrl ? "checked" : ""}>
        <span>${escapeHtml(t("content.field.sourceUrl"))}</span>
      </label>
      <div style="border:1px solid #e5e7eb;border-radius:7px;background:#f8fafc;padding:10px 12px;color:#475569;max-height:112px;overflow:auto;white-space:pre-wrap;">${escapeHtml(
        content.markdown.slice(0, 520) || content.text.slice(0, 520),
      )}</div>
      <p data-field="status" style="min-height:20px;margin:0;color:#64748b;"></p>
    </div>
    <div style="padding:14px 18px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:10px;">
      <button data-action="options" type="button" style="${secondaryButtonCss()}">${escapeHtml(t("content.openOptions"))}</button>
      <div style="display:flex;gap:10px;">
        <button data-action="cancel" type="button" style="${secondaryButtonCss()}">${escapeHtml(t("common.cancel"))}</button>
        <button data-action="save" type="button" style="${primaryButtonCss()}" ${noTargets ? "disabled" : ""}>${
          noTargets ? escapeHtml(t("content.setupFirst")) : escapeHtml(t("common.save"))
        }</button>
      </div>
    </div>
  `;

  overlay.append(panel);
  document.documentElement.append(overlay);
  activePanel = overlay;

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closePanel(overlay);
      document.removeEventListener("keydown", handleKeydown);
    }
  };
  document.addEventListener("keydown", handleKeydown);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
      activePanel = null;
      document.removeEventListener("keydown", handleKeydown);
    }
  });

  panel.querySelector<HTMLButtonElement>('[data-action="close"]')?.addEventListener("click", () => {
    closePanel(overlay);
    document.removeEventListener("keydown", handleKeydown);
  });
  panel.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", () => {
    closePanel(overlay);
    document.removeEventListener("keydown", handleKeydown);
  });
  panel.querySelector<HTMLButtonElement>('[data-action="options"]')?.addEventListener("click", () => {
    void requestOpenOptionsPage();
  });
  panel.querySelector<HTMLButtonElement>('[data-action="save"]')?.addEventListener("click", async () => {
    const titleInput = panel.querySelector<HTMLInputElement>('[data-field="title"]');
    const targetSelect = panel.querySelector<HTMLSelectElement>('[data-field="target"]');
    const includeSource = panel.querySelector<HTMLInputElement>('[data-field="source"]');
    const status = panel.querySelector<HTMLParagraphElement>('[data-field="status"]');
    const saveButton = panel.querySelector<HTMLButtonElement>('[data-action="save"]');

    if (!titleInput || !targetSelect || !includeSource || !status || !saveButton) {
      return;
    }

    const selectedTarget = settings.targets.find((target) => target.id === targetSelect.value);
    const selectedTargetName = selectedTarget ? targetDisplayName(selectedTarget) : t("content.selectedTarget");

    const request: SaveRequest = {
      targetId: targetSelect.value,
      title: titleInput.value.trim() || content.title,
      markdown: content.markdown,
      sourceUrl: content.sourceUrl,
      includeSourceUrl: includeSource.checked,
    };

    status.style.color = "#475569";
    status.textContent = t("content.savingTo", { target: selectedTargetName });
    saveButton.disabled = true;
    saveButton.textContent = t("common.saving");

    const result = await sendSaveRequest(request, 25000);
    if (result.ok) {
      status.style.color = "#047857";
      status.innerHTML = result.url
        ? `${escapeHtml(t("content.saveSuccess"))}<a href="${escapeAttribute(result.url)}" target="_blank" rel="noreferrer" style="color:#047857;text-decoration:underline;">${escapeHtml(t("content.openSaved"))}</a>`
        : t("content.saveSuccess");
      showToast(t("content.savedToast"), "success");
      saveButton.textContent = t("common.saved");
    } else {
      status.style.color = "#b91c1c";
      status.textContent = `${selectedTargetName}: ${formatUserFacingError(
        result.error || t("errors.fallback.save"),
        "save",
        settings.preferences.languagePreference,
      )}`;
      saveButton.disabled = false;
      saveButton.textContent = t("common.save");
    }
  });
}

function renderTargetOptions(targets: MarkdropSettings["targets"], selectedId?: string): string {
  const groups = [
    { provider: "notion", label: "Notion" },
    { provider: "feishu", label: "Feishu" },
    { provider: "obsidian", label: "Obsidian" },
  ] as const;

  return groups
    .map((group) => {
      const options = targets
        .filter((target) => targetProvider(target) === group.provider)
        .map(
          (target) =>
            `<option value="${escapeAttribute(target.id)}" ${target.id === selectedId ? "selected" : ""}>${escapeHtml(targetDisplayName(target))}</option>`,
        )
        .join("");

      return options ? `<optgroup label="${group.label}">${options}</optgroup>` : "";
    })
    .join("");
}

function targetDisplayName(target: MarkdropSettings["targets"][number]): string {
  return `${providerDisplayName(targetProvider(target))} · ${target.name}`;
}

function providerDisplayName(provider: ReturnType<typeof targetProvider>): string {
  if (provider === "feishu") {
    return "Feishu";
  }
  if (provider === "obsidian") {
    return "Obsidian";
  }
  return "Notion";
}

function closePanel(panel: HTMLElement): void {
  panel.remove();
  if (activePanel === panel) {
    activePanel = null;
  }
}

async function sendSaveRequest(request: SaveRequest, timeoutMs: number): Promise<SaveResult> {
  try {
    return await withTimeout(
      chrome.runtime.sendMessage({
        type: "MARKDROP_SAVE_NOTION",
        payload: request,
      }),
      timeoutMs,
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : ct("content.saveRequestFailed"),
    };
  }
}

async function requestOpenOptionsPage(): Promise<void> {
  try {
    const result = (await chrome.runtime.sendMessage({ type: "MARKDROP_OPEN_OPTIONS" })) as SaveResult | undefined;
    if (!result?.ok) {
      throw new Error(result?.error || ct("content.openOptionsFailed"));
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : ct("content.openOptionsFailed"), "error");
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(ct("content.saveTimeout")));
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timer));
  });
}

function buildTitle(pageTitle: string): string {
  const template = latestSettings?.preferences.titleTemplate ?? "{pageTitle} - {date}";
  return formatDefaultTitle(template, pageTitle);
}

function showToast(message: string, type: "success" | "error"): void {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483647;
    max-width: min(360px, calc(100vw - 32px));
    border-radius: 7px;
    background: ${type === "success" ? "#047857" : "#b91c1c"};
    color: #ffffff;
    padding: 10px 12px;
    box-shadow: 0 16px 48px rgba(15, 23, 42, 0.24);
    font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  `;
  document.documentElement.append(toast);
  window.setTimeout(() => toast.remove(), 2200);
}

function labelCss(): string {
  return "display:grid;gap:6px;color:#334155;font-size:13px;";
}

function inputCss(): string {
  return "width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:7px;padding:9px 10px;background:#fff;color:#0f172a;font:14px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
}

function primaryButtonCss(): string {
  return "border:0;border-radius:7px;background:#2563eb;color:#fff;padding:9px 14px;font:600 13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;";
}

function secondaryButtonCss(): string {
  return "border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#334155;padding:8px 12px;font:13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;";
}

function iconButtonCss(): string {
  return "width:28px;height:28px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#334155;font:18px/24px system-ui;cursor:pointer;";
}

function ct(key: string, replacements?: Record<string, string | number | boolean | undefined>): string {
  return getI18n(latestSettings?.preferences.languagePreference).t(key, replacements);
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(input: string): string {
  return escapeHtml(input).replaceAll("'", "&#39;");
}
