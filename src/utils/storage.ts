import type {
  FeishuSaveTarget,
  FeishuTargetType,
  MarkdropSettings,
  NotionSaveTarget,
  NotionTargetType,
  ObsidianSaveTarget,
  ObsidianTargetType,
  Platform,
  SaveTarget,
} from "./types";

const SETTINGS_KEY = "markdrop.settings";

export const defaultSettings: MarkdropSettings = {
  notionToken: "",
  feishu: {
    appId: "",
    appSecret: "",
  },
  obsidian: {
    apiUrl: "https://127.0.0.1:27124",
    apiKey: "",
    vaultName: "",
  },
  targets: [],
  preferences: {
    showFloatingButton: false,
    enableContextMenu: true,
    enableAiButtons: true,
    includeSourceUrl: true,
    titleTemplate: "{pageTitle} - {date}",
    languagePreference: "auto",
  },
};

export async function getSettings(): Promise<MarkdropSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] as Partial<MarkdropSettings> | undefined;

  return {
    ...defaultSettings,
    ...settings,
    feishu: {
      ...defaultSettings.feishu,
      ...settings?.feishu,
    },
    obsidian: {
      ...defaultSettings.obsidian,
      ...settings?.obsidian,
    },
    targets: settings?.targets ?? [],
    preferences: {
      ...defaultSettings.preferences,
      ...settings?.preferences,
    },
  };
}

export async function saveSettings(settings: MarkdropSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

export function normalizeSettings(settings: MarkdropSettings): MarkdropSettings {
  const targets = settings.targets.map(normalizeTarget);

  const requestedDefaultId = settings.defaultTargetId || targets.find((target) => target.isDefault)?.id;
  const defaultTargetId = targets.some((target) => target.id === requestedDefaultId)
    ? requestedDefaultId
    : targets[0]?.id;

  return {
    ...settings,
    notionToken: settings.notionToken.trim(),
    feishu: {
      appId: settings.feishu.appId.trim(),
      appSecret: settings.feishu.appSecret.trim(),
      accessToken: settings.feishu.accessToken,
      refreshToken: settings.feishu.refreshToken,
      accessTokenExpiresAt: settings.feishu.accessTokenExpiresAt,
      refreshTokenExpiresAt: settings.feishu.refreshTokenExpiresAt,
      connectedAt: settings.feishu.connectedAt,
    },
    obsidian: {
      apiUrl: (settings.obsidian?.apiUrl ?? defaultSettings.obsidian.apiUrl).trim().replace(/\/+$/g, "") || defaultSettings.obsidian.apiUrl,
      apiKey: (settings.obsidian?.apiKey ?? "").trim(),
      vaultName: settings.obsidian?.vaultName?.trim() || undefined,
    },
    targets: targets.map((target) => ({
      ...target,
      isDefault: target.id === defaultTargetId,
    })),
    defaultTargetId,
    preferences: {
      ...defaultSettings.preferences,
      ...settings.preferences,
      languagePreference: normalizeLanguagePreference(settings.preferences?.languagePreference),
      titleTemplate: settings.preferences?.titleTemplate?.trim() || defaultSettings.preferences.titleTemplate,
    },
  };
}

export function getDefaultTarget(settings: MarkdropSettings): SaveTarget | undefined {
  return (
    settings.targets.find((target) => target.id === settings.defaultTargetId) ??
    settings.targets.find((target) => target.isDefault) ??
    settings.targets[0]
  );
}

function normalizeTarget(target: SaveTarget): SaveTarget {
  const legacyPlatform = (target as { platform?: Platform }).platform;
  const provider = normalizeProvider((target.provider ?? legacyPlatform) as Platform | undefined);

  if (provider === "feishu") {
    const feishuTarget = target as Partial<FeishuSaveTarget> & SaveTarget;
    return {
      ...feishuTarget,
      provider: "feishu",
      platform: "feishu",
      name: feishuTarget.name.trim(),
      feishuTargetType: normalizeFeishuTargetType(feishuTarget.feishuTargetType),
      feishuTargetToken: (feishuTarget.feishuTargetToken ?? "").trim(),
      feishuSpaceId: feishuTarget.feishuSpaceId?.trim() || undefined,
    };
  }

  if (provider === "obsidian") {
    const obsidianTarget = target as Partial<ObsidianSaveTarget> & SaveTarget;
    return {
      ...obsidianTarget,
      provider: "obsidian",
      platform: "obsidian",
      name: obsidianTarget.name.trim(),
      obsidianTargetType: normalizeObsidianTargetType(obsidianTarget.obsidianTargetType),
      obsidianFolderPath: normalizeObsidianFolderPath(obsidianTarget.obsidianFolderPath ?? ""),
      obsidianFileNameTemplate: obsidianTarget.obsidianFileNameTemplate?.trim() || "{title}",
    };
  }

  const notionTarget = target as Partial<NotionSaveTarget> & SaveTarget;
  return {
    ...notionTarget,
    provider: "notion",
    platform: "notion",
    name: notionTarget.name.trim(),
    notionTargetType: normalizeNotionTargetType(notionTarget.notionTargetType),
    notionTargetId: (notionTarget.notionTargetId ?? "").trim(),
    titlePropertyName: notionTarget.titlePropertyName?.trim() || "Name",
  };
}

function normalizeNotionTargetType(type: NotionTargetType | undefined): NotionTargetType {
  return type === "data_source" || type === "database" || type === "page" ? type : "page";
}

function normalizeFeishuTargetType(type: FeishuTargetType | undefined): FeishuTargetType {
  return type === "wiki" ? "wiki" : "folder";
}

function normalizeObsidianTargetType(type: ObsidianTargetType | undefined): ObsidianTargetType {
  return type === "folder" ? "folder" : "folder";
}

function normalizeProvider(provider: Platform | undefined): Platform {
  if (provider === "feishu" || provider === "obsidian") {
    return provider;
  }

  return "notion";
}

function normalizeLanguagePreference(value: MarkdropSettings["preferences"]["languagePreference"] | undefined): MarkdropSettings["preferences"]["languagePreference"] {
  return value === "zh-CN" || value === "en" || value === "auto" ? value : "auto";
}

function normalizeObsidianFolderPath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  return normalized || ".";
}

export async function openOptionsPage(): Promise<void> {
  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
    return;
  }

  await chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") });
}
