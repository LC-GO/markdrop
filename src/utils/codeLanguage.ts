const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  "c++": "cpp",
  csharp: "csharp",
  cs: "csharp",
  golang: "go",
  js: "javascript",
  jsx: "jsx",
  md: "markdown",
  plaintext: "text",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  shell: "bash",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  yml: "yaml",
};

const KNOWN_CODE_LANGUAGES = new Set([
  "bash",
  "c",
  "clojure",
  "cpp",
  "csharp",
  "css",
  "dart",
  "diff",
  "dockerfile",
  "go",
  "graphql",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "lua",
  "markdown",
  "matlab",
  "mermaid",
  "php",
  "powershell",
  "python",
  "r",
  "ruby",
  "rust",
  "scala",
  "sql",
  "swift",
  "text",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
]);

export const CODE_LANGUAGE_LABEL_PATTERN_SOURCE = Array.from(
  new Set([...KNOWN_CODE_LANGUAGES, ...Object.keys(CODE_LANGUAGE_ALIASES)]),
)
  .sort((left, right) => right.length - left.length)
  .map((language) => language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

export function normalizeCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  const aliased = CODE_LANGUAGE_ALIASES[normalized] ?? normalized;
  return KNOWN_CODE_LANGUAGES.has(aliased) ? aliased : "";
}

export function normalizeCodeLanguageLabel(label: string): string {
  const cleaned = label.trim().replace(/^`+|`+$/g, "").replace(/:$/, "");
  if (!/^[a-z0-9+#.-]{1,30}$/i.test(cleaned)) {
    return "";
  }

  return normalizeCodeLanguage(cleaned);
}

export function inferCodeLanguage(code: string): string {
  const normalized = code.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const text = cleanCodeBlockText(normalized);
  if (looksLikeJson(text)) {
    return "json";
  }

  if (/^\s*<(!doctype\s+html|html|[a-z][\w:-]*(?:\s|>|\/>))/im.test(text)) {
    return /<\/html>|<!doctype\s+html/i.test(text) ? "html" : "xml";
  }

  if (
    /^\s*(select|insert|update|delete|create|alter|drop|with)\b/im.test(text) ||
    /\b(from|where|join|group\s+by|order\s+by|limit)\b/i.test(text)
  ) {
    return "sql";
  }

  if (
    /^\s*(from\s+[\w.]+\s+import|import\s+[\w.,\s]+(?:\s+as\s+\w+)?|def\s+\w+\s*\(|class\s+\w+(?:\([^)]*\))?:|if\s+__name__\s*==|print\s*\()/m.test(
      text,
    ) ||
    /\b(np|pd|plt|sns)\.[A-Za-z_]\w*\s*\(/.test(text) ||
    /^\s*(for|while|if|elif|else|try|except|with)\b.*:\s*$/m
  ) {
    return "python";
  }

  if (
    /^\s*(interface|type)\s+\w+\s*[={]/m.test(text) ||
    /^\s*(import|export)\s+.+\s+from\s+["'][^"']+["'];?\s*$/m ||
    /\b(?:const|let|var)\s+\w+\s*:\s*[\w<>{}[\]|]+/.test(text)
  ) {
    return "typescript";
  }

  if (
    /^\s*(const|let|var)\s+\w+\s*=|^\s*function\s+\w+\s*\(|^\s*class\s+\w+|console\.(log|error|warn)\s*\(|=>/m.test(
      text,
    )
  ) {
    return "javascript";
  }

  if (/^\s*(public\s+)?(class|interface|enum)\s+\w+|System\.out\.println\s*\(|public\s+static\s+void\s+main\s*\(/m.test(text)) {
    return "java";
  }

  if (/^\s*#include\s+<|std::|int\s+main\s*\(/m.test(text)) {
    return "cpp";
  }

  if (/^\s*(package\s+main|func\s+\w+\s*\(|import\s+\()/m.test(text)) {
    return "go";
  }

  if (/^\s*(use\s+[\w:]+;|fn\s+\w+\s*\(|let\s+mut\s+|impl\s+\w+)/m.test(text)) {
    return "rust";
  }

  if (/^\s*(body|html|[.#]?[a-z][\w-]*)\s*\{[\s\S]*\b[a-z-]+\s*:\s*[^;]+;/im.test(text)) {
    return "css";
  }

  if (/^\s*(#!\/.*(?:bash|sh)|sudo\s+|npm\s+|pnpm\s+|yarn\s+|pip\s+|python\s+|git\s+|docker\s+|kubectl\s+|cd\s+|ls\b)/m.test(text)) {
    return "bash";
  }

  if (/^\s*(FROM|RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|EXPOSE)\b/m.test(text)) {
    return "dockerfile";
  }

  if (/^\s*(---|\w+:\s+.+)$/m.test(text) && /\n\s+\w+:\s+/.test(text)) {
    return "yaml";
  }

  return "";
}

export function cleanCodeBlockText(code: string): string {
  const lines = code.split("\n");
  if (!looksLikeLineNumberedCode(lines)) {
    return code;
  }

  return lines
    .map((line) => {
      if (/^\s*\d{1,5}\s*$/.test(line)) {
        return null;
      }

      return line.replace(/^\s*\d{1,5}(?:\s+|(?=[A-Za-z_#"'`<{.[/-]))/, "");
    })
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

function looksLikeLineNumberedCode(lines: string[]): boolean {
  const nonBlank = lines.filter((line) => line.trim());
  if (nonBlank.length < 3) {
    return false;
  }

  let numbered = 0;
  let expected = 1;

  for (const line of nonBlank) {
    const match = line.match(/^\s*(\d{1,5})(?:\s+|(?=[A-Za-z_#"'`<{.[/-])|$)/);
    if (!match) {
      continue;
    }

    const value = Number(match[1]);
    if (value === expected || value === numbered + 1) {
      numbered += 1;
      expected = value + 1;
    }
  }

  return numbered >= Math.min(5, nonBlank.length) || numbered / nonBlank.length >= 0.45;
}

function looksLikeJson(code: string): boolean {
  if (!/^\s*[\[{]/.test(code)) {
    return false;
  }

  try {
    JSON.parse(code);
    return true;
  } catch {
    return false;
  }
}
