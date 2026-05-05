import type { FeishuAuthInput, FeishuApiResponse } from "./types";
import type { FeishuSettings } from "../../utils/types";

const FEISHU_AUTH_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const FEISHU_OAUTH_AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const FEISHU_OAUTH_TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const FEISHU_OAUTH_SCOPES = [
  "offline_access",
  "docx:document:create",
  "docx:document:readonly",
  "docx:document:write_only",
  "docx:document.block:convert",
  "drive:drive",
  "wiki:wiki",
];
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

export async function getTenantAccessToken(feishu: FeishuAuthInput): Promise<string> {
  if (!feishu.appId || !feishu.appSecret) {
    throw new Error("Fill in Feishu App ID and App Secret first.");
  }

  const response = await fetch(FEISHU_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: feishu.appId,
      app_secret: feishu.appSecret,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as FeishuApiResponse;
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(data.msg || `Feishu auth failed: ${response.status}`);
  }

  return data.tenant_access_token;
}

interface FeishuOAuthTokenData {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  token_type?: string;
  scope?: string;
}

interface FeishuOAuthTokenResponse extends FeishuApiResponse<FeishuOAuthTokenData> {}
type FeishuOAuthRawResponse = FeishuOAuthTokenResponse &
  FeishuOAuthTokenData & {
    error?: string;
    error_description?: string;
  };

export interface FeishuOAuthStatus {
  redirectUrl: string;
  connected: boolean;
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
}

export function getFeishuOAuthRedirectUrl(): string {
  return chrome.identity.getRedirectURL("feishu");
}

export function getFeishuOAuthStatus(feishu: FeishuSettings): FeishuOAuthStatus {
  return {
    redirectUrl: getFeishuOAuthRedirectUrl(),
    connected: Boolean(feishu.accessToken || feishu.refreshToken),
    accessTokenExpiresAt: feishu.accessTokenExpiresAt,
    refreshTokenExpiresAt: feishu.refreshTokenExpiresAt,
  };
}

export async function runFeishuOAuthLogin(feishu: FeishuSettings): Promise<FeishuSettings> {
  assertFeishuOAuthConfig(feishu);

  const redirectUri = getFeishuOAuthRedirectUrl();
  const state = crypto.randomUUID();
  const authorizeUrl = new URL(FEISHU_OAUTH_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", feishu.appId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", FEISHU_OAUTH_SCOPES.join(" "));

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authorizeUrl.toString(),
    interactive: true,
  });

  if (!responseUrl) {
    throw new Error("Feishu login was cancelled.");
  }

  const resultUrl = new URL(responseUrl);
  const error = resultUrl.searchParams.get("error") || resultUrl.searchParams.get("error_description");
  if (error) {
    throw new Error(error);
  }

  if (resultUrl.searchParams.get("state") !== state) {
    throw new Error("Feishu login state mismatch. Please try again.");
  }

  const code = resultUrl.searchParams.get("code");
  if (!code) {
    throw new Error("Feishu login did not return an authorization code.");
  }

  return applyFeishuOAuthToken(
    feishu,
    await requestFeishuOAuthToken({
      grant_type: "authorization_code",
      client_id: feishu.appId,
      client_secret: feishu.appSecret,
      code,
      redirect_uri: redirectUri,
    }),
  );
}

export async function getFeishuUserAccessToken(feishu: FeishuSettings): Promise<{ accessToken: string; feishu: FeishuSettings }> {
  assertFeishuOAuthConfig(feishu);

  const now = Date.now();
  if (feishu.accessToken && (feishu.accessTokenExpiresAt ?? 0) > now + TOKEN_REFRESH_SKEW_MS) {
    return { accessToken: feishu.accessToken, feishu };
  }

  if (feishu.refreshToken && (!feishu.refreshTokenExpiresAt || feishu.refreshTokenExpiresAt > now + TOKEN_REFRESH_SKEW_MS)) {
    let nextFeishu: FeishuSettings;
    try {
      nextFeishu = applyFeishuOAuthToken(
        feishu,
        await requestFeishuOAuthToken({
          grant_type: "refresh_token",
          client_id: feishu.appId,
          client_secret: feishu.appSecret,
          refresh_token: feishu.refreshToken,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/refresh token|revoked|used once/i.test(message)) {
        throw new Error("Feishu authorization expired. Please log in with Feishu again in Markdrop settings.");
      }

      throw error;
    }

    if (nextFeishu.accessToken) {
      return { accessToken: nextFeishu.accessToken, feishu: nextFeishu };
    }
  }

  throw new Error("Connect your Feishu account in Markdrop settings first.");
}

export function clearFeishuOAuthTokens(feishu: FeishuSettings): FeishuSettings {
  return {
    appId: feishu.appId,
    appSecret: feishu.appSecret,
  };
}

function assertFeishuOAuthConfig(feishu: FeishuSettings): void {
  if (!feishu.appId || !feishu.appSecret) {
    throw new Error("Fill in Feishu App ID and App Secret first.");
  }
}

function applyFeishuOAuthToken(feishu: FeishuSettings, token: FeishuOAuthTokenData): FeishuSettings {
  if (!token.access_token) {
    throw new Error("Feishu did not return a user access token.");
  }

  const now = Date.now();
  return {
    ...feishu,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || feishu.refreshToken,
    accessTokenExpiresAt: token.expires_in ? now + token.expires_in * 1000 : undefined,
    refreshTokenExpiresAt: token.refresh_expires_in ? now + token.refresh_expires_in * 1000 : feishu.refreshTokenExpiresAt,
    connectedAt: feishu.connectedAt || now,
  };
}

async function requestFeishuOAuthToken(body: Record<string, string>): Promise<FeishuOAuthTokenData> {
  const response = await fetch(FEISHU_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const result = (await response.json().catch(() => ({}))) as FeishuOAuthRawResponse;
  const token = normalizeFeishuOAuthTokenResponse(result);
  if (!response.ok || !token?.access_token) {
    const detail = result.error_description || result.error || result.msg || oauthResponseShapeHint(result);
    throw new Error(detail || `Feishu OAuth failed: ${response.status}`);
  }

  return token;
}

function normalizeFeishuOAuthTokenResponse(result: FeishuOAuthRawResponse): FeishuOAuthTokenData | null {
  if (result.data?.access_token) {
    return result.data;
  }

  if (result.access_token) {
    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_in: result.expires_in,
      refresh_expires_in: result.refresh_expires_in,
      token_type: result.token_type,
      scope: result.scope,
    };
  }

  return null;
}

function oauthResponseShapeHint(result: FeishuOAuthRawResponse): string {
  const keys = Object.keys(result);
  return keys.length ? `Feishu OAuth response did not include access_token. Keys: ${keys.join(", ")}` : "";
}
