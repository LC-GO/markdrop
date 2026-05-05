export type FeishuBlock = Record<string, unknown>;

export interface MarkdropFeishuConvertedMarkdownBlock extends FeishuBlock {
  __markdropConvertMarkdown: string;
}

interface TextRunStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  inline_code?: boolean;
  link?: { url: string };
}

const HEADING_BLOCK_TYPES = [3, 4, 5, 6, 7, 8];

export function markdownToFeishuBlocks(markdown: string): FeishuBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: FeishuBlock[] = [];
  const paragraphLines: string[] = [];
  let pendingCodeLanguage = "";

  const flushParagraph = () => {
    const text = paragraphLines.join("\n").trim();
    paragraphLines.length = 0;
    if (text) {
      blocks.push(textBlock(2, text));
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isBlank(line)) {
      flushParagraph();
      continue;
    }

    const singleLineEquation = line.match(/^\s*\$\$\s*(.+?)\s*\$\$\s*$/);
    if (singleLineEquation) {
      flushParagraph();
      blocks.push(equationBlock(singleLineEquation[1]));
      continue;
    }

    if (/^\s*\$\$\s*$/.test(line)) {
      flushParagraph();
      const equationLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*\$\$\s*$/.test(lines[index])) {
        equationLines.push(lines[index]);
        index += 1;
      }
      blocks.push(equationBlock(equationLines.join("\n")));
      continue;
    }

    const languageLabel = getStandaloneCodeLanguageLabel(lines, index);
    if (languageLabel) {
      pendingCodeLanguage = languageLabel;
      continue;
    }

    const fence = line.match(/^```([a-z0-9+#.-]*)\s*$/i);
    if (fence) {
      flushParagraph();
      const codeLines: string[] = [];
      const language = fence[1] || pendingCodeLanguage;
      pendingCodeLanguage = "";
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push(codeBlock(cleanCodeBlockText(codeLines.join("\n")), language));
      continue;
    }

    pendingCodeLanguage = "";

    if (isDivider(line)) {
      flushParagraph();
      blocks.push({ block_type: 22, divider: {} });
      continue;
    }

    if (isTableStart(lines, index)) {
      flushParagraph();
      const table = parseTable(lines, index);
      blocks.push(tableBlock(table.rows));
      index = table.nextIndex - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push(textBlock(HEADING_BLOCK_TYPES[heading[1].length - 1] ?? 8, heading[2]));
      continue;
    }

    const quote = parseQuoteGroup(lines, index);
    if (quote) {
      flushParagraph();
      blocks.push(textBlock(15, quote.text));
      index = quote.nextIndex - 1;
      continue;
    }

    const list = parseListGroup(lines, index);
    if (list) {
      flushParagraph();
      blocks.push(convertedMarkdownBlock(list.markdown));
      index = list.nextIndex - 1;
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks.length ? blocks : [textBlock(2, " ")];
}

export function sourceUrlFeishuBlock(sourceUrl: string): FeishuBlock {
  return textBlock(2, `Source: ${sourceUrl}`);
}

export function feishuCellTextBlock(text: string): FeishuBlock {
  return textBlock(2, text || " ");
}

export function isMarkdropFeishuConvertedMarkdownBlock(block: FeishuBlock): block is MarkdropFeishuConvertedMarkdownBlock {
  return typeof (block as { __markdropConvertMarkdown?: unknown }).__markdropConvertMarkdown === "string";
}

function textBlock(blockType: number, text: string): FeishuBlock {
  const key = blockContentKey(blockType);
  return {
    block_type: blockType,
    [key]: {
      elements: parseTextElements(text),
      style: {},
    },
  };
}

function codeBlock(text: string, language: string): FeishuBlock {
  return {
    block_type: 14,
    code: {
      elements: codeTextElements(text || " "),
      style: {
        language: codeLanguageId(language),
      },
    },
  };
}

function cleanCodeBlockText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (!looksLikeLineNumberedCode(lines)) {
    return text;
  }

  return lines.map((line) => line.replace(/^\s*\d+(?:\s+|(?=[A-Za-z_#"'`]))/, "")).join("\n");
}

function looksLikeLineNumberedCode(lines: string[]): boolean {
  const nonBlank = lines.filter((line) => line.trim());
  if (nonBlank.length < 3) {
    return false;
  }

  let numbered = 0;
  let expected = 1;
  for (const line of nonBlank) {
    const match = line.match(/^\s*(\d+)(?:\s+|(?=[A-Za-z_#"'`])|$)/);
    if (!match) {
      continue;
    }

    const value = Number(match[1]);
    if (value === expected || value === numbered + 1) {
      numbered += 1;
      expected = value + 1;
    }
  }

  return numbered >= Math.min(5, nonBlank.length) || numbered / nonBlank.length >= 0.6;
}

function blockContentKey(blockType: number): string {
  if (blockType === 2) {
    return "text";
  }

  if (blockType >= 3 && blockType <= 11) {
    return `heading${blockType - 2}`;
  }

  if (blockType === 15) {
    return "quote";
  }

  return "text";
}

function codeLanguageId(language: string): number {
  const normalized = language.trim().toLowerCase();
  return CODE_LANGUAGE_IDS[normalized] ?? 1;
}

const CODE_LANGUAGE_IDS: Record<string, number> = {
  plaintext: 1,
  text: 1,
  txt: 1,
  abap: 2,
  ada: 3,
  apache: 4,
  apex: 5,
  asm: 6,
  assembly: 6,
  bash: 7,
  sh: 60,
  shell: 60,
  zsh: 60,
  csharp: 8,
  cs: 8,
  "c#": 8,
  cpp: 9,
  "c++": 9,
  c: 10,
  cobol: 11,
  css: 12,
  coffeescript: 13,
  coffee: 13,
  d: 14,
  dart: 15,
  delphi: 16,
  django: 17,
  dockerfile: 18,
  docker: 18,
  erlang: 19,
  fortran: 20,
  foxpro: 21,
  go: 22,
  golang: 22,
  groovy: 23,
  html: 24,
  htm: 24,
  htmlbars: 25,
  http: 26,
  haskell: 27,
  hs: 27,
  json: 28,
  java: 29,
  javascript: 30,
  js: 30,
  jsx: 30,
  julia: 31,
  kotlin: 32,
  kt: 32,
  latex: 33,
  tex: 33,
  lisp: 34,
  logo: 35,
  lua: 36,
  matlab: 37,
  makefile: 38,
  make: 38,
  markdown: 39,
  md: 39,
  nginx: 40,
  objectivec: 41,
  "objective-c": 41,
  objc: 41,
  openedgeabl: 42,
  php: 43,
  perl: 44,
  pl: 44,
  postscript: 45,
  power: 46,
  powershell: 46,
  ps1: 46,
  prolog: 47,
  protobuf: 48,
  proto: 48,
  python: 49,
  py: 49,
  r: 50,
  rpg: 51,
  ruby: 52,
  rb: 52,
  rust: 53,
  rs: 53,
  sas: 54,
  scss: 55,
  sql: 56,
  scala: 57,
  scheme: 58,
  scratch: 59,
  swift: 61,
  thrift: 62,
  typescript: 63,
  ts: 63,
  tsx: 63,
  vbscript: 64,
  vb: 64,
  visual: 65,
  xml: 66,
  yaml: 67,
  yml: 67,
  cmake: 68,
  diff: 69,
  patch: 69,
  gherkin: 70,
  cucumber: 70,
  graphql: 71,
  gql: 71,
  glsl: 72,
  properties: 73,
  solidity: 74,
  sol: 74,
  toml: 75,
};

function equationBlock(expression: string): FeishuBlock {
  return {
    block_type: 2,
    text: {
      elements: [equationElement(expression)],
      style: {
        align: 2,
      },
    },
  };
}

function tableBlock(rows: string[][]): MarkdropFeishuConvertedMarkdownBlock {
  const columnSize = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [...row, ...Array<string>(columnSize - row.length).fill("")]);
  const rendered = normalizedRows
    .map((row, rowIndex) => {
      const renderedRow = `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`;
      if (rowIndex !== 0) {
        return renderedRow;
      }

      return `${renderedRow}\n| ${row.map(() => "---").join(" | ")} |`;
    })
    .join("\n");

  return convertedMarkdownBlock(rendered);
}

function convertedMarkdownBlock(markdown: string): MarkdropFeishuConvertedMarkdownBlock {
  return {
    __markdropConvertMarkdown: markdown,
  };
}

function parseTextElements(text: string): unknown[] {
  const elements: unknown[] = [];
  const pattern =
    /(\[([^\]]+)]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\$([^$\n]+)\$|~~([^~]+)~~|<u>(.*?)<\/u>|\*\*([^*]+)\*\*|\*([^*]+)\*)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    pushText(elements, text.slice(cursor, match.index));

    if (match[2] && match[3]) {
      pushText(elements, match[2], { link: { url: match[3] } });
    } else if (match[4]) {
      pushText(elements, match[4], { inline_code: true });
    } else if (match[5]) {
      pushEquation(elements, match[5]);
    } else if (match[6]) {
      pushText(elements, match[6], { strikethrough: true });
    } else if (match[7]) {
      pushText(elements, match[7], { underline: true });
    } else if (match[8]) {
      pushText(elements, match[8], { bold: true });
    } else if (match[9]) {
      pushText(elements, match[9], { italic: true });
    }

    cursor = pattern.lastIndex;
  }

  pushText(elements, text.slice(cursor));
  return elements.length ? elements : textElements(" ");
}

function textElements(text: string): unknown[] {
  const elements: unknown[] = [];
  pushText(elements, text);
  return elements.length ? elements : [{ text_run: { content: " " } }];
}

function codeTextElements(text: string): unknown[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const elements: unknown[] = [];

  lines.forEach((line, index) => {
    const suffix = index < lines.length - 1 ? "\n" : "";
    pushRawCodeText(elements, `${line}${suffix}`);
  });

  return elements.length ? elements : [{ text_run: { content: " " } }];
}

function pushRawCodeText(elements: unknown[], text: string): void {
  if (!text) {
    return;
  }

  for (const content of splitEvery(text, 1800)) {
    elements.push({
      text_run: {
        content,
      },
    });
  }
}

function pushEquation(elements: unknown[], expression: string): void {
  const normalized = normalizeEquationExpression(expression);
  if (!normalized || !looksLikeEquation(normalized)) {
    pushText(elements, `$${expression}$`);
    return;
  }

  elements.push(equationElement(normalized));
}

function equationElement(expression: string): unknown {
  return {
    equation: {
      content: normalizeEquationExpression(expression) || " ",
    },
  };
}

function pushText(elements: unknown[], text: string, style: TextRunStyle = {}): void {
  if (!text) {
    return;
  }

  for (const content of splitEvery(cleanupText(text), 1800)) {
    if (!content) {
      continue;
    }

    const textRun: Record<string, unknown> = { content };
    const textStyle = compactStyle(style);
    if (Object.keys(textStyle).length) {
      textRun.text_element_style = textStyle;
    }

    elements.push({ text_run: textRun });
  }
}

function parseQuoteGroup(lines: string[], startIndex: number): { text: string; nextIndex: number } | null {
  const quoteLines: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const match = lines[index].match(/^\s*((?:>\s*)+)(.*)$/);
    if (!match) {
      break;
    }

    const level = (match[1].match(/>/g) ?? []).length;
    const text = cleanupText(match[2]).trim();
    if (text) {
      quoteLines.push(`${"  ".repeat(level - 1)}${text}`);
    }
    index += 1;
  }

  return quoteLines.length ? { text: quoteLines.join("\n"), nextIndex: index } : null;
}

function parseListGroup(lines: string[], startIndex: number): { markdown: string; nextIndex: number } | null {
  const listLines: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const item = parseListLine(lines[index]);
    if (item) {
      listLines.push(lines[index]);
      index += 1;
      continue;
    }

    if (isBlank(lines[index])) {
      const nextIndex = findNextNonBlankLine(lines, index + 1);
      if (nextIndex !== -1 && parseListLine(lines[nextIndex])) {
        listLines.push("");
        index = nextIndex;
        continue;
      }
    }

    break;
  }

  return listLines.length ? { markdown: listLines.join("\n"), nextIndex: index } : null;
}

function parseListLine(line: string): true | null {
  const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
  if (bullet) {
    return true;
  }

  const ordered = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
  if (ordered) {
    return true;
  }

  return null;
}

function getStandaloneCodeLanguageLabel(lines: string[], index: number): string {
  const label = lines[index].trim().replace(/^`+|`+$/g, "").replace(/:$/, "");
  if (!/^[a-z0-9+#.-]{1,30}$/i.test(label)) {
    return "";
  }

  const nextIndex = findNextNonBlankLine(lines, index + 1);
  return nextIndex >= 0 && /^```[a-z0-9+#.-]*\s*$/i.test(lines[nextIndex]) ? label.toLowerCase() : "";
}

function isTableStart(lines: string[], index: number): boolean {
  const header = parseTableRow(lines[index]);
  const divider = parseTableDivider(lines[index + 1] ?? "");
  return Boolean(header && divider && header.length === divider.length && header.length > 1);
}

function parseTable(lines: string[], startIndex: number): { rows: string[][]; nextIndex: number } {
  const rows: string[][] = [parseTableRow(lines[startIndex]) ?? []];
  let index = startIndex + 2;

  while (index < lines.length) {
    const row = parseTableRow(lines[index]);
    if (!row) {
      break;
    }

    rows.push(row);
    index += 1;
  }

  return { rows, nextIndex: index };
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || parseTableDivider(trimmed)) {
    return null;
  }

  const content = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = splitTableCells(content).map((cell) => cell.trim());
  return cells.length > 1 ? cells : null;
}

function parseTableDivider(line: string): string[] | null {
  const cells = splitTableCells(line.trim().replace(/^\|/, "").replace(/\|$/, ""));
  if (cells.length <= 1) {
    return null;
  }

  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim())) ? cells : null;
}

function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }

    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function findNextNonBlankLine(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!isBlank(lines[index])) {
      return index;
    }
  }

  return -1;
}

function isBlank(text: string): boolean {
  return cleanupText(text).trim() === "";
}

function isDivider(line: string): boolean {
  const compact = line.trim().replace(/\s+/g, "");
  return /^-{3,}$/.test(compact) || /^\*{3,}$/.test(compact) || /^_{3,}$/.test(compact);
}

function cleanupText(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1");
}

function escapeMarkdownTableCell(text: string): string {
  return normalizeTableCellForFeishuConvert(text).replaceAll("\\", "\\\\").replaceAll("|", "\\|").trim();
}

function normalizeTableCellForFeishuConvert(text: string): string {
  return text.replace(/\$([^$]+)\$/g, (_match, expression: string) => latexToReadableText(expression));
}

function latexToReadableText(expression: string): string {
  return expression
    .trim()
    .replace(/\\mathcal\s*\{\s*L\s*}/g, "ℒ")
    .replace(/\\mathcal\s+L/g, "ℒ")
    .replace(/\bmathcalL\b/g, "ℒ")
    .replace(/\\mathbf\s*\{\s*([^}]+)\s*}/g, "$1")
    .replace(/\\boldsymbol\s*\{\s*([^}]+)\s*}/g, "$1")
    .replace(/\\theta\b|\btheta\b/g, "θ")
    .replace(/\\eta\b/g, "η")
    .replace(/(^|[^A-Za-z\\])eta\b/g, "$1η")
    .replace(/\\beta\b|\bbeta\b/g, "β")
    .replace(/\\alpha\b|\balpha\b/g, "α")
    .replace(/\\lambda\b|\blambda\b/g, "λ")
    .replace(/\\nabla\b|\bnabla\b/g, "∇")
    .replace(/\\leftarrow\b|\bleftarrow\b/g, "←")
    .replace(/\\rightarrow\b|\brightarrow\b/g, "→")
    .replace(/\\cdot\b|\bcdot\b/g, "·")
    .replace(/\\times\b|\btimes\b/g, "×")
    .replace(/\\sum\b|\bsum\b/g, "∑")
    .replace(/\\frac\s*\{([^}]+)}\s*\{([^}]+)}/g, "$1/$2")
    .replace(/\^\s*\{\s*-?1\s*}/g, "⁻¹")
    .replace(/_\s*\{\s*([^}]+)\s*}/g, "_$1")
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/\s+/g, " ");
}

function normalizeEquationExpression(expression: string): string {
  return expression
    .trim()
    .replaceAll("⊙", "\\odot ")
    .replaceAll("·", "\\cdot ")
    .replaceAll("×", "\\times ")
    .replaceAll("÷", "\\div ")
    .replace(/\.\.\./g, "\\ldots ")
    .replace(/\s+/g, " ");
}

function looksLikeEquation(expression: string): boolean {
  return /[\\^_{}=<>+\-*/]|\b(?:frac|sqrt|sum|prod|begin|end|mathbf|mathbb|cdot|times)\b/.test(expression);
}

function compactStyle(value: TextRunStyle): Partial<TextRunStyle> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== false)) as Partial<TextRunStyle>;
}

function splitEvery(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.length ? chunks : [" "];
}
