import { getSettings, openOptionsPage } from "../utils/storage";
import { MARKDROP_BUILD_ID } from "../utils/buildInfo";
import { formatUserFacingError } from "../utils/errors";
import { applyElementTranslations, getI18n, type I18n } from "../utils/i18n";
import { targetProvider } from "../utils/types";

interface PageDiagnostic {
  ok?: boolean;
  hostname?: string;
  aiHost?: boolean;
  aiButtonsEnabled?: boolean;
  settingsLoaded?: boolean;
  candidateCount?: number;
  visibleCandidateCount?: number;
  directTargetCount?: number;
  saveButtonCount?: number;
  directSaveButtonCount?: number;
  runtimeBadge?: boolean;
  bootId?: number;
}

interface CaptureDebugPayload {
  ok?: boolean;
  error?: string;
  url?: string;
  hostname?: string;
  platformName?: string;
  title?: string;
  textLength?: number;
  htmlLength?: number;
  markdownLength?: number;
  markdown?: string;
  notionBlockPreview?: unknown;
  htmlPreview?: string;
  htmlTailPreview?: string;
  diagnostics?: PageDiagnostic;
}

let i18n: I18n = getI18n();

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  i18n = getI18n(settings.preferences.languagePreference);
  document.documentElement.lang = i18n.language;
  applyElementTranslations(document, i18n);
  const stored = await chrome.storage.local.get("markdrop.lastSave");
  const lastSave = stored["markdrop.lastSave"] as
    | { ok: boolean; url?: string; error?: string; time?: string }
    | undefined;
  const summary = document.querySelector<HTMLElement>("#summary");
  const lastSaveElement = document.querySelector<HTMLElement>("#last-save");
  const openOptions = document.querySelector<HTMLButtonElement>("#open-options");
  const diagnosePage = document.querySelector<HTMLButtonElement>("#diagnose-page");
  const copyCaptureDebug = document.querySelector<HTMLButtonElement>("#copy-capture-debug");

  if (summary) {
    const notionCount = settings.targets.filter((target) => targetProvider(target) === "notion").length;
    const feishuCount = settings.targets.filter((target) => targetProvider(target) === "feishu").length;
    const obsidianCount = settings.targets.filter((target) => targetProvider(target) === "obsidian").length;
    const notionText = settings.notionToken
      ? t("popup.summary.connected", { provider: "Notion", count: notionCount })
      : t("popup.summary.notConnected", { provider: "Notion" });
    const feishuText = settings.feishu.appId && settings.feishu.appSecret
      ? t("popup.summary.connected", { provider: "Feishu", count: feishuCount })
      : t("popup.summary.notConnected", { provider: "Feishu" });
    const obsidianText = settings.obsidian.apiKey
      ? t("popup.summary.connected", { provider: "Obsidian", count: obsidianCount })
      : t("popup.summary.notConnected", { provider: "Obsidian" });
    summary.textContent = `${notionText} · ${feishuText} · ${obsidianText} · ${MARKDROP_BUILD_ID}`;
  }

  if (lastSaveElement && lastSave) {
    const timeText = formatLastSaveTime(lastSave.time);
    const suffix = timeText ? ` (${timeText})` : "";

    if (lastSave.ok) {
      lastSaveElement.innerHTML = lastSave.url
        ? `${escapeHtml(t("popup.lastSave.success", { suffix }))} <a href="${escapeAttribute(lastSave.url)}" target="_blank" rel="noreferrer">${escapeHtml(t("popup.lastSave.open"))}</a>`
        : t("popup.lastSave.success", { suffix });
    } else {
      lastSaveElement.textContent = t("popup.lastSave.failure", {
        suffix,
        error: formatUserFacingError(lastSave.error || t("errors.fallback.save"), "save", i18n.preference),
      });
    }
  }

  openOptions?.addEventListener("click", () => {
    void openOptionsPage();
  });

  diagnosePage?.addEventListener("click", () => {
    void diagnoseCurrentPage(true);
  });

  copyCaptureDebug?.addEventListener("click", () => {
    void copyCaptureDebugReport();
  });

  void diagnoseCurrentPage(false);
}

async function diagnoseCurrentPage(forceInject: boolean): Promise<void> {
  const output = document.querySelector<HTMLElement>("#page-diagnostic");
  if (!output) {
    return;
  }

  output.textContent = forceInject ? t("popup.injecting") : t("popup.detecting");

  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    output.textContent = t("popup.noActiveTab");
    return;
  }

  if (!/^https?:\/\//i.test(tab.url)) {
    output.textContent = t("popup.unsupportedPage");
    return;
  }

  let diagnostic = await pingContentScript(tab.id);
  if (!diagnostic && (forceInject || isAiPageUrl(tab.url))) {
    const injected = await injectContentScript(tab.id);
    if (!injected.ok) {
      output.textContent = t("popup.injectFailed", { error: injected.error });
      return;
    }

    diagnostic = await pingContentScript(tab.id);
  }

  if (!diagnostic) {
    output.textContent = t("popup.noScript");
    return;
  }

  output.textContent = formatDiagnostic(diagnostic);
}

async function copyCaptureDebugReport(): Promise<void> {
  const output = document.querySelector<HTMLElement>("#page-diagnostic");
  const button = document.querySelector<HTMLButtonElement>("#copy-capture-debug");
  const originalText = button?.textContent ?? "";

  if (button) {
    button.disabled = true;
    button.textContent = t("common.copying");
  }

  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url) {
      throw new Error(t("popup.noActiveTabError"));
    }

    if (!/^https?:\/\//i.test(tab.url)) {
      throw new Error(t("popup.unsupportedInspect"));
    }

    let payload = await withTimeout(requestCaptureDebug(tab.id), 5000, t("popup.timeoutReading"));
    if (!payload) {
      const injected = await injectContentScript(tab.id);
      if (!injected.ok) {
        throw new Error(injected.error);
      }
      payload = await withTimeout(requestCaptureDebug(tab.id), 5000, t("popup.timeoutAfterInject"));
    }

    if (!payload?.ok) {
      throw new Error(payload?.error || t("popup.noCapturableAnswer"));
    }

    await copyText(formatCaptureDebugReport(payload));
    if (output) {
      output.textContent = t("popup.copiedDebug", {
        markdownLength: payload.markdownLength ?? 0,
        htmlLength: payload.htmlLength ?? 0,
      });
    }
  } catch (error) {
    if (output) {
      output.textContent = t("popup.debugFailed", { error: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || t("popup.copyCaptureDebug");
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Clipboard copy failed.");
    }
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function pingContentScript(tabId: number): Promise<PageDiagnostic | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, { type: "MARKDROP_DIAGNOSTIC" })) as PageDiagnostic;
  } catch {
    return null;
  }
}

async function requestCaptureDebug(tabId: number): Promise<CaptureDebugPayload | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, { type: "MARKDROP_CAPTURE_DEBUG" })) as CaptureDebugPayload;
  } catch {
    return null;
  }
}

async function injectContentScript(tabId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-script.js"],
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatCaptureDebugReport(payload: CaptureDebugPayload): string {
  return [
    "# Markdrop Capture Debug",
    "",
    `URL: ${payload.url ?? ""}`,
    `Hostname: ${payload.hostname ?? ""}`,
    `Platform: ${payload.platformName ?? ""}`,
    `Title: ${payload.title ?? ""}`,
    `Text length: ${payload.textLength ?? 0}`,
    `HTML length: ${payload.htmlLength ?? 0}`,
    `Markdown length: ${payload.markdownLength ?? 0}`,
    `Popup build: ${MARKDROP_BUILD_ID}`,
    "",
    "## Diagnostics",
    JSON.stringify(payload.diagnostics ?? {}, null, 2),
    "",
    "## Notion block preview",
    JSON.stringify(payload.notionBlockPreview ?? [], null, 2),
    "",
    "## Markdown",
    payload.markdown ?? "",
    "",
    "## HTML preview",
    payload.htmlPreview ?? "",
    "",
    "## HTML tail preview",
    payload.htmlTailPreview ?? "",
  ].join("\n");
}

function formatDiagnostic(diagnostic: PageDiagnostic): string {
  return [
    t("popup.diagnostic.script"),
    t("popup.diagnostic.hostname", { hostname: diagnostic.hostname ?? "unknown" }),
    t("popup.diagnostic.aiPage", { value: diagnostic.aiHost ? t("popup.yes") : t("popup.no") }),
    t("popup.diagnostic.aiButtons", { value: diagnostic.aiButtonsEnabled ? t("popup.enabled") : t("popup.disabled") }),
    t("popup.diagnostic.candidates", {
      visible: diagnostic.visibleCandidateCount ?? 0,
      total: diagnostic.candidateCount ?? 0,
    }),
    t("popup.diagnostic.directTargets", { count: diagnostic.directTargetCount ?? 0 }),
    t("popup.diagnostic.saveButtons", {
      count: diagnostic.saveButtonCount ?? 0,
      direct: diagnostic.directSaveButtonCount ?? 0,
    }),
    t("popup.diagnostic.badge", { value: diagnostic.runtimeBadge ? t("popup.present") : t("popup.absent") }),
  ].join("\n");
}

function isAiPageUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "chat.openai.com" ||
      hostname === "chatgpt.com" ||
      hostname.endsWith(".chatgpt.com") ||
      hostname === "gemini.google.com" ||
      hostname.endsWith(".gemini.google.com") ||
      hostname === "aistudio.google.com" ||
      hostname.endsWith(".aistudio.google.com") ||
      hostname === "claude.ai" ||
      hostname.endsWith(".claude.ai") ||
      hostname.includes("doubao.com") ||
      hostname.includes("deepseek.com") ||
      hostname.includes("kimi.com") ||
      hostname.includes("tongyi.com") ||
      hostname.includes("qianwen.com") ||
      hostname.includes("qwen")
    );
  } catch {
    return false;
  }
}

function formatLastSaveTime(isoTime?: string): string {
  if (!isoTime) {
    return "";
  }

  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(i18n.language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function t(key: string, replacements?: Record<string, string | number | boolean | undefined>): string {
  return i18n.t(key, replacements);
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
