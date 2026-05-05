import {
  isMarkdropFeishuConvertedMarkdownBlock,
  type FeishuBlock,
  type MarkdropFeishuConvertedMarkdownBlock,
} from "./markdown";
import type {
  FeishuApiResponse,
  FeishuDocumentCreateData,
  FeishuDocumentInfo,
  FeishuWikiNode,
  FeishuWikiNodeData,
} from "./types";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

export async function createFeishuDocument(
  tenantAccessToken: string,
  input: { title: string; folderToken?: string },
): Promise<FeishuDocumentInfo> {
  const response = await feishuFetch<FeishuDocumentCreateData>(tenantAccessToken, "/docx/v1/documents", {
    method: "POST",
    body: JSON.stringify({
      title: input.title.slice(0, 255) || "Untitled",
      folder_token: input.folderToken || undefined,
    }),
  });

  const document = response.data?.document;
  if (!document?.document_id) {
    throw new Error("Feishu document was created without a document_id.");
  }

  return document;
}

export async function appendPlainTextToFeishuDocument(
  tenantAccessToken: string,
  documentId: string,
  text: string,
): Promise<void> {
  await appendBlocksToFeishuDocument(
    tenantAccessToken,
    documentId,
    splitEvery(text || " ", 1800).map((content) => ({
      block_type: 2,
      text: {
        elements: [
          {
            text_run: {
              content,
            },
          },
        ],
      },
    })),
  );
}

export async function appendBlocksToFeishuDocument(
  tenantAccessToken: string,
  documentId: string,
  blocks: FeishuBlock[],
): Promise<void> {
  const children = blocks.length ? blocks : [emptyTextBlock()];
  let buffer: FeishuBlock[] = [];

  const flushBuffer = async () => {
    if (!buffer.length) {
      return;
    }

    await appendPlainBlocksToParent(tenantAccessToken, documentId, documentId, buffer);
    buffer = [];
  };

  for (const block of children) {
    if (isMarkdropFeishuConvertedMarkdownBlock(block)) {
      await flushBuffer();
      await appendConvertedMarkdownToDocument(tenantAccessToken, documentId, block);
      continue;
    }

    buffer.push(block);
    if (buffer.length >= 50) {
      await flushBuffer();
    }
  }

  await flushBuffer();
}

export async function getFeishuWikiNode(
  tenantAccessToken: string,
  token: string,
): Promise<FeishuWikiNode> {
  const response = await feishuFetch<FeishuWikiNodeData>(
    tenantAccessToken,
    `/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`,
    { method: "GET" },
  );

  const node = response.data?.node;
  if (!node?.node_token && !node?.obj_token) {
    throw new Error("Feishu Wiki node was not found.");
  }

  return node;
}

export async function createFeishuWikiDocument(
  tenantAccessToken: string,
  input: { title: string; spaceId: string; parentNodeToken: string },
): Promise<FeishuWikiNode> {
  const response = await feishuFetch<FeishuWikiNodeData>(
    tenantAccessToken,
    `/wiki/v2/spaces/${encodeURIComponent(input.spaceId)}/nodes`,
    {
      method: "POST",
      body: JSON.stringify({
        obj_type: "docx",
        node_type: "origin",
        parent_node_token: input.parentNodeToken,
        title: input.title.slice(0, 255) || "Untitled",
      }),
    },
  );

  const node = response.data?.node;
  if (!node?.obj_token) {
    throw new Error("Feishu Wiki node was created without an obj_token.");
  }

  return node;
}

async function feishuFetch<T>(
  tenantAccessToken: string,
  path: string,
  init: RequestInit,
): Promise<FeishuApiResponse<T>> {
  const response = await fetch(`${FEISHU_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tenantAccessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });

  const data = (await response.json().catch(() => ({}))) as FeishuApiResponse<T>;
  if (!response.ok || data.code !== 0) {
    const code = typeof data.code === "number" ? `code ${data.code}` : `HTTP ${response.status}`;
    const msg = data.msg || "Feishu API failed";
    throw new Error(`${msg} (${code}, ${path})`);
  }

  return data;
}

interface FeishuBlockCreateData {
  children?: Array<FeishuBlock & { block_id?: string; table?: { cells?: string[] } }>;
}

type CreatedFeishuBlock = FeishuBlock & { block_id?: string; table?: { cells?: string[] } };

interface FeishuBlockConvertData {
  blocks?: Array<FeishuBlock & { block_id?: string; children?: string[] }>;
  first_level_block_ids?: string[];
}

async function appendPlainBlocksToParent(
  tenantAccessToken: string,
  documentId: string,
  parentBlockId: string,
  blocks: FeishuBlock[],
): Promise<CreatedFeishuBlock[]> {
  const created: CreatedFeishuBlock[] = [];

  for (const chunk of chunkArray(blocks, 50)) {
    const response = await feishuFetch<FeishuBlockCreateData>(
      tenantAccessToken,
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children?document_revision_id=-1`,
      {
        method: "POST",
        body: JSON.stringify({
          index: -1,
          children: chunk,
        }),
      },
    );

    created.push(...(response.data?.children ?? []));
  }

  return created;
}

async function appendConvertedMarkdownToDocument(
  tenantAccessToken: string,
  documentId: string,
  block: MarkdropFeishuConvertedMarkdownBlock,
): Promise<void> {
  const converted = await convertMarkdownToFeishuBlocks(tenantAccessToken, documentId, block.__markdropConvertMarkdown);
  if (!converted.first_level_block_ids?.length || !converted.blocks?.length) {
    throw new Error("Feishu Markdown conversion returned no table blocks.");
  }

  await appendDescendantBlocksToParent(
    tenantAccessToken,
    documentId,
    documentId,
    converted.first_level_block_ids,
    converted.blocks,
  );
}

async function convertMarkdownToFeishuBlocks(
  tenantAccessToken: string,
  documentId: string,
  markdown: string,
): Promise<FeishuBlockConvertData> {
  const response = await feishuFetch<FeishuBlockConvertData>(
    tenantAccessToken,
    "/docx/v1/documents/blocks/convert",
    {
      method: "POST",
      body: JSON.stringify({
        content_type: "markdown",
        content: markdown,
      }),
    },
  );

  return response.data ?? {};
}

async function appendDescendantBlocksToParent(
  tenantAccessToken: string,
  documentId: string,
  parentBlockId: string,
  childrenId: string[],
  descendants: FeishuBlock[],
): Promise<void> {
  await feishuFetch(
    tenantAccessToken,
    `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/descendant?document_revision_id=-1`,
    {
      method: "POST",
      body: JSON.stringify({
        index: -1,
        children_id: childrenId,
        descendants: sanitizeConvertedDescendants(descendants),
      }),
    },
  );
}

function sanitizeConvertedDescendants(blocks: FeishuBlock[]): FeishuBlock[] {
  return blocks.map((block) => {
    const { parent_id: _parentId, revision_id: _revisionId, ...rest } = block as Record<string, unknown>;
    return removeUnsupportedConvertedFields(rest);
  });
}

function removeUnsupportedConvertedFields(value: Record<string, unknown>): FeishuBlock {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "merge_info")
      .map(([key, item]) => [key, normalizeConvertedField(item)]),
  );
}

function normalizeConvertedField(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (isRecord(item) ? removeUnsupportedConvertedFields(item) : item));
  }

  if (isRecord(value)) {
    return removeUnsupportedConvertedFields(value);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emptyTextBlock(): FeishuBlock {
  return {
    block_type: 2,
    text: {
      elements: [
        {
          text_run: {
            content: " ",
          },
        },
      ],
    },
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function splitEvery(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.length ? chunks : [" "];
}
