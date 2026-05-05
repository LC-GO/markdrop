import { saveSettings } from "../../utils/storage";
import { isFeishuTarget } from "../../utils/types";
import type { FeishuSaveTarget, MarkdropSettings, SaveRequest, SaveResult, SaveTarget } from "../../utils/types";
import {
  appendBlocksToFeishuDocument,
  createFeishuDocument,
  createFeishuWikiDocument,
  getFeishuWikiNode,
} from "./api";
import { getFeishuUserAccessToken } from "./auth";
import { parseFeishuTargetInput } from "./links";
import { markdownToFeishuBlocks, sourceUrlFeishuBlock } from "./markdown";

export interface FeishuTargetTestResult extends SaveResult {
  feishu?: MarkdropSettings["feishu"];
}

export async function saveMarkdownToFeishu(
  settings: MarkdropSettings,
  request: SaveRequest,
): Promise<SaveResult> {
  const target = settings.targets.find((item): item is FeishuSaveTarget => item.id === request.targetId && isFeishuTarget(item));

  if (!target) {
    return { ok: false, error: "Feishu target not found." };
  }

  if (!settings.feishu.appId || !settings.feishu.appSecret) {
    return { ok: false, error: "Fill in Feishu App ID and App Secret first." };
  }

  try {
    const auth = await getFeishuUserAccessToken(settings.feishu);
    if (auth.feishu !== settings.feishu) {
      settings.feishu = auth.feishu;
      await saveSettings(settings);
    }

    return target.feishuTargetType === "wiki"
      ? await saveToFeishuWiki(auth.accessToken, target, request)
      : await saveToFeishuFolder(auth.accessToken, target, request);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Feishu save failed.",
    };
  }
}

export async function testFeishuTarget(
  feishu: MarkdropSettings["feishu"],
  target: SaveTarget,
): Promise<FeishuTargetTestResult> {
  if (!isFeishuTarget(target)) {
    return { ok: false, error: "This is not a Feishu target." };
  }

  if (!target.feishuTargetToken) {
    return { ok: false, error: "Fill in the Feishu target token first." };
  }

  try {
    const auth = await getFeishuUserAccessToken(feishu);
    const parsedTarget = parseFeishuTargetInput(target.feishuTargetType, target.feishuTargetToken, target.feishuSpaceId);
    if (target.feishuTargetType === "wiki") {
      await resolveWikiParent(auth.accessToken, {
        ...target,
        feishuTargetToken: parsedTarget.token,
        feishuSpaceId: parsedTarget.spaceId ?? target.feishuSpaceId,
      });
    }
    return { ok: true, feishu: auth.feishu };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Feishu target test failed.",
    };
  }
}

async function saveToFeishuFolder(
  tenantAccessToken: string,
  target: FeishuSaveTarget,
  request: SaveRequest,
): Promise<SaveResult> {
  const parsed = parseFeishuTargetInput("folder", target.feishuTargetToken);
  const document = await createFeishuDocument(tenantAccessToken, {
    title: request.title,
    folderToken: parsed.token,
  });

  await appendBlocksToFeishuDocument(tenantAccessToken, document.document_id ?? "", buildFeishuBlocks(request));
  return { ok: true, url: document.url };
}

async function saveToFeishuWiki(
  tenantAccessToken: string,
  target: FeishuSaveTarget,
  request: SaveRequest,
): Promise<SaveResult> {
  const parent = await resolveWikiParent(tenantAccessToken, target);
  const node = await createFeishuWikiDocument(tenantAccessToken, {
    title: request.title,
    spaceId: parent.spaceId,
    parentNodeToken: parent.parentNodeToken,
  });

  await appendBlocksToFeishuDocument(tenantAccessToken, node.obj_token ?? "", buildFeishuBlocks(request));
  return { ok: true, url: node.url };
}

async function resolveWikiParent(
  tenantAccessToken: string,
  target: FeishuSaveTarget,
): Promise<{ spaceId: string; parentNodeToken: string }> {
  const parsed = parseFeishuTargetInput("wiki", target.feishuTargetToken, target.feishuSpaceId);
  if (!parsed.token) {
    throw new Error("Fill in the Feishu Wiki node link or token first.");
  }

  if (parsed.spaceId) {
    return {
      spaceId: parsed.spaceId,
      parentNodeToken: parsed.token,
    };
  }

  const node = await getFeishuWikiNode(tenantAccessToken, parsed.token);
  const spaceId = node.space_id;
  const parentNodeToken = node.node_token ?? parsed.token;
  if (!spaceId || !parentNodeToken) {
    throw new Error("Could not resolve Feishu Wiki space ID from this link. Paste the Wiki Space ID manually.");
  }

  return { spaceId, parentNodeToken };
}

function buildFeishuBlocks(request: SaveRequest): Array<Record<string, unknown>> {
  const blocks = [];
  if (request.includeSourceUrl && request.sourceUrl) {
    blocks.push(sourceUrlFeishuBlock(request.sourceUrl));
  }

  blocks.push(...markdownToFeishuBlocks(request.markdown));
  return blocks;
}
