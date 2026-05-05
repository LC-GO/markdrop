import type { AiPlatformContext } from "./types";

export function injectSaveButton(
  answerElement: HTMLElement,
  platformName: string,
  context: AiPlatformContext,
  buttonHost: HTMLElement = answerElement,
): void {
  const injectionKey = findInjectionKey(answerElement, buttonHost);
  if (hasInjectedButton(injectionKey, buttonHost)) {
    return;
  }

  injectionKey.dataset.markdropInjected = "true";

  const host = document.createElement("div");
  host.className = "markdrop-ai-host";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "markdrop-ai-save";
  button.textContent = "Save";
  button.title = "Save this answer to Markdrop";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    context.openSavePanel(context.captureAnswer(answerElement, platformName));
  });

  host.append(button);
  buttonHost.append(host);
  ensureAiButtonStyle();
}

function hasInjectedButton(injectionKey: HTMLElement, buttonHost: HTMLElement): boolean {
  const existingButton =
    buttonHost.querySelector(":scope > .markdrop-ai-host .markdrop-ai-save") ??
    injectionKey.querySelector(":scope > .markdrop-ai-host .markdrop-ai-save") ??
    findAdjacentInjectedButton(buttonHost) ??
    findAdjacentInjectedButton(injectionKey) ??
    injectionKey.querySelector(".markdrop-ai-save");

  if (existingButton?.isConnected) {
    return true;
  }

  injectionKey.dataset.markdropInjected = "false";
  return false;
}

function findAdjacentInjectedButton(node: HTMLElement): Element | null {
  const next = node.nextElementSibling;
  if (next instanceof HTMLElement && next.classList.contains("markdrop-ai-host")) {
    return next.querySelector(".markdrop-ai-save");
  }

  return null;
}

function findInjectionKey(answerElement: HTMLElement, buttonHost: HTMLElement): HTMLElement {
  return (
    answerElement.closest<HTMLElement>("[data-message-id], [data-testid*='message'], article, [class*='message']") ??
    buttonHost
  );
}

export function ensureAiButtonStyle(): void {
  if (document.getElementById("markdrop-ai-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "markdrop-ai-style";
  style.textContent = `
    .markdrop-ai-host {
      display: flex;
      justify-content: flex-start;
      margin-top: 8px;
      pointer-events: auto;
      position: relative;
      z-index: 2147483646;
    }

    .markdrop-ai-save {
      appearance: none;
      border: 1px solid rgba(71, 85, 105, 0.28);
      background: rgba(255, 255, 255, 0.86);
      color: #1f2937;
      border-radius: 6px;
      padding: 4px 9px;
      font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
    }

    .markdrop-ai-save:hover {
      background: #f8fafc;
      border-color: rgba(37, 99, 235, 0.42);
      color: #1d4ed8;
    }
  `;
  document.documentElement.append(style);
}
