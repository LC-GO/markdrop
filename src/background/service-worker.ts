import { getSettings, openOptionsPage, saveSettings } from "../utils/storage";
import { getI18n } from "../utils/i18n";
import { saveMarkdownToNotion, testNotionTarget } from "../utils/notion";
import { saveMarkdownToFeishu, testFeishuTarget, type FeishuTargetTestResult } from "../integrations/feishu/save";
import { saveMarkdownToObsidian, testObsidianTarget } from "../integrations/obsidian/save";
import {
  clearFeishuOAuthTokens,
  getFeishuOAuthStatus,
  runFeishuOAuthLogin,
} from "../integrations/feishu/auth";
import { isFeishuTarget, isObsidianTarget } from "../utils/types";
import type { FeishuSettings, ObsidianSettings, SaveRequest, SaveResult, SaveTarget } from "../utils/types";

const CONTEXT_MENU_ID = "markdrop-save-selection";

chrome.runtime.onInstalled.addListener(() => {
  void refreshContextMenu();
  void injectContentScriptsIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshContextMenu();
  void injectContentScriptsIntoOpenTabs();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes["markdrop.settings"]) {
    void refreshContextMenu();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    void injectContentScriptIntoTab(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void chrome.tabs.get(activeInfo.tabId).then((tab) => injectContentScriptIntoTab(activeInfo.tabId, tab.url));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) {
    return;
  }

  void sendContextMenuSave(tab.id, info.selectionText ?? "");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "MARKDROP_SAVE_NOTION") {
    void handleSave(message.payload as SaveRequest).then(sendResponse);
    return true;
  }

  if (message?.type === "MARKDROP_OPEN_OPTIONS") {
    void openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : getI18n().t("content.openOptionsFailed"),
        }),
      );
    return true;
  }

  if (message?.type === "MARKDROP_TEST_NOTION_TARGET") {
    void handleTestTarget(message.payload as { token: string; target: SaveTarget }).then(sendResponse);
    return true;
  }

  if (message?.type === "MARKDROP_TEST_FEISHU_TARGET") {
    void handleTestFeishuTarget(message.payload as { feishu: FeishuSettings; target: SaveTarget }).then(sendResponse);
    return true;
  }

  if (message?.type === "MARKDROP_TEST_OBSIDIAN_TARGET") {
    void handleTestObsidianTarget(message.payload as { obsidian: ObsidianSettings; target: SaveTarget }).then(sendResponse);
    return true;
  }

  if (message?.type === "MARKDROP_FEISHU_AUTH_STATUS") {
    void handleFeishuAuthStatus(message.payload as { feishu: FeishuSettings }).then(sendResponse);
    return true;
  }

  if (message?.type === "MARKDROP_FEISHU_LOGIN") {
    void handleFeishuLogin(message.payload as { feishu: FeishuSettings }).then(sendResponse);
    return true;
  }

  if (message?.type === "MARKDROP_FEISHU_LOGOUT") {
    void handleFeishuLogout(message.payload as { feishu: FeishuSettings }).then(sendResponse);
    return true;
  }

  return false;
});

async function refreshContextMenu(): Promise<void> {
  const settings = await getSettings();
  await chrome.contextMenus.removeAll();

  if (!settings.preferences.enableContextMenu) {
    return;
  }

  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: getI18n(settings.preferences.languagePreference).t("content.contextMenu"),
    contexts: ["selection"],
  });
}

async function sendContextMenuSave(tabId: number, selectionText: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "MARKDROP_CONTEXT_MENU_SAVE",
      selectionText,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    await recordLastSave({
      ok: false,
      error: [
        getI18n((await getSettings()).preferences.languagePreference).t("content.contextMenuFailed"),
        detail,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
}

async function injectContentScriptsIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.map(async (tab) => {
      if (!tab.id) {
        return;
      }

      await injectContentScriptIntoTab(tab.id, tab.url);
    }),
  );
}

async function injectContentScriptIntoTab(tabId: number, url = ""): Promise<void> {
  if (!isSupportedTabUrl(url)) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-script.js"],
    });
  } catch {
    // Chrome blocks script injection on internal pages and some restricted browser surfaces.
  }
}

function isSupportedTabUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

async function handleSave(request: SaveRequest): Promise<SaveResult> {
  const settings = await getSettings();

  try {
    const target = settings.targets.find((item) => item.id === request.targetId);
    const result =
      target && isFeishuTarget(target)
        ? await saveMarkdownToFeishu(settings, request)
        : target && isObsidianTarget(target)
          ? await saveMarkdownToObsidian(settings, request)
          : await saveMarkdownToNotion(settings, request);
    await recordLastSave(result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      error: error instanceof Error ? error.message : getI18n(settings.preferences.languagePreference).t("errors.fallback.save"),
    };
    await recordLastSave(result);
    return result;
  }
}

async function handleTestTarget(payload: { token: string; target: SaveTarget }): Promise<SaveResult> {
  try {
    return await testNotionTarget(payload.token, payload.target);
  } catch (error) {
    const settings = await getSettings();
    return {
      ok: false,
      error: error instanceof Error ? error.message : getI18n(settings.preferences.languagePreference).t("errors.fallback.test"),
    };
  }
}

async function handleTestFeishuTarget(payload: { feishu: FeishuSettings; target: SaveTarget }): Promise<FeishuTargetTestResult> {
  try {
    const settings = await getSettings();
    const result = await testFeishuTarget(
      {
        ...settings.feishu,
        ...payload.feishu,
      },
      payload.target,
    );

    if (result.feishu) {
      settings.feishu = result.feishu;
      await saveSettings(settings);
    }

    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Feishu target test failed.",
    };
  }
}

async function handleTestObsidianTarget(payload: { obsidian: ObsidianSettings; target: SaveTarget }): Promise<SaveResult> {
  try {
    return await testObsidianTarget(payload.obsidian, payload.target);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Obsidian target test failed.",
    };
  }
}

async function handleFeishuAuthStatus(payload: { feishu: FeishuSettings }): Promise<SaveResult & ReturnType<typeof getFeishuOAuthStatus>> {
  return {
    ok: true,
    ...getFeishuOAuthStatus(payload.feishu),
  };
}

async function handleFeishuLogin(payload: { feishu: FeishuSettings }): Promise<SaveResult & ReturnType<typeof getFeishuOAuthStatus>> {
  try {
    const settings = await getSettings();
    settings.feishu = await runFeishuOAuthLogin({
      ...settings.feishu,
      ...payload.feishu,
    });
    await saveSettings(settings);

    return {
      ok: true,
      ...getFeishuOAuthStatus(settings.feishu),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Feishu login failed.",
      ...getFeishuOAuthStatus(payload.feishu),
    };
  }
}

async function handleFeishuLogout(payload: { feishu: FeishuSettings }): Promise<SaveResult & ReturnType<typeof getFeishuOAuthStatus>> {
  const settings = await getSettings();
  settings.feishu = clearFeishuOAuthTokens({
    ...settings.feishu,
    ...payload.feishu,
  });
  await saveSettings(settings);

  return {
    ok: true,
    ...getFeishuOAuthStatus(settings.feishu),
  };
}

async function recordLastSave(result: SaveResult): Promise<void> {
  await chrome.storage.local.set({
    "markdrop.lastSave": {
      ...result,
      time: new Date().toISOString(),
    },
  });
}
