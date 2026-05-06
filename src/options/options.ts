import { MARKDROP_BUILD_ID } from "../utils/buildInfo";
import { formatUserFacingError } from "../utils/errors";
import { applyElementTranslations, getI18n, type I18n, type LanguagePreference } from "../utils/i18n";
import { defaultSettings, getSettings, saveSettings } from "../utils/storage";
import { parseFeishuTargetInput } from "../integrations/feishu/links";
import {
  isFeishuTarget,
  isNotionTarget,
  isObsidianTarget,
  targetProvider,
  type FeishuTargetType,
  type MarkdropSettings,
  type NotionTargetType,
  type ObsidianTargetType,
  type Platform,
  type SaveTarget,
} from "../utils/types";

let settings: MarkdropSettings;
let activeProvider: Platform = "notion";
let editingLegacyDatabase = false;
let i18n: I18n = getI18n();

interface LastSaveState {
  ok: boolean;
  url?: string;
  error?: string;
  time?: string;
}

const buildId = query<HTMLElement>("#build-id");
const notionToken = query<HTMLInputElement>("#notion-token");
const feishuAppId = query<HTMLInputElement>("#feishu-app-id");
const feishuAppSecret = query<HTMLInputElement>("#feishu-app-secret");
const feishuRedirectUrl = query<HTMLInputElement>("#feishu-redirect-url");
const feishuAuthStatus = query<HTMLElement>("#feishu-auth-status");
const obsidianApiUrl = query<HTMLInputElement>("#obsidian-api-url");
const obsidianApiKey = query<HTMLInputElement>("#obsidian-api-key");
const obsidianVaultName = query<HTMLInputElement>("#obsidian-vault-name");
const notionPanel = query<HTMLElement>("#notion-panel");
const feishuPanel = query<HTMLElement>("#feishu-panel");
const obsidianPanel = query<HTMLElement>("#obsidian-panel");
const notionTargetCount = query<HTMLElement>("#notion-target-count");
const feishuTargetCount = query<HTMLElement>("#feishu-target-count");
const obsidianTargetCount = query<HTMLElement>("#obsidian-target-count");
const notionConnectionStatus = query<HTMLElement>("#notion-connection-status");
const feishuConnectionStatus = query<HTMLElement>("#feishu-connection-status");
const obsidianConnectionStatus = query<HTMLElement>("#obsidian-connection-status");
const providerSectionTitle = query<HTMLElement>("#provider-section-title");
const providerSectionHint = query<HTMLElement>("#provider-section-hint");
const targetSectionTitle = query<HTMLElement>("#target-section-title");
const targetForm = query<HTMLFormElement>("#target-form");
const editingId = query<HTMLInputElement>("#editing-id");
const targetName = query<HTMLInputElement>("#target-name");
const targetType = query<HTMLSelectElement>("#target-type");
const targetTypeLabel = query<HTMLElement>("#target-type-label");
const targetIdLabel = query<HTMLElement>("#target-id-label");
const targetId = query<HTMLInputElement>("#target-id");
const targetIdHelp = query<HTMLElement>("#target-id-help");
const titleProperty = query<HTMLInputElement>("#title-property");
const titlePropertyField = query<HTMLElement>("#title-property-field");
const feishuSpaceId = query<HTMLInputElement>("#feishu-space-id");
const feishuSpaceField = query<HTMLElement>("#feishu-space-field");
const obsidianFileTemplate = query<HTMLInputElement>("#obsidian-file-template");
const obsidianTemplateField = query<HTMLElement>("#obsidian-template-field");
const advancedTargetOptions = query<HTMLDetailsElement>("#advanced-target-options");
const cancelEditButton = query<HTMLButtonElement>("#reset-form");
const targetSubmitButton = query<HTMLButtonElement>("#target-submit");
const targetList = query<HTMLElement>("#target-list");
const saveStatus = query<HTMLElement>("#save-status");
const prefContext = query<HTMLInputElement>("#pref-context");
const prefAi = query<HTMLInputElement>("#pref-ai");
const prefSource = query<HTMLInputElement>("#pref-source");
const prefLanguage = query<HTMLSelectElement>("#pref-language");
const titleTemplate = query<HTMLInputElement>("#title-template");
const copyDiagnosticsButton = query<HTMLButtonElement>("#copy-diagnostics");
const exportConfigButton = query<HTMLButtonElement>("#export-config");
const importConfigButton = query<HTMLButtonElement>("#import-config");
const importConfigFile = query<HTMLInputElement>("#import-config-file");

void init();

async function init(): Promise<void> {
  settings = await getSettings();
  i18n = getI18n(settings.preferences.languagePreference);
  translateOptionsPage();
  buildId.textContent = MARKDROP_BUILD_ID;
  renderSettings();

  document.querySelectorAll<HTMLButtonElement>("[data-provider-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const provider = parseProvider(button.dataset.providerTab);
      switchProvider(provider);
    });
  });

  targetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void upsertTarget();
  });

  cancelEditButton.addEventListener("click", () => {
    resetTargetForm();
  });

  query<HTMLButtonElement>("#copy-feishu-redirect").addEventListener("click", () => {
    void copyFeishuRedirectUrl();
  });
  query<HTMLButtonElement>("#feishu-login").addEventListener("click", () => {
    void loginFeishu();
  });
  query<HTMLButtonElement>("#feishu-logout").addEventListener("click", () => {
    void logoutFeishu();
  });
  targetType.addEventListener("change", updateTargetFormForProvider);
  copyDiagnosticsButton.addEventListener("click", () => {
    void copyDiagnosticsReport();
  });
  exportConfigButton.addEventListener("click", () => {
    void exportConfig();
  });
  importConfigButton.addEventListener("click", () => {
    importConfigFile.click();
  });
  importConfigFile.addEventListener("change", () => {
    void importConfig();
  });

  // 即改即存：连接字段 + 偏好。change 事件在 input 失焦且值变化时触发。
  const autoSaveInputs: HTMLInputElement[] = [
    notionToken,
    feishuAppId,
    feishuAppSecret,
    obsidianApiUrl,
    obsidianApiKey,
    obsidianVaultName,
    titleTemplate,
  ];
  for (const input of autoSaveInputs) {
    input.addEventListener("change", () => {
      void persistGlobalFields();
    });
  }
  const autoSaveCheckboxes: HTMLInputElement[] = [prefContext, prefAi, prefSource];
  for (const cb of autoSaveCheckboxes) {
    cb.addEventListener("change", () => {
      void persistGlobalFields();
    });
  }

  prefLanguage.addEventListener("change", () => {
    void persistGlobalFields({ rerender: true });
  });

  await refreshFeishuAuthStatus();
}

function renderSettings(): void {
  notionToken.value = settings.notionToken;
  feishuAppId.value = settings.feishu.appId;
  feishuAppSecret.value = settings.feishu.appSecret;
  obsidianApiUrl.value = settings.obsidian.apiUrl;
  obsidianApiKey.value = settings.obsidian.apiKey;
  obsidianVaultName.value = settings.obsidian.vaultName || "";
  renderFeishuAuthStatus();
  prefContext.checked = settings.preferences.enableContextMenu;
  prefAi.checked = settings.preferences.enableAiButtons;
  prefSource.checked = settings.preferences.includeSourceUrl;
  prefLanguage.value = settings.preferences.languagePreference;
  titleTemplate.value = settings.preferences.titleTemplate;
  translateOptionsPage();
  renderProviderPanels();
  renderTargetCounts();
  renderTargetTypeOptions();
  renderTargets();
}

function translateOptionsPage(): void {
  document.documentElement.lang = i18n.language;
  document.title = t("options.documentTitle");
  applyElementTranslations(document, i18n);
}

function t(key: string, replacements?: Record<string, string | number | boolean | undefined>): string {
  return i18n.t(key, replacements);
}

function switchProvider(provider: Platform): void {
  activeProvider = provider;
  resetTargetForm();
  renderProviderPanels();
  renderTargetTypeOptions();
  renderTargets();
}

function renderProviderPanels(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-provider-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.providerTab === activeProvider);
  });

  notionPanel.hidden = activeProvider !== "notion";
  feishuPanel.hidden = activeProvider !== "feishu";
  obsidianPanel.hidden = activeProvider !== "obsidian";
  providerSectionTitle.textContent = t("options.connectionTitle", { provider: providerLabel(activeProvider) });
  providerSectionHint.textContent = providerHint(activeProvider);
  targetSectionTitle.textContent = t("options.targetTitle", { provider: providerLabel(activeProvider) });
}

type ConnectionState = "ready" | "pending" | "missing";

function applyConnectionStatus(element: HTMLElement, state: ConnectionState): void {
  const text =
    state === "ready" ? t("common.connected") : state === "pending" ? t("common.pendingLogin") : t("common.notConfigured");
  element.textContent = text;
  element.classList.toggle("is-ready", state === "ready");
  element.classList.toggle("is-warning", state !== "ready");
}

function renderTargetCounts(): void {
  const notionCount = settings.targets.filter((target) => targetProvider(target) === "notion").length;
  const feishuCount = settings.targets.filter((target) => targetProvider(target) === "feishu").length;
  const obsidianCount = settings.targets.filter((target) => targetProvider(target) === "obsidian").length;
  notionTargetCount.textContent = t("common.targetCount", { count: notionCount });
  feishuTargetCount.textContent = t("common.targetCount", { count: feishuCount });
  obsidianTargetCount.textContent = t("common.targetCount", { count: obsidianCount });

  applyConnectionStatus(notionConnectionStatus, settings.notionToken ? "ready" : "missing");

  const feishuConnected = Boolean(settings.feishu.accessToken || settings.feishu.refreshToken);
  const feishuConfigured = Boolean(settings.feishu.appId && settings.feishu.appSecret);
  const feishuState: ConnectionState = feishuConnected ? "ready" : feishuConfigured ? "pending" : "missing";
  applyConnectionStatus(feishuConnectionStatus, feishuState);

  const obsidianConfigured = Boolean(settings.obsidian.apiUrl && settings.obsidian.apiKey);
  applyConnectionStatus(obsidianConnectionStatus, obsidianConfigured ? "ready" : "missing");
}

function renderTargetTypeOptions(): void {
  if (activeProvider === "feishu") {
    targetType.innerHTML = `
      <option value="folder">${escapeHtml(t("options.feishuFolder"))}</option>
      <option value="wiki">${escapeHtml(t("options.feishuWiki"))}</option>
    `;
  } else if (activeProvider === "obsidian") {
    targetType.innerHTML = `
      <option value="folder">${escapeHtml(t("options.obsidianFolder"))}</option>
    `;
  } else {
    const legacy = editingLegacyDatabase
      ? `<option value="database">${escapeHtml(t("options.legacyDatabase"))}</option>`
      : "";
    targetType.innerHTML = `
      <option value="page">Page</option>
      <option value="data_source">Data Source / Database</option>
      ${legacy}
    `;
  }

  updateTargetFormForProvider();
}

function renderTargets(): void {
  const targets = settings.targets.filter((target) => targetProvider(target) === activeProvider);

  if (!targets.length) {
    targetList.innerHTML = `<p class="hint">${emptyTargetMessage(activeProvider)}</p>`;
    return;
  }

  targetList.innerHTML = targets.map(renderTargetItem).join("");

  targetList.querySelectorAll<HTMLElement>("[data-target-id]").forEach((item) => {
    item.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
      if (!button) {
        return;
      }

      const id = item.dataset.targetId;
      if (!id) {
        return;
      }

      if (button.dataset.action === "edit") {
        editTarget(id);
      }

      if (button.dataset.action === "delete") {
        void deleteTarget(id);
      }

      if (button.dataset.action === "default") {
        void setDefaultTarget(id);
      }

      if (button.dataset.action === "test") {
        void testSavedTarget(id);
      }
    });
  });
}

function renderTargetItem(target: SaveTarget): string {
  const meta = renderTargetMeta(target);
  const type = renderTargetTypeLabel(target);
  const detail = renderTargetDetail(target);

  return `
    <article class="target-item" data-target-id="${escapeAttribute(target.id)}">
      <div>
        <div class="target-name">
          <span>${escapeHtml(targetDisplayName(target))}</span>
          ${target.isDefault ? `<span class="badge">${escapeHtml(t("common.default"))}</span>` : ""}
        </div>
        <div class="target-meta-grid">
          <span>${escapeHtml(type)}</span>
          <span title="${escapeAttribute(detail)}">${escapeHtml(detail)}</span>
        </div>
        <div class="target-meta">${meta}</div>
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-action="test">${escapeHtml(t("common.test"))}</button>
        <button type="button" class="secondary" data-action="default">${escapeHtml(t("common.setDefault"))}</button>
        <button type="button" class="secondary" data-action="edit">${escapeHtml(t("common.edit"))}</button>
        <button type="button" class="danger" data-action="delete">${escapeHtml(t("common.delete"))}</button>
      </div>
    </article>
  `;
}

async function upsertTarget(): Promise<void> {
  const next = readTargetForm(editingId.value || crypto.randomUUID());

  if (!isValidTarget(next)) {
    showStatus(t("options.fillRequired"), true);
    return;
  }

  if (settings.targets.length === 0) {
    next.isDefault = true;
  }

  const existingIndex = settings.targets.findIndex((target) => target.id === next.id);
  if (existingIndex >= 0) {
    settings.targets[existingIndex] = next;
  } else {
    settings.targets.push(next);
  }

  if (next.isDefault) {
    settings.defaultTargetId = next.id;
    settings.targets = settings.targets.map((target) => ({ ...target, isDefault: target.id === next.id }));
  }

  await saveSettings(settings);
  settings = await getSettings();
  resetTargetForm();
  renderSettings();
  showStatus(t("options.targetSaved"));
}

async function testSavedTarget(id: string): Promise<void> {
  const target = settings.targets.find((item) => item.id === id);
  if (!target) {
    showStatus(t("options.targetMissing"), true);
    return;
  }

  showStatus(t("options.testingTarget", { target: targetDisplayName(target) }));

  try {
    const result = await chrome.runtime.sendMessage({
      type: testMessageType(target),
      payload: testMessagePayload(target),
    });

    if (result?.ok) {
      if (result.feishu) {
        settings.feishu = result.feishu;
        renderFeishuAuthStatus();
      }
      showStatus(t("options.targetAvailable", { target: targetDisplayName(target) }));
    } else {
      showStatus(formatUserFacingError(result?.error || t("options.testFailed"), "test", settings.preferences.languagePreference), true);
    }
  } catch (error) {
    showStatus(formatUserFacingError(error, "test", settings.preferences.languagePreference), true);
  }
}

function readTargetForm(id: string): SaveTarget {
  const isEditing = Boolean(editingId.value);
  const existing = isEditing ? settings.targets.find((t) => t.id === id) : undefined;
  const isDefault = existing?.isDefault ?? false;

  if (activeProvider === "feishu") {
    const feishuTargetType = targetType.value as FeishuTargetType;
    const parsed = parseFeishuTargetInput(feishuTargetType, targetId.value.trim(), feishuSpaceId.value.trim());
    return {
      id,
      name: targetName.value.trim(),
      provider: "feishu",
      platform: "feishu",
      feishuTargetType,
      feishuTargetToken: parsed.token,
      feishuSpaceId: parsed.spaceId,
      isDefault,
    };
  }

  if (activeProvider === "obsidian") {
    return {
      id,
      name: targetName.value.trim(),
      provider: "obsidian",
      platform: "obsidian",
      obsidianTargetType: targetType.value as ObsidianTargetType,
      obsidianFolderPath: targetId.value.trim(),
      obsidianFileNameTemplate: obsidianFileTemplate.value.trim() || "{title}",
      isDefault,
    };
  }

  return {
    id,
    name: targetName.value.trim(),
    provider: "notion",
    platform: "notion",
    notionTargetType: targetType.value as NotionTargetType,
    notionTargetId: targetId.value.trim(),
    titlePropertyName: titleProperty.value.trim() || "Name",
    isDefault,
  };
}

async function persistGlobalFields(options: { rerender?: boolean } = {}): Promise<void> {
  applyPreferenceFields();
  await saveSettings(settings);
  settings = await getSettings();
  i18n = getI18n(settings.preferences.languagePreference);
  if (options.rerender) {
    renderSettings();
  } else {
    translateOptionsPage();
    renderTargetCounts();
    renderFeishuAuthStatus();
  }
  showStatus(t("options.globalSaved"));
}

function applyPreferenceFields(): void {
  settings.notionToken = notionToken.value.trim();
  settings.feishu = {
    ...settings.feishu,
    appId: feishuAppId.value.trim(),
    appSecret: feishuAppSecret.value.trim(),
  };
  settings.obsidian = {
    ...settings.obsidian,
    apiUrl: obsidianApiUrl.value.trim(),
    apiKey: obsidianApiKey.value.trim(),
    vaultName: obsidianVaultName.value.trim(),
  };
  settings.preferences = {
    showFloatingButton: false,
    enableContextMenu: prefContext.checked,
    enableAiButtons: prefAi.checked,
    includeSourceUrl: prefSource.checked,
    titleTemplate: titleTemplate.value.trim() || "{pageTitle} - {date}",
    languagePreference: prefLanguage.value as LanguagePreference,
  };
}

async function loginFeishu(): Promise<void> {
  applyPreferenceFields();
  await saveSettings(settings);
  showStatus(t("options.openingFeishu"));

  try {
    const result = await chrome.runtime.sendMessage({
      type: "MARKDROP_FEISHU_LOGIN",
      payload: {
        feishu: {
          ...settings.feishu,
          appId: feishuAppId.value.trim(),
          appSecret: feishuAppSecret.value.trim(),
        },
      },
    });

    if (!result?.ok) {
      showStatus(formatUserFacingError(result?.error || t("options.feishuLoginFailed"), "auth", settings.preferences.languagePreference), true);
      return;
    }

    settings = await getSettings();
    renderSettings();
    showStatus(t("options.feishuConnected"));
  } catch (error) {
    showStatus(formatUserFacingError(error, "auth", settings.preferences.languagePreference), true);
  }
}

async function logoutFeishu(): Promise<void> {
  applyPreferenceFields();
  showStatus(t("options.disconnectingFeishu"));

  try {
    const result = await chrome.runtime.sendMessage({
      type: "MARKDROP_FEISHU_LOGOUT",
      payload: {
        feishu: settings.feishu,
      },
    });

    if (!result?.ok) {
      showStatus(formatUserFacingError(result?.error || t("options.feishuLogoutFailed"), "auth", settings.preferences.languagePreference), true);
      return;
    }

    settings = await getSettings();
    renderSettings();
    showStatus(t("options.feishuDisconnected"));
  } catch (error) {
    showStatus(formatUserFacingError(error, "auth", settings.preferences.languagePreference), true);
  }
}

async function refreshFeishuAuthStatus(): Promise<void> {
  try {
    const result = await chrome.runtime.sendMessage({
      type: "MARKDROP_FEISHU_AUTH_STATUS",
      payload: {
        feishu: settings.feishu,
      },
    });

    if (result?.redirectUrl) {
      feishuRedirectUrl.value = result.redirectUrl;
    }
  } catch {
    renderFeishuAuthStatus();
  }
}

function renderFeishuAuthStatus(): void {
  const connected = Boolean(settings.feishu.accessToken || settings.feishu.refreshToken);
  const expiresAt = settings.feishu.accessTokenExpiresAt
    ? new Date(settings.feishu.accessTokenExpiresAt).toLocaleString()
    : "";
  feishuAuthStatus.textContent = connected
    ? t("options.feishuConnectedWithExpiry", {
        expiry: expiresAt ? t("options.feishuTokenExpiry", { time: expiresAt }) : "。",
      })
    : t("options.feishuNotConnected");
}

async function copyFeishuRedirectUrl(): Promise<void> {
  const value = feishuRedirectUrl.value.trim();
  if (!value) {
    showStatus(t("options.redirectMissing"), true);
    return;
  }

  await navigator.clipboard.writeText(value);
  showStatus(t("options.redirectCopied"));
}

async function copyDiagnosticsReport(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get("markdrop.lastSave");
    const lastSave = stored["markdrop.lastSave"] as LastSaveState | undefined;
    await copyText(buildDiagnosticsReport(lastSave));
    showStatus(t("options.diagnosticsCopied"));
  } catch (error) {
    showStatus(formatUserFacingError(error, "test", settings.preferences.languagePreference), true);
  }
}

async function exportConfig(): Promise<void> {
  try {
    applyPreferenceFields();
    await saveSettings(settings);
    settings = await getSettings();

    const payload = {
      app: "Markdrop",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      buildId: MARKDROP_BUILD_ID,
      settings,
    };

    downloadJson(`markdrop-config-${formatDateTimeForFileName(new Date())}.json`, payload);
    showStatus(t("options.exportConfigDone"));
  } catch (error) {
    showStatus(`${t("options.exportConfigFailed")} ${readErrorMessage(error)}`, true);
  }
}

async function importConfig(): Promise<void> {
  const file = importConfigFile.files?.[0];
  importConfigFile.value = "";

  if (!file) {
    return;
  }

  try {
    const imported = parseImportedSettings(JSON.parse(await file.text()));
    const confirmed = window.confirm(t("options.importConfigConfirm"));
    if (!confirmed) {
      return;
    }

    await saveSettings(imported);
    settings = await getSettings();
    i18n = getI18n(settings.preferences.languagePreference);
    resetTargetForm();
    renderSettings();
    showStatus(t("options.importConfigDone"));
  } catch (error) {
    showStatus(`${t("options.importConfigFailed")} ${readErrorMessage(error)}`, true);
  }
}

function parseImportedSettings(raw: unknown): MarkdropSettings {
  const candidate = isRecord(raw) && isRecord(raw.settings) ? raw.settings : raw;
  if (!isRecord(candidate)) {
    throw new Error(t("options.importConfigInvalid"));
  }

  const hasSettingsShape = ["notionToken", "feishu", "obsidian", "targets", "preferences", "defaultTargetId"].some((key) => key in candidate);
  if (!hasSettingsShape) {
    throw new Error(t("options.importConfigInvalid"));
  }

  const partial = candidate as Partial<MarkdropSettings>;
  const feishu = isRecord(partial.feishu) ? (partial.feishu as Partial<MarkdropSettings["feishu"]>) : {};
  const obsidian = isRecord(partial.obsidian) ? (partial.obsidian as Partial<MarkdropSettings["obsidian"]>) : {};
  const preferences = isRecord(partial.preferences) ? (partial.preferences as Partial<MarkdropSettings["preferences"]>) : {};

  return {
    ...defaultSettings,
    notionToken: typeof partial.notionToken === "string" ? partial.notionToken : defaultSettings.notionToken,
    feishu: {
      ...defaultSettings.feishu,
      ...feishu,
    },
    obsidian: {
      ...defaultSettings.obsidian,
      ...obsidian,
    },
    targets: parseImportedTargets(partial.targets),
    defaultTargetId: typeof partial.defaultTargetId === "string" ? partial.defaultTargetId : undefined,
    preferences: {
      ...defaultSettings.preferences,
      ...preferences,
    },
  };
}

function parseImportedTargets(value: unknown): SaveTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((target): target is Record<string, unknown> => isRecord(target) && typeof target.name === "string")
    .map((target) => ({
      ...target,
      id: typeof target.id === "string" && target.id ? target.id : crypto.randomUUID(),
    })) as SaveTarget[];
}

function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatDateTimeForFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildDiagnosticsReport(lastSave?: LastSaveState): string {
  const targetCounts = {
    notion: settings.targets.filter((target) => targetProvider(target) === "notion").length,
    feishu: settings.targets.filter((target) => targetProvider(target) === "feishu").length,
    obsidian: settings.targets.filter((target) => targetProvider(target) === "obsidian").length,
  };
  const defaultTarget = settings.targets.find((target) => target.id === settings.defaultTargetId || target.isDefault);
  const sanitizedTargets = settings.targets.map((target) => ({
    provider: targetProvider(target),
    name: target.name,
    type: renderTargetTypeLabel(target),
    isDefault: Boolean(target.isDefault || target.id === settings.defaultTargetId),
  }));

  return [
    "# Markdrop Options Diagnostics",
    "",
    `Build: ${MARKDROP_BUILD_ID}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Connections",
    JSON.stringify(
      {
        notionTokenSet: Boolean(settings.notionToken),
        feishuAppConfigured: Boolean(settings.feishu.appId && settings.feishu.appSecret),
        feishuConnected: Boolean(settings.feishu.accessToken || settings.feishu.refreshToken),
        obsidianApiConfigured: Boolean(settings.obsidian.apiUrl && settings.obsidian.apiKey),
        obsidianVaultNameSet: Boolean(settings.obsidian.vaultName),
      },
      null,
      2,
    ),
    "",
    "## Targets",
    JSON.stringify(
      {
        counts: targetCounts,
        defaultTarget: defaultTarget ? `${providerLabel(targetProvider(defaultTarget))} - ${defaultTarget.name}` : "",
        targets: sanitizedTargets,
      },
      null,
      2,
    ),
    "",
    "## Preferences",
    JSON.stringify(settings.preferences, null, 2),
    "",
    "## Last Save",
    JSON.stringify(
      lastSave
        ? {
            ok: lastSave.ok,
            hasUrl: Boolean(lastSave.url),
            error: lastSave.error ? formatUserFacingError(lastSave.error, "save", settings.preferences.languagePreference) : "",
            time: lastSave.time ?? "",
          }
        : null,
      null,
      2,
    ),
  ].join("\n");
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
      throw new Error(t("options.clipboardFailed"));
    }
  }
}

function editTarget(id: string): void {
  const target = settings.targets.find((item) => item.id === id);
  if (!target) {
    return;
  }

  activeProvider = targetProvider(target);
  editingLegacyDatabase = isNotionTarget(target) && target.notionTargetType === "database";
  renderProviderPanels();
  renderTargetTypeOptions();

  editingId.value = target.id;
  targetName.value = target.name;

  if (isFeishuTarget(target)) {
    targetType.value = target.feishuTargetType;
    targetId.value = target.feishuTargetToken;
    feishuSpaceId.value = target.feishuSpaceId || "";
  } else if (isObsidianTarget(target)) {
    targetType.value = target.obsidianTargetType;
    targetId.value = target.obsidianFolderPath;
    obsidianFileTemplate.value = target.obsidianFileNameTemplate || "{title}";
  } else if (isNotionTarget(target)) {
    targetType.value = target.notionTargetType;
    targetId.value = target.notionTargetId;
    titleProperty.value = target.titlePropertyName || "Name";
  }

  updateTargetFormForProvider();
  cancelEditButton.hidden = false;
  targetSubmitButton.textContent = t("options.updateTarget");
  renderTargets();
  targetName.focus();
}

async function deleteTarget(id: string): Promise<void> {
  settings.targets = settings.targets.filter((target) => target.id !== id);
  if (settings.defaultTargetId === id) {
    settings.defaultTargetId = settings.targets[0]?.id;
    settings.targets = settings.targets.map((target, index) => ({
      ...target,
      isDefault: index === 0,
    }));
  }

  await saveSettings(settings);
  settings = await getSettings();
  renderSettings();
  showStatus(t("options.targetDeleted"));
}

async function setDefaultTarget(id: string): Promise<void> {
  settings.defaultTargetId = id;
  settings.targets = settings.targets.map((target) => ({
    ...target,
    isDefault: target.id === id,
  }));

  await saveSettings(settings);
  settings = await getSettings();
  renderSettings();
  showStatus(t("options.defaultUpdated"));
}

function resetTargetForm(): void {
  editingId.value = "";
  targetName.value = "";
  targetId.value = "";
  titleProperty.value = "Name";
  feishuSpaceId.value = "";
  obsidianFileTemplate.value = "{title}";
  editingLegacyDatabase = false;
  cancelEditButton.hidden = true;
  targetSubmitButton.textContent = t("options.addTarget");
  renderTargetTypeOptions();
}

function updateTargetFormForProvider(): void {
  if (activeProvider === "feishu") {
    targetTypeLabel.textContent = t("options.type");
    targetIdLabel.textContent = targetType.value === "wiki" ? t("options.feishuWikiTargetId") : t("options.feishuFolderTargetId");
    targetId.placeholder =
      targetType.value === "wiki"
        ? t("options.feishuWikiPlaceholder")
        : t("options.feishuFolderPlaceholder");
    targetIdHelp.textContent =
      targetType.value === "wiki"
        ? t("options.feishuWikiHelp")
        : t("options.feishuFolderHelp");
    titlePropertyField.hidden = true;
    feishuSpaceField.hidden = targetType.value !== "wiki";
    obsidianTemplateField.hidden = true;
  } else if (activeProvider === "obsidian") {
    targetTypeLabel.textContent = t("options.type");
    targetIdLabel.textContent = t("options.obsidianFolderPath");
    targetId.placeholder = t("options.obsidianFolderPlaceholder");
    targetIdHelp.textContent = t("options.obsidianFolderHelp");
    titlePropertyField.hidden = true;
    feishuSpaceField.hidden = true;
    obsidianTemplateField.hidden = false;
  } else {
    targetTypeLabel.textContent = t("options.type");
    targetIdLabel.textContent = t("options.notionTargetId");
    targetId.placeholder = t("options.notionTargetPlaceholder");
    targetIdHelp.textContent =
      targetType.value === "page"
        ? t("options.notionPageHelp")
        : t("options.notionDataSourceHelp");
    titlePropertyField.hidden = targetType.value === "page";
    feishuSpaceField.hidden = true;
    obsidianTemplateField.hidden = true;
  }

  const hasMoreOptions = !feishuSpaceField.hidden || !obsidianTemplateField.hidden;
  advancedTargetOptions.hidden = !hasMoreOptions;
  if (!hasMoreOptions) {
    advancedTargetOptions.open = false;
  }
}

function isValidTarget(target: SaveTarget): boolean {
  if (!target.name) {
    return false;
  }

  if (isFeishuTarget(target)) {
    return Boolean(target.feishuTargetToken);
  }

  if (isObsidianTarget(target)) {
    return Boolean(target.obsidianFolderPath);
  }

  return Boolean(target.notionTargetId);
}

function showStatus(message: string, isError = false): void {
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? "#b91c1c" : "#047857";
  window.setTimeout(() => {
    if (saveStatus.textContent === message) {
      saveStatus.textContent = "";
    }
  }, isError ? 9000 : 2400);
}

function labelForNotionType(type: NotionTargetType): string {
  if (type === "page") {
    return t("options.labelNotionPage");
  }

  if (type === "database") {
    return t("options.legacyDatabase");
  }

  return t("options.labelNotionDataSource");
}

function labelForFeishuType(type: FeishuTargetType): string {
  return type === "wiki" ? t("options.labelFeishuWiki") : t("options.labelFeishuFolder");
}

function labelForObsidianType(type: ObsidianTargetType): string {
  return type === "folder" ? t("options.labelObsidianFolder") : "Obsidian";
}

function renderTargetMeta(target: SaveTarget): string {
  if (isFeishuTarget(target)) {
    return `${labelForFeishuType(target.feishuTargetType)} - ${escapeHtml(target.feishuTargetToken)}`;
  }

  if (isObsidianTarget(target)) {
    return `${labelForObsidianType(target.obsidianTargetType)} - ${escapeHtml(target.obsidianFolderPath)}`;
  }

  return `${labelForNotionType(target.notionTargetType)} - ${escapeHtml(target.notionTargetId)}`;
}

function renderTargetTypeLabel(target: SaveTarget): string {
  if (isFeishuTarget(target)) {
    return labelForFeishuType(target.feishuTargetType);
  }

  if (isObsidianTarget(target)) {
    return labelForObsidianType(target.obsidianTargetType);
  }

  return labelForNotionType(target.notionTargetType);
}

function renderTargetDetail(target: SaveTarget): string {
  if (isFeishuTarget(target)) {
    return target.feishuTargetToken;
  }

  if (isObsidianTarget(target)) {
    return target.obsidianFolderPath;
  }

  return target.notionTargetId;
}

function targetDisplayName(target: SaveTarget): string {
  return `${providerLabel(targetProvider(target))} - ${target.name}`;
}

function testMessageType(target: SaveTarget): string {
  if (isFeishuTarget(target)) {
    return "MARKDROP_TEST_FEISHU_TARGET";
  }

  if (isObsidianTarget(target)) {
    return "MARKDROP_TEST_OBSIDIAN_TARGET";
  }

  return "MARKDROP_TEST_NOTION_TARGET";
}

function testMessagePayload(target: SaveTarget): Record<string, unknown> {
  if (isFeishuTarget(target)) {
    return {
      feishu: settings.feishu,
      target,
    };
  }

  if (isObsidianTarget(target)) {
    return {
      obsidian: settings.obsidian,
      target,
    };
  }

  return {
    token: notionToken.value.trim(),
    target,
  };
}

function parseProvider(value: string | undefined): Platform {
  return value === "feishu" || value === "obsidian" ? value : "notion";
}

function providerLabel(provider: Platform): string {
  if (provider === "feishu") {
    return "Feishu";
  }

  if (provider === "obsidian") {
    return "Obsidian";
  }

  return "Notion";
}

function providerHint(provider: Platform): string {
  if (provider === "feishu") {
    return t("options.feishuHint");
  }

  if (provider === "obsidian") {
    return t("options.obsidianHint");
  }

  return t("options.notionHint");
}

function emptyTargetMessage(provider: Platform): string {
  if (provider === "feishu") {
    return t("options.emptyFeishu");
  }

  if (provider === "obsidian") {
    return t("options.emptyObsidian");
  }

  return t("options.emptyNotion");
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
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
