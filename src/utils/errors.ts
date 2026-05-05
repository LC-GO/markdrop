import { getI18n, type LanguagePreference } from "./i18n";

export type ErrorContext = "save" | "test" | "auth";

export function formatUserFacingError(
  error: unknown,
  context: ErrorContext = "save",
  languagePreference: LanguagePreference = "auto",
): string {
  const i18n = getI18n(languagePreference);
  const raw = errorToString(error);
  const normalized = raw.toLowerCase();
  const fallbackKey =
    context === "auth" ? "errors.fallback.auth" : context === "test" ? "errors.fallback.test" : "errors.fallback.save";

  if (!raw) {
    return i18n.t(fallbackKey);
  }

  const hintKey = matchErrorHintKey(normalized, context);
  if (!hintKey) {
    return raw;
  }

  return `${i18n.t(hintKey)} ${i18n.t("errors.rawPrefix", { raw })}`;
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }

  if (typeof error === "string") {
    return error.trim();
  }

  if (error === null || error === undefined) {
    return "";
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function matchErrorHintKey(message: string, context: ErrorContext): string | null {
  if (
    message.includes("refresh token has been revoked") ||
    message.includes("refresh token can only be used once") ||
    message.includes("invalid_grant")
  ) {
    return "errors.feishuRefreshRevoked";
  }

  if (
    message.includes("docx:document.block:convert") ||
    message.includes("99991679") ||
    message.includes("no folder permission") ||
    message.includes("folder permission") ||
    message.includes("unauthorized") ||
    message.includes("permission") ||
    message.includes("forbidden") ||
    message.includes("403")
  ) {
    return "errors.permission";
  }

  if (
    message.includes("cannot reach obsidian") ||
    message.includes("self-signed") ||
    message.includes("err_cert") ||
    message.includes("local rest api") ||
    message.includes("127.0.0.1")
  ) {
    return "errors.obsidianConnection";
  }

  if (message.includes("failed to fetch") || message.includes("networkerror") || message.includes("load failed")) {
    return "errors.network";
  }

  if (
    message.includes("vault not found") ||
    message.includes("unable to find a vault") ||
    message.includes("object_not_found") ||
    message.includes("could not find block") ||
    message.includes("could not find page") ||
    message.includes("make sure the relevant pages and databases are shared") ||
    message.includes("not found") ||
    message.includes("404")
  ) {
    return "errors.notFound";
  }

  if (message.includes("path failed validation") || message.includes("should be a valid uuid")) {
    return "errors.notionId";
  }

  if (message.includes("invalid param") || message.includes("field validation failed") || message.includes("1770001")) {
    return "errors.invalidParam";
  }

  if (message.includes("invalid token") || message.includes("invalid api key") || message.includes("401")) {
    return "errors.invalidToken";
  }

  if (message.includes("timeout") || message.includes("timed out") || message.includes("超时")) {
    return "errors.timeout";
  }

  if (context === "auth") {
    return "errors.authGeneric";
  }

  return null;
}
