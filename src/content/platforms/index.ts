import { chatgptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { deepseekAdapter } from "./deepseek";
import { doubaoAdapter } from "./doubao";
import { geminiAdapter } from "./gemini";
import { injectSaveButton } from "./inject";
import { tongyiAdapter } from "./tongyi";
import type { AiPlatformAdapter, AiPlatformContext } from "./types";

const adapters: AiPlatformAdapter[] = [
  chatgptAdapter,
  claudeAdapter,
  doubaoAdapter,
  deepseekAdapter,
  tongyiAdapter,
  geminiAdapter,
];

export function installAiSaveButtons(context: AiPlatformContext): () => void {
  const hostname = location.hostname;
  const adapter = adapters.find((item) => item.matches(hostname));

  if (!adapter) {
    return () => undefined;
  }

  let scanScheduled = false;
  let disposed = false;
  let scheduledScanId: number | undefined;
  let observer: MutationObserver | undefined;

  const run = () => {
    if (disposed) {
      return;
    }

    scanScheduled = false;
    const buttonCountBeforeAdapterScan = document.querySelectorAll(".markdrop-ai-save").length;
    adapter.scan(context);
    const buttonCountAfterAdapterScan = document.querySelectorAll(".markdrop-ai-save").length;
    if (buttonCountBeforeAdapterScan === 0 && buttonCountAfterAdapterScan === 0) {
      installGenericFallback(context, adapter.name);
    }
  };

  const scheduleRun = () => {
    if (scanScheduled) {
      return;
    }

    scanScheduled = true;
    scheduledScanId = window.setTimeout(run, 250);
  };

  run();

  if (!document.body) {
    const bodyObserver = new MutationObserver(() => {
      if (disposed || !document.body) {
        return;
      }

      bodyObserver.disconnect();
      observer = new MutationObserver(() => scheduleRun());
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      scheduleRun();
    });

    bodyObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      disposed = true;
      bodyObserver.disconnect();
      if (scheduledScanId !== undefined) {
        window.clearTimeout(scheduledScanId);
      }
      observer?.disconnect();
    };
  }

  observer = new MutationObserver(() => scheduleRun());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    disposed = true;
    if (scheduledScanId !== undefined) {
      window.clearTimeout(scheduledScanId);
    }
    observer?.disconnect();
  };
}

function installGenericFallback(context: AiPlatformContext, platformName: string): void {
  const candidates = collectFallbackCandidates();

  candidates.forEach((candidate) => {
    const answer = findGenericAnswerElement(candidate);
    if (!answer || isBadCandidate(answer)) {
      return;
    }

    injectSaveButton(answer, platformName, context, answer);
  });
}

function collectFallbackCandidates(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        '[data-message-author-role="assistant"]',
        '[data-testid="markdown"]',
        '[data-testid*="conversation-turn"]',
        '[data-testid*="message"]',
        "[data-turn-id]",
        ".markdown",
        '[class*="markdown"]',
        '[class*="model-response"]',
        '[class*="response-container"]',
        "model-response",
        "message-content",
        "article",
        "article p",
        "article pre",
      ].join(", "),
    ),
  );
}

function findGenericAnswerElement(node: HTMLElement): HTMLElement | null {
  const markdown =
    node.closest<HTMLElement>('[data-testid="markdown"], .markdown, [class*="markdown"], message-content') ??
    node.querySelector<HTMLElement>('[data-testid="markdown"], .markdown, [class*="markdown"], message-content');
  if (markdown) {
    return markdown;
  }

  const message =
    node.closest<HTMLElement>(
      '[data-message-author-role="assistant"], [data-testid*="conversation-turn"], [data-testid*="message"], [data-turn-id], model-response, article',
    ) ?? node.querySelector<HTMLElement>('[data-message-author-role="assistant"], model-response, article');

  return message ?? node;
}

function isBadCandidate(node: HTMLElement): boolean {
  const text = node.textContent?.trim() ?? "";
  if (text.length < 12) {
    return true;
  }

  if (node.closest("form, textarea, [contenteditable='true'], [data-testid*='composer']")) {
    return true;
  }

  const role = node.closest<HTMLElement>("[data-message-author-role]")?.getAttribute("data-message-author-role");
  if (role === "user") {
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

  return label.includes("user") || label.includes("human") || label.includes("composer");
}
