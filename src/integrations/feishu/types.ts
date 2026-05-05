import type { FeishuSettings } from "../../utils/types";

export interface FeishuApiResponse<T = unknown> {
  code: number;
  msg?: string;
  data?: T;
  tenant_access_token?: string;
  expire?: number;
}

export interface FeishuDocumentInfo {
  document_id?: string;
  revision_id?: number;
  title?: string;
  url?: string;
}

export interface FeishuDocumentCreateData {
  document?: FeishuDocumentInfo;
}

export interface FeishuWikiNode {
  space_id?: string;
  node_token?: string;
  obj_token?: string;
  obj_type?: string;
  node_type?: string;
  title?: string;
  url?: string;
}

export interface FeishuWikiNodeData {
  node?: FeishuWikiNode;
}

export interface FeishuAuthInput extends FeishuSettings {}
