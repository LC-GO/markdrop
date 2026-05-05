import { markdownToNotionBlocks, sourceUrlBlock, type NotionBlock } from "./notionBlocks";
import { isNotionTarget } from "./types";
import type { MarkdropSettings, NotionSaveTarget, SaveRequest, SaveResult, SaveTarget } from "./types";

const NOTION_API_VERSION = "2026-03-11";
const LEGACY_DATABASE_API_VERSION = "2022-06-28";
const MAX_CHILDREN_PER_REQUEST = 100;

interface NotionPageResponse {
  id: string;
  url?: string;
  message?: string;
  code?: string;
  object?: string;
  title?: Array<{ plain_text?: string }>;
  properties?: Record<string, unknown>;
  data_sources?: Array<{ id: string; name?: string }>;
}

type ResolvedDataSourceTarget =
  | { ok: true; target: NotionSaveTarget; url?: string }
  | { ok: false; error: string };

export async function saveMarkdownToNotion(
  settings: MarkdropSettings,
  request: SaveRequest,
): Promise<SaveResult> {
  const target = settings.targets.find((item): item is NotionSaveTarget => item.id === request.targetId && isNotionTarget(item));

  if (!target) {
    return { ok: false, error: "没有找到这个常用存储目录。" };
  }

  if (!settings.notionToken) {
    return { ok: false, error: "请先在设置页填写 Notion Token。" };
  }

  const resolvedTarget = await resolveDataSourceTarget(settings.notionToken, target);
  if (!resolvedTarget.ok) {
    return resolvedTarget;
  }

  const body = buildCreatePageBody(resolvedTarget.target, request);
  const apiVersion = getApiVersion(resolvedTarget.target);
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": apiVersion,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as NotionPageResponse;

  if (!response.ok) {
    return {
      ok: false,
      error: data.message || `Notion API 请求失败：${response.status}`,
    };
  }

  const remainingBlocks = buildPageBlocks(request).slice(MAX_CHILDREN_PER_REQUEST);

  for (const chunk of chunkBlocks(remainingBlocks)) {
    const appendResult = await appendBlocks(settings.notionToken, data.id, chunk, apiVersion);
    if (!appendResult.ok) {
      return appendResult;
    }
  }

  return { ok: true, url: data.url };
}

export async function testNotionTarget(token: string, target: SaveTarget): Promise<SaveResult> {
  if (!isNotionTarget(target)) {
    return { ok: false, error: "This is not a Notion target." };
  }

  if (!token) {
    return { ok: false, error: "请先填写 Notion Token。" };
  }

  if (!target.notionTargetId) {
    return { ok: false, error: "请先填写 Notion 目标 ID 或 URL。" };
  }

  if (target.notionTargetType === "data_source") {
    const resolvedTarget = await resolveDataSourceTarget(token, target);
    if (!resolvedTarget.ok) {
      return resolvedTarget;
    }

    return {
      ok: true,
      url: resolvedTarget.url,
    };
  }

  const response = await fetch(getRetrieveUrl(target), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": getApiVersion(target),
    },
  });

  const data = (await response.json().catch(() => ({}))) as NotionPageResponse;

  if (!response.ok) {
    return {
      ok: false,
      error: data.message || `Notion 目录检测失败：${response.status}`,
    };
  }

  return {
    ok: true,
    url: data.url,
  };
}

function buildCreatePageBody(target: NotionSaveTarget, request: SaveRequest): Record<string, unknown> {
  const children = buildPageBlocks(request).slice(0, MAX_CHILDREN_PER_REQUEST);

  return {
    parent: buildParent(target),
    properties: buildProperties(target, request.title),
    children,
  };
}

function buildParent(target: NotionSaveTarget): Record<string, string> {
  const id = normalizeNotionId(target.notionTargetId);

  if (target.notionTargetType === "page") {
    return { type: "page_id", page_id: id };
  }

  if (target.notionTargetType === "database") {
    return { database_id: id };
  }

  return { type: "data_source_id", data_source_id: id };
}

function buildProperties(target: NotionSaveTarget, title: string): Record<string, unknown> {
  const titleValue = [{ text: { content: title.slice(0, 2000) || "Untitled" } }];

  if (target.notionTargetType === "page") {
    return { title: titleValue };
  }

  return {
    [target.titlePropertyName || "Name"]: {
      title: titleValue,
    },
  };
}

export function normalizeNotionId(input: string): string {
  const trimmed = input.trim();
  const urlPath = extractUrlPath(trimmed);
  const id = extractNotionId(urlPath) ?? extractNotionId(trimmed) ?? trimmed;
  const compactId = id.replaceAll("-", "");

  if (compactId.length !== 32) {
    return trimmed;
  }

  return `${compactId.slice(0, 8)}-${compactId.slice(8, 12)}-${compactId.slice(12, 16)}-${compactId.slice(16, 20)}-${compactId.slice(20)}`;
}

function extractUrlPath(input: string): string {
  try {
    return decodeURIComponent(new URL(input).pathname);
  } catch {
    return input;
  }
}

function extractNotionId(input: string): string | null {
  const hyphenatedMatches = Array.from(
    input.matchAll(/(?:^|[^a-f0-9])([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?=$|[^a-f0-9])/gi),
  );
  const lastHyphenated = hyphenatedMatches.at(-1)?.[1];
  if (lastHyphenated) {
    return lastHyphenated;
  }

  const compactMatches = Array.from(input.matchAll(/(?:^|[^a-f0-9])([a-f0-9]{32})(?=$|[^a-f0-9])/gi));
  return compactMatches.at(-1)?.[1] ?? null;
}

function buildPageBlocks(request: SaveRequest): NotionBlock[] {
  const blocks = markdownToNotionBlocks(request.markdown);
  if (!request.includeSourceUrl || !request.sourceUrl) {
    return blocks;
  }

  return [sourceUrlBlock(request.sourceUrl), ...blocks];
}

async function resolveDataSourceTarget(
  token: string,
  target: NotionSaveTarget,
): Promise<ResolvedDataSourceTarget> {
  if (target.notionTargetType !== "data_source") {
    return { ok: true, target };
  }

  const id = normalizeNotionId(target.notionTargetId);
  const direct = await retrieveNotionObject(
    token,
    `https://api.notion.com/v1/data_sources/${encodeURIComponent(id)}`,
    NOTION_API_VERSION,
  );

  if (direct.response.ok) {
    return {
      ok: true,
      target: { ...target, notionTargetId: id },
      url: direct.data.url,
    };
  }

  const database = await retrieveNotionObject(
    token,
    `https://api.notion.com/v1/databases/${encodeURIComponent(id)}`,
    NOTION_API_VERSION,
  );

  if (!database.response.ok) {
    return {
      ok: false,
      error: database.data.message || direct.data.message || `Notion target check failed: ${database.response.status}`,
    };
  }

  const dataSourceId = database.data.data_sources?.[0]?.id;
  if (!dataSourceId) {
    return {
      ok: false,
      error: "Notion database does not expose a data source. Please paste a Data Source link or create a normal Notion table database.",
    };
  }

  return {
    ok: true,
    target: {
      ...target,
      notionTargetId: dataSourceId,
    },
    url: database.data.url,
  };
}

async function retrieveNotionObject(
  token: string,
  url: string,
  apiVersion: string,
): Promise<{ response: Response; data: NotionPageResponse }> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": apiVersion,
    },
  });

  const data = (await response.json().catch(() => ({}))) as NotionPageResponse;
  return { response, data };
}

function chunkBlocks(blocks: NotionBlock[]): NotionBlock[][] {
  const chunks: NotionBlock[][] = [];
  for (let index = 0; index < blocks.length; index += MAX_CHILDREN_PER_REQUEST) {
    chunks.push(blocks.slice(index, index + MAX_CHILDREN_PER_REQUEST));
  }

  return chunks;
}

async function appendBlocks(
  token: string,
  blockId: string,
  children: NotionBlock[],
  apiVersion: string,
): Promise<SaveResult> {
  if (!children.length) {
    return { ok: true };
  }

  const response = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": apiVersion,
    },
    body: JSON.stringify({ children }),
  });

  const data = (await response.json().catch(() => ({}))) as NotionPageResponse;

  if (!response.ok) {
    return {
      ok: false,
      error: data.message || `Notion 内容追加失败：${response.status}`,
    };
  }

  return { ok: true };
}

function getApiVersion(target: NotionSaveTarget): string {
  return target.notionTargetType === "database" ? LEGACY_DATABASE_API_VERSION : NOTION_API_VERSION;
}

function getRetrieveUrl(target: NotionSaveTarget): string {
  const id = encodeURIComponent(normalizeNotionId(target.notionTargetId));

  if (target.notionTargetType === "page") {
    return `https://api.notion.com/v1/pages/${id}`;
  }

  if (target.notionTargetType === "database") {
    return `https://api.notion.com/v1/databases/${id}`;
  }

  return `https://api.notion.com/v1/data_sources/${id}`;
}
