export type Platform = "notion" | "feishu" | "obsidian";
export type TargetProvider = Platform;
export type LanguagePreference = "auto" | "zh-CN" | "en";

export type NotionTargetType = "page" | "data_source" | "database";
export type FeishuTargetType = "folder" | "wiki";
export type ObsidianTargetType = "folder";

interface BaseSaveTarget {
  id: string;
  name: string;
  provider?: TargetProvider;
  platform?: Platform;
  isDefault?: boolean;
}

export interface NotionSaveTarget extends BaseSaveTarget {
  provider: "notion";
  platform?: "notion";
  notionTargetType: NotionTargetType;
  notionTargetId: string;
  titlePropertyName?: string;
}

export interface FeishuSaveTarget extends BaseSaveTarget {
  provider: "feishu";
  platform?: "feishu";
  feishuTargetType: FeishuTargetType;
  feishuTargetToken: string;
  feishuSpaceId?: string;
}

export interface ObsidianSaveTarget extends BaseSaveTarget {
  provider: "obsidian";
  platform?: "obsidian";
  obsidianTargetType: ObsidianTargetType;
  obsidianFolderPath: string;
  obsidianFileNameTemplate?: string;
}

export type SaveTarget = NotionSaveTarget | FeishuSaveTarget | ObsidianSaveTarget;

export interface MarkdropPreferences {
  showFloatingButton: boolean;
  enableContextMenu: boolean;
  enableAiButtons: boolean;
  includeSourceUrl: boolean;
  titleTemplate: string;
  languagePreference: LanguagePreference;
}

export interface FeishuSettings {
  appId: string;
  appSecret: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
  connectedAt?: number;
}

export interface ObsidianSettings {
  apiUrl: string;
  apiKey: string;
  vaultName?: string;
}

export interface MarkdropSettings {
  notionToken: string;
  feishu: FeishuSettings;
  obsidian: ObsidianSettings;
  targets: SaveTarget[];
  defaultTargetId?: string;
  preferences: MarkdropPreferences;
}

export interface CapturedContent {
  html: string;
  text: string;
  markdown: string;
  title: string;
  sourceUrl: string;
  sourceType: "selection" | "ai-answer" | "context-menu";
  platformName?: string;
}

export interface SaveRequest {
  targetId: string;
  title: string;
  markdown: string;
  sourceUrl: string;
  includeSourceUrl: boolean;
}

export interface SaveResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export function targetProvider(target: SaveTarget): TargetProvider {
  return target.provider ?? (target as { platform?: Platform }).platform ?? "notion";
}

export function isNotionTarget(target: SaveTarget): target is NotionSaveTarget {
  return targetProvider(target) === "notion";
}

export function isFeishuTarget(target: SaveTarget): target is FeishuSaveTarget {
  return targetProvider(target) === "feishu";
}

export function isObsidianTarget(target: SaveTarget): target is ObsidianSaveTarget {
  return targetProvider(target) === "obsidian";
}
