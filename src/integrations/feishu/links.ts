import type { FeishuTargetType } from "../../utils/types";

export interface ParsedFeishuTarget {
  token: string;
  spaceId?: string;
}

export function parseFeishuTargetInput(
  type: FeishuTargetType,
  input: string,
  explicitSpaceId = "",
): ParsedFeishuTarget {
  const trimmed = input.trim();
  const parsed = parseUrl(trimmed);
  const explicitSpace = cleanupToken(explicitSpaceId);

  if (!parsed) {
    return {
      token: cleanupToken(trimmed),
      spaceId: explicitSpace || undefined,
    };
  }

  const search = combinedSearchParams(parsed);
  const spaceId =
    explicitSpace ||
    firstPresent(
      search.get("space_id"),
      search.get("spaceId"),
      search.get("wiki_space_id"),
      search.get("wikiSpaceId"),
      spaceIdFromPath(type, parsed),
    );

  const tokenFromQuery = firstPresent(
    search.get("token"),
    search.get("node_token"),
    search.get("nodeToken"),
    search.get("wiki_node_token"),
    search.get("wikiNodeToken"),
    search.get("folder_token"),
    search.get("folderToken"),
  );

  return {
    token: cleanupToken(tokenFromQuery || tokenFromPath(type, parsed)),
    spaceId: spaceId ? cleanupToken(spaceId) : undefined,
  };
}

function tokenFromPath(type: FeishuTargetType, url: URL): string {
  const segments = url.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment.trim()))
    .filter(Boolean);

  if (type === "folder") {
    return valueAfter(segments, "folder") || valueAfter(segments, "folders");
  }

  return (
    valueAfter(segments, "wiki_node") ||
    valueAfter(segments, "node") ||
    valueAfter(segments, "docx") ||
    wikiTokenAfterWikiSegment(segments) ||
    ""
  );
}

function spaceIdFromPath(type: FeishuTargetType, url: URL): string {
  if (type !== "wiki") {
    return "";
  }

  const segments = url.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment.trim()))
    .filter(Boolean);
  return valueAfter(segments, "space") || valueAfter(segments, "spaces");
}

function wikiTokenAfterWikiSegment(segments: string[]): string {
  const value = valueAfter(segments, "wiki");
  return value && !["space", "spaces", "node", "wiki_node"].includes(value.toLowerCase()) ? value : "";
}

function valueAfter(segments: string[], marker: string): string {
  const index = segments.findIndex((segment) => segment.toLowerCase() === marker);
  return index >= 0 ? segments[index + 1] ?? "" : "";
}

function combinedSearchParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search);
  const hash = url.hash.replace(/^#/, "");
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash;

  new URLSearchParams(hashQuery).forEach((value, key) => {
    if (!params.has(key)) {
      params.set(key, value);
    }
  });

  return params;
}

function firstPresent(...values: Array<string | null | undefined>): string {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? "";
}

function cleanupToken(value: string): string {
  return value.trim().replace(/[?#].*$/, "").replace(/^['"]|['"]$/g, "");
}

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}
