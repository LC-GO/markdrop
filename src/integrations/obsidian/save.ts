import { isObsidianTarget } from "../../utils/types";
import { CODE_LANGUAGE_LABEL_PATTERN_SOURCE, inferCodeLanguage, normalizeCodeLanguage } from "../../utils/codeLanguage";
import type {
  MarkdropSettings,
  ObsidianSaveTarget,
  ObsidianSettings,
  SaveRequest,
  SaveResult,
  SaveTarget,
} from "../../utils/types";

const DEFAULT_FILE_TEMPLATE = "{title}";
const MAX_FILENAME_LENGTH = 120;
const DEFAULT_HTTPS_URL = "https://127.0.0.1:27124";
const DEFAULT_HTTP_URL = "http://127.0.0.1:27123";

interface ObsidianApiError {
  message?: string;
  error?: string;
}

export async function saveMarkdownToObsidian(
  settings: MarkdropSettings,
  request: SaveRequest,
): Promise<SaveResult> {
  const target = settings.targets.find(
    (item): item is ObsidianSaveTarget => item.id === request.targetId && isObsidianTarget(item),
  );

  if (!target) {
    return { ok: false, error: "Obsidian target not found." };
  }

  const validationError = validateObsidianSettings(settings.obsidian, target);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    const filePath = await buildAvailableFilePath(settings.obsidian, target, request.title);
    await obsidianFetch(settings.obsidian, `/vault/${encodeVaultPath(filePath)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
      },
      body: buildMarkdownFile(request),
    });

    return {
      ok: true,
      url: buildObsidianOpenUrl(settings.obsidian, filePath),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Obsidian save failed.",
    };
  }
}

export async function testObsidianTarget(obsidian: ObsidianSettings, target: SaveTarget): Promise<SaveResult> {
  if (!isObsidianTarget(target)) {
    return { ok: false, error: "This is not an Obsidian target." };
  }

  const validationError = validateObsidianSettings(obsidian, target);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    await obsidianFetch(obsidian, "/", { method: "GET" });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Obsidian target test failed.",
    };
  }
}

async function buildAvailableFilePath(
  obsidian: ObsidianSettings,
  target: ObsidianSaveTarget,
  title: string,
): Promise<string> {
  const folderPath = normalizeVaultFolderPath(target.obsidianFolderPath);
  const baseName = renderFileNameTemplate(target.obsidianFileNameTemplate || DEFAULT_FILE_TEMPLATE, title);
  const firstCandidate = joinVaultPath(folderPath, `${baseName}.md`);

  if (!(await fileExists(obsidian, firstCandidate))) {
    return firstCandidate;
  }

  const timestamp = formatFileTimestamp(new Date());
  const stampedCandidate = joinVaultPath(folderPath, `${baseName}-${timestamp}.md`);
  if (!(await fileExists(obsidian, stampedCandidate))) {
    return stampedCandidate;
  }

  return joinVaultPath(folderPath, `${baseName}-${timestamp}-${crypto.randomUUID().slice(0, 8)}.md`);
}

async function fileExists(obsidian: ObsidianSettings, filePath: string): Promise<boolean> {
  try {
    await obsidianFetch(obsidian, `/vault/${encodeVaultPath(filePath)}`, { method: "GET" });
    return true;
  } catch (error) {
    if (error instanceof Error && /404|not found/i.test(error.message)) {
      return false;
    }

    throw error;
  }
}

function buildMarkdownFile(request: SaveRequest): string {
  const markdown = normalizeObsidianMarkdown(request.markdown);
  if (!request.includeSourceUrl || !request.sourceUrl) {
    return `${markdown}\n`;
  }

  return [
    "---",
    `source: ${quoteYamlString(request.sourceUrl)}`,
    `saved_at: ${quoteYamlString(new Date().toISOString())}`,
    "---",
    "",
    markdown,
    "",
  ].join("\n");
}

async function obsidianFetch(
  obsidian: ObsidianSettings,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const apiUrls = obsidianApiUrlCandidates(obsidian.apiUrl);
  const errors: string[] = [];

  for (const apiUrl of apiUrls) {
    const url = buildObsidianUrl(apiUrl, path);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${obsidian.apiKey}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      errors.push(`${apiUrl}: ${error instanceof Error ? error.message : "Failed to fetch"}`);
      continue;
    }

    if (!response.ok) {
      const data = (await response.json().catch(() => undefined)) as ObsidianApiError | undefined;
      const text = data?.message || data?.error || (await response.text().catch(() => ""));
      throw new Error(text || `Obsidian API failed (HTTP ${response.status}).`);
    }

    return response;
  }

  throw new Error(
    [
      "Cannot reach Obsidian Local REST API.",
      "If https://127.0.0.1:27124 opens in the browser but Markdrop still fails, Edge is likely blocking the extension fetch because of the self-signed HTTPS certificate.",
      "Enable the plugin's non-encrypted HTTP server and set Markdrop's API URL to http://127.0.0.1:27123.",
      errors.join(" | "),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function validateObsidianSettings(obsidian: ObsidianSettings, target: ObsidianSaveTarget): string {
  if (!obsidian.apiUrl.trim()) {
    return "Fill in the Obsidian Local REST API URL first.";
  }

  if (!obsidian.apiKey.trim()) {
    return "Fill in the Obsidian Local REST API key first.";
  }

  if (!target.name.trim()) {
    return "Fill in the Obsidian target name first.";
  }

  if (!target.obsidianFolderPath.trim()) {
    return "Fill in the Obsidian vault folder path first. Use / or . for the vault root.";
  }

  return "";
}

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/\/+$/g, "");
}

function obsidianApiUrlCandidates(apiUrl: string): string[] {
  const normalized = normalizeApiUrl(apiUrl);
  const candidates = [normalized];

  if (normalized === DEFAULT_HTTPS_URL) {
    candidates.push(DEFAULT_HTTP_URL);
  } else if (normalized === "https://localhost:27124") {
    candidates.push("http://localhost:27123");
  }

  return [...new Set(candidates)];
}

function buildObsidianUrl(apiUrl: string, path: string): string {
  return `${apiUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function normalizeVaultFolderPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized === "." ? "" : normalized;
}

function joinVaultPath(folderPath: string, fileName: string): string {
  const folder = normalizeVaultFolderPath(folderPath);
  return folder ? `${folder}/${fileName}` : fileName;
}

function encodeVaultPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function renderFileNameTemplate(template: string, title: string): string {
  const now = new Date();
  const rendered = (template.trim() || DEFAULT_FILE_TEMPLATE)
    .replaceAll("{title}", title.trim() || "Untitled")
    .replaceAll("{date}", now.toISOString().slice(0, 10))
    .replaceAll("{time}", now.toTimeString().slice(0, 5).replace(":", "-"));

  return sanitizeFileName(rendered);
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();

  return sanitized || "Untitled";
}

function formatFileTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
}

function quoteYamlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function buildObsidianOpenUrl(obsidian: ObsidianSettings, filePath: string): string | undefined {
  const vaultName = obsidian.vaultName?.trim();
  if (!vaultName) {
    return undefined;
  }

  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
}

function normalizeObsidianMarkdown(markdown: string): string {
  const normalizedLineEndings = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normalizedFences = normalizeCodeFenceBoundaries(normalizedLineEndings);
  const normalizedLanguages = normalizeCodeFenceLanguageLabels(normalizedFences);

  return normalizeTaskListMarkers(normalizeCodeFenceBoundaries(normalizedLanguages))
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function normalizeCodeFenceBoundaries(markdown: string): string {
  let inFence = false;
  const lines = markdown.split("\n").map((line) => {
    const fence = parseCodeFenceLine(line);
    if (!fence) {
      return line;
    }

    const { indent, language } = fence;
    if (inFence) {
      inFence = false;
      return `${indent}\`\`\``;
    }

    inFence = true;
    const normalizedLanguage = normalizeCodeLanguage(language) || language.trim().toLowerCase();
    return `${indent}\`\`\`${normalizedLanguage}`;
  });

  if (inFence) {
    lines.push("```");
  }

  return lines.join("\n");
}

function parseCodeFenceLine(line: string): { indent: string; language: string } | undefined {
  const match = line.match(/^(\s*)(?:```|\\`\\`\\`)([a-z0-9+#.-]*)[ \t]*$/i);
  if (!match) {
    return undefined;
  }

  return {
    indent: match[1],
    language: match[2] ?? "",
  };
}

function normalizeTaskListMarkers(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }

      if (inFence) {
        return line;
      }

      return line.replace(
        /^(\s*)[-*+]\s+\\?\[([ xX])\\?\]\s+(.+)$/,
        (_match, indent: string, checked: string, text: string) => `${indent}- [${checked.toLowerCase()}] ${text}`,
      );
    })
    .join("\n");
}

function normalizeCodeFenceLanguageLabels(markdown: string): string {
  let normalized = markdown;

  normalized = normalized.replace(
    new RegExp(`(^|\\n)(${CODE_LANGUAGE_LABEL_PATTERN_SOURCE})\\s*\\n\\s*\\n((?: {4}|\\t)\`\`\`[\\s\\S]*?\\n(?: {4}|\\t)\`\`\`)`, "gi"),
    (_match, prefix: string, label: string, indentedFence: string) => {
      const language = normalizeCodeLanguage(label);
      if (!language) {
        return _match;
      }

      const unindentedFence = indentedFence
        .split("\n")
        .map((line) => line.replace(/^(?: {4}|\t)/, ""))
        .join("\n");
      const code = unindentedFence.replace(/^```[a-z0-9+#.-]*\s*\n/i, "").replace(/\n```$/i, "");
      return `${prefix}\`\`\`${language}\n${code.trimEnd()}\n\`\`\``;
    },
  );

  normalized = normalized.replace(
    new RegExp(`(^|\\n)(${CODE_LANGUAGE_LABEL_PATTERN_SOURCE})\\s*\\n\\s*\\n\`\`\`([a-z0-9+#.-]*)\\s*\\n`, "gi"),
    (match, prefix: string, label: string, fencedLanguage: string) => {
      const language = normalizeCodeLanguage(fencedLanguage || label);
      return language ? `${prefix}\`\`\`${language}\n` : match;
    },
  );

  return normalized.replace(/(^|\n)```[ \t]*\n([\s\S]*?)\n```/g, (match, prefix: string, code: string) => {
    const language = inferCodeLanguage(code);
    return language ? `${prefix}\`\`\`${language}\n${code}\n\`\`\`` : match;
  });
}
