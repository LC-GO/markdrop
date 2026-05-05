type TextRichText = {
  type: "text";
  text: {
    content: string;
    link?: { url: string } | null;
  };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
};

type EquationRichText = {
  type: "equation";
  equation: {
    expression: string;
  };
  annotations?: {
    bold: false;
    italic: false;
    strikethrough: false;
    underline: false;
    code: false;
    color: "default";
  };
};

type RichText = TextRichText | EquationRichText;

export type NotionBlock = {
  object: "block";
  type: string;
  [key: string]: unknown;
};

const SUPPORTED_CODE_LANGUAGES = new Set([
  "abap",
  "arduino",
  "bash",
  "basic",
  "c",
  "clojure",
  "coffeescript",
  "c++",
  "c#",
  "css",
  "dart",
  "diff",
  "docker",
  "elixir",
  "elm",
  "erlang",
  "flow",
  "fortran",
  "f#",
  "gherkin",
  "glsl",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "latex",
  "less",
  "lisp",
  "livescript",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "matlab",
  "mermaid",
  "nix",
  "objective-c",
  "ocaml",
  "pascal",
  "perl",
  "php",
  "plain text",
  "powershell",
  "prolog",
  "protobuf",
  "python",
  "r",
  "reason",
  "ruby",
  "rust",
  "sass",
  "scala",
  "scheme",
  "scss",
  "shell",
  "sql",
  "swift",
  "typescript",
  "vb.net",
  "verilog",
  "vhdl",
  "visual basic",
  "webassembly",
  "xml",
  "yaml",
  "java/c/c++/c#",
]);

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: NotionBlock[] = [];
  const paragraphLines: string[] = [];
  let pendingCodeLanguage = "";

  const flushParagraph = () => {
    const text = paragraphLines.join("\n").trim();
    paragraphLines.length = 0;

    if (text) {
      blocks.push(textBlock("paragraph", text));
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isVisuallyBlank(line)) {
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

    const codeLanguageLabel = getStandaloneCodeLanguageLabel(lines, index);
    if (codeLanguageLabel) {
      pendingCodeLanguage = codeLanguageLabel;
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
      blocks.push(codeBlock(codeLines.join("\n"), language));
      continue;
    }

    pendingCodeLanguage = "";

    const image = line.match(/^\s*!\[([^\]]*)]\(([^)\s]+)\)\s*$/i);
    if (image) {
      flushParagraph();
      blocks.push(imageBlock(image[2], image[1]));
      continue;
    }

    if (isTableStart(lines, index)) {
      flushParagraph();
      const table = parseTable(lines, index);
      blocks.push(table.block);
      index = table.nextIndex - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length, 3);
      blocks.push(textBlock(`heading_${level}`, heading[2]));
      continue;
    }

    if (isDividerLine(line)) {
      flushParagraph();
      blocks.push({ object: "block", type: "divider", divider: {} });
      continue;
    }

    if (isEmptyListItemLine(line)) {
      flushParagraph();
      continue;
    }

    if (parseListItem(line)) {
      flushParagraph();
      const list = parseList(lines, index);
      blocks.push(...list.blocks);
      index = list.nextIndex - 1;
      continue;
    }

    const quote = parseQuoteLine(line);
    if (quote) {
      flushParagraph();
      const quoteResult = parseQuoteGroup(lines, index);
      blocks.push(...quoteResult.blocks);
      index = quoteResult.nextIndex - 1;
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  const compactedBlocks = compactBlocks(blocks);
  return compactedBlocks.length ? compactedBlocks : [textBlock("paragraph", "")];
}

interface ListItemLine {
  indent: number;
  markerNumber?: number;
  checked?: boolean;
  type: "bulleted_list_item" | "numbered_list_item" | "to_do";
  text: string;
}

interface ParseResult {
  blocks: NotionBlock[];
  nextIndex: number;
}

interface QuoteLine {
  level: number;
  text: string;
}

interface TableResult {
  block: NotionBlock;
  nextIndex: number;
}

export function sourceUrlBlock(sourceUrl: string): NotionBlock {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: {
            content: "Source",
            link: { url: sourceUrl },
          },
        },
      ],
    },
  };
}

function textBlock(type: string, text: string): NotionBlock {
  return {
    object: "block",
    type,
    [type]: {
      rich_text: parseRichText(text),
    },
  };
}

function listBlock(item: ListItemLine, children: NotionBlock[] = []): NotionBlock {
  const value: Record<string, unknown> = {
    rich_text: parseRichText(item.text),
  };

  if (item.type === "to_do") {
    value.checked = Boolean(item.checked);
  }

  if (children.length) {
    value.children = children;
  }

  return {
    object: "block",
    type: item.type,
    [item.type]: value,
  };
}

function appendChildBlock(parent: NotionBlock, child: NotionBlock): void {
  const value = parent[parent.type];
  if (!value || typeof value !== "object") {
    return;
  }

  const blockValue = value as { children?: NotionBlock[] };
  blockValue.children ??= [];
  blockValue.children.push(child);
}

function parseList(lines: string[], startIndex: number, baseIndent = parseListItem(lines[startIndex])?.indent ?? 0): ParseResult {
  const blocks: NotionBlock[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const itemInfo = readListItemSkippingBlankLines(lines, index, baseIndent);
    if (!itemInfo) {
      break;
    }

    const { item } = itemInfo;
    index = itemInfo.index;

    if (!item || item.indent < baseIndent) {
      break;
    }

    if (item.indent > baseIndent) {
      break;
    }

    index += 1;
    const childStart = findNextNonBlankLine(lines, index);
    const childItem = parseListItem(lines[childStart] ?? "");
    let children: NotionBlock[] = [];

    if (childStart !== -1 && childItem && childItem.indent > item.indent) {
      const childResult = parseList(lines, childStart, childItem.indent);
      children = childResult.blocks;
      index = childResult.nextIndex;
    } else if (childStart !== -1 && childItem && shouldTreatSameIndentAsVisualChild(item, childItem)) {
      const childResult = parseSameIndentVisualChildList(lines, childStart, item);
      children = childResult.blocks;
      index = childResult.nextIndex;
    }

    blocks.push(listBlock(item, children));
  }

  return { blocks, nextIndex: index };
}

function parseSameIndentVisualChildList(lines: string[], startIndex: number, parent: ListItemLine): ParseResult {
  const blocks: NotionBlock[] = [];
  let index = startIndex;
  let previousMarker = 0;

  while (index < lines.length) {
    const itemInfo = readListItemSkippingBlankLines(lines, index, parent.indent);
    if (!itemInfo) {
      break;
    }

    const { item } = itemInfo;
    index = itemInfo.index;

    if (!item || item.indent !== parent.indent || item.type !== parent.type) {
      break;
    }

    if (item.type === "numbered_list_item") {
      const textLooksLikeChild = looksLikeVisualChildListText(item.text);
      const marker = item.markerNumber ?? 0;
      if (!textLooksLikeChild && blocks.length === 0) {
        if (marker > (parent.markerNumber ?? Number.MAX_SAFE_INTEGER)) {
          break;
        }
      } else if (!textLooksLikeChild && previousMarker && marker > previousMarker + 1) {
        break;
      }
      previousMarker = marker;
    } else if (!looksLikeVisualChildListText(item.text)) {
      break;
    }

    index += 1;
    const childStart = findNextNonBlankLine(lines, index);
    const childItem = parseListItem(lines[childStart] ?? "");
    let children: NotionBlock[] = [];
    if (childStart !== -1 && childItem && childItem.indent > item.indent) {
      const childResult = parseList(lines, childStart, childItem.indent);
      children = childResult.blocks;
      index = childResult.nextIndex;
    }

    blocks.push(listBlock(item, children));
  }

  return { blocks, nextIndex: index };
}

function readListItemSkippingBlankLines(
  lines: string[],
  index: number,
  minIndent: number,
): { item: ListItemLine; index: number } | null {
  const item = parseListItem(lines[index] ?? "");
  if (item) {
    return { item, index };
  }

  if (!isVisuallyBlank(lines[index] ?? "")) {
    return null;
  }

  const nextIndex = findNextNonBlankLine(lines, index + 1);
  if (nextIndex === -1) {
    return null;
  }

  const nextItem = parseListItem(lines[nextIndex] ?? "");
  if (!nextItem || nextItem.indent < minIndent) {
    return null;
  }

  return { item: nextItem, index: nextIndex };
}

function shouldTreatSameIndentAsVisualChild(parent: ListItemLine, child: ListItemLine): boolean {
  return false;
}

function isCompatibleListType(parentType: ListItemLine["type"], childType: ListItemLine["type"]): boolean {
  if (parentType === childType) {
    return true;
  }

  return parentType === "bulleted_list_item" && childType === "to_do";
}

function looksLikeVisualChildListText(text: string): boolean {
  return /^(?:子(?:项|步骤|级|任务|问题|条|目录|节点|列表)?|(?:sub[-\s]?(?:item|step)|child|nested)\b)/i.test(text.trim());
}

function parseListItem(line: string): ListItemLine | null {
  const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
  if (bullet) {
    const task = parseTaskListText(bullet[2]);
    const text = cleanupListItemText(task?.text ?? bullet[2]);
    if (!text || isMarkerOnly(text)) {
      return null;
    }

    return {
      indent: indentationWidth(bullet[1]),
      checked: task?.checked,
      type: task ? "to_do" : "bulleted_list_item",
      text,
    };
  }

  const numbered = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
  if (numbered) {
    const text = cleanupListItemText(numbered[2]);
    if (!text || isMarkerOnly(text)) {
      return null;
    }

    return {
      indent: indentationWidth(numbered[1]),
      markerNumber: Number(numbered[0].match(/\d+/)?.[0] ?? 0),
      type: "numbered_list_item",
      text,
    };
  }

  return null;
}

function parseTaskListText(text: string): { checked: boolean; text: string } | null {
  const task = text.match(/^\\?\[([ xX])\\?]\s*(.+)$/);
  if (!task) {
    return null;
  }

  return {
    checked: task[1].toLowerCase() === "x",
    text: task[2],
  };
}

function parseQuoteGroup(lines: string[], startIndex: number): ParseResult {
  const quoteLines: QuoteLine[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const quote = parseQuoteLine(lines[index]);
    if (!quote) {
      break;
    }

    quoteLines.push(quote);
    index += 1;
  }

  return {
    blocks: quoteLinesToBlocks(quoteLines),
    nextIndex: index,
  };
}

function parseQuoteLine(line: string): QuoteLine | null {
  const match = line.match(/^\s*((?:>\s*)+)(.*)$/);
  if (!match) {
    return null;
  }

  const level = (match[1].match(/>/g) ?? []).length;
  return {
    level,
    text: cleanupQuoteText(match[2]),
  };
}

function quoteLinesToBlocks(lines: QuoteLine[]): NotionBlock[] {
  const roots: NotionBlock[] = [];
  const stack: Array<{ level: number; block: NotionBlock }> = [];

  mergeAdjacentQuoteLines(lines).forEach((line) => {
    if (isVisuallyBlank(line.text)) {
      return;
    }

    const block = textBlock("quote", line.text);
    while (stack.length && stack[stack.length - 1].level >= line.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      appendChildBlock(parent.block, block);
    } else {
      roots.push(block);
    }

    stack.push({ level: line.level, block });
  });

  return roots;
}

function mergeAdjacentQuoteLines(lines: QuoteLine[]): QuoteLine[] {
  const merged: QuoteLine[] = [];

  lines.forEach((line) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.level === line.level) {
      previous.text = mergeQuoteText(previous.text, line.text);
      return;
    }

    merged.push({ ...line });
  });

  return merged;
}

function mergeQuoteText(left: string, right: string): string {
  if (isVisuallyBlank(left)) {
    return right;
  }

  if (isVisuallyBlank(right)) {
    return left;
  }

  return `${left}\n${right}`;
}

function cleanupQuoteText(text: string): string {
  return cleanupPlainText(text.replace(/^\s*(?:>\s*)+/, "")).trim();
}

function compactBlocks(blocks: NotionBlock[]): NotionBlock[] {
  return blocks.map(compactBlockChildren).filter((block) => !isEmptyTextBlock(block));
}

function compactBlockChildren(block: NotionBlock): NotionBlock {
  const value = block[block.type];

  if (!value || typeof value !== "object" || !("children" in value)) {
    return block;
  }

  const blockValue = value as { children?: unknown };
  if (!Array.isArray(blockValue.children)) {
    return block;
  }

  return {
    ...block,
    [block.type]: {
      ...blockValue,
      children: compactBlocks(blockValue.children as NotionBlock[]),
    },
  };
}

function isEmptyTextBlock(block: NotionBlock): boolean {
  if (
    block.type !== "paragraph" &&
    block.type !== "quote" &&
    block.type !== "bulleted_list_item" &&
    block.type !== "numbered_list_item" &&
    !block.type.startsWith("heading_")
  ) {
    return false;
  }

  const value = block[block.type] as { rich_text?: RichText[] } | undefined;
  return isRichTextBlank(value?.rich_text ?? []);
}

function isRichTextBlank(richText: RichText[]): boolean {
  return richText.every((item) => {
    if (item.type === "equation") {
      return false;
    }

    return isVisuallyBlank(item.text.content) || isMarkerOnly(item.text.content);
  });
}

function indentationWidth(indent: string): number {
  return indent.replaceAll("\t", "    ").length;
}

function isEmptyListItemLine(line: string): boolean {
  const marker = line.match(/^\s*(?:[-*+]|\d+[.)])(?:\s+(.*))?\s*$/);
  if (marker) {
    return isVisuallyBlank(marker[1] ?? "");
  }

  return isMarkerOnly(line);
}

function isDividerLine(line: string): boolean {
  const compact = line.trim().replace(/\s+/g, "");
  return /^-{3,}$/.test(compact) || /^\*{3,}$/.test(compact) || /^_{3,}$/.test(compact);
}

function getStandaloneCodeLanguageLabel(lines: string[], index: number): string {
  const label = normalizeCodeLanguageLabel(lines[index]);
  if (!label) {
    return "";
  }

  const nextIndex = findNextNonBlankLine(lines, index + 1);
  if (nextIndex === -1) {
    return "";
  }

  const fence = lines[nextIndex].match(/^```([a-z0-9+#.-]*)\s*$/i);
  if (!fence) {
    return "";
  }

  const fenceLanguage = normalizeCodeLanguage(fence[1]);
  return !fence[1] || fenceLanguage === label ? label : "";
}

function normalizeCodeLanguageLabel(line: string): string {
  const label = line.trim().replace(/^`+|`+$/g, "").replace(/:$/, "");
  if (!/^[a-z0-9+#.-]{1,30}$/i.test(label)) {
    return "";
  }

  const normalized = normalizeCodeLanguage(label);
  return normalized === "plain text" ? "" : normalized;
}

function findNextNonBlankLine(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!isVisuallyBlank(lines[index])) {
      return index;
    }
  }

  return -1;
}

function isTableStart(lines: string[], index: number): boolean {
  const header = parseTableRow(lines[index]);
  const divider = parseTableDivider(lines[index + 1] ?? "");
  return Boolean(header && divider && header.length === divider.length && header.length > 1);
}

function parseTable(lines: string[], startIndex: number): TableResult {
  const header = parseTableRow(lines[startIndex]) ?? [];
  const rows: string[][] = [header];
  let index = startIndex + 2;

  while (index < lines.length) {
    const row = parseTableRow(lines[index]);
    if (!row) {
      break;
    }

    rows.push(row);
    index += 1;
  }

  return {
    block: tableBlock(rows),
    nextIndex: index,
  };
}

function tableBlock(rows: string[][]): NotionBlock {
  const tableWidth = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [...row, ...Array<string>(tableWidth - row.length).fill("")]);

  return {
    object: "block",
    type: "table",
    table: {
      table_width: tableWidth,
      has_column_header: true,
      has_row_header: false,
      children: normalizedRows.map(tableRowBlock),
    },
  };
}

function tableRowBlock(row: string[]): NotionBlock {
  return {
    object: "block",
    type: "table_row",
    table_row: {
      cells: row.map((cell) => parseRichText(cell.trim())),
    },
  };
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

function codeBlock(text: string, language: string): NotionBlock {
  return {
    object: "block",
    type: "code",
    code: {
      rich_text: chunkText(text || " "),
      language: normalizeCodeLanguage(language),
    },
  };
}

function equationBlock(expression: string): NotionBlock {
  const normalized = normalizeEquationExpression(expression);
  if (!isStrongKatexExpression(normalized)) {
    return textBlock("paragraph", normalized);
  }

  return {
    object: "block",
    type: "equation",
    equation: {
      expression: normalized || " ",
    },
  };
}

function imageBlock(url: string, caption: string): NotionBlock {
  if (!/^https?:\/\//i.test(url)) {
    return textBlock("paragraph", caption ? `图片未保存：${caption}` : "图片未保存");
  }

  if (!isSupportedExternalImageUrl(url)) {
    return textBlock("paragraph", caption ? `[图片链接：${caption}](${url})` : `[图片链接](${url})`);
  }

  return {
    object: "block",
    type: "image",
    image: {
      type: "external",
      external: {
        url,
      },
      caption: caption ? parseRichText(caption) : [],
    },
  };
}

function parseRichText(text: string): RichText[] {
  const richText: RichText[] = [];
  const pattern =
    /(\[([^\]]+)]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\$([^$\n]+)\$|~~([^~]+)~~|<u>(.*?)<\/u>|\*\*([^*]+)\*\*|\*([^*]+)\*)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    pushChunks(richText, text.slice(cursor, match.index));

    if (match[2] && match[3]) {
      pushChunks(richText, match[2], { link: match[3] });
    } else if (match[4]) {
      pushChunks(richText, match[4], { code: true });
    } else if (match[5]) {
      pushEquation(richText, match[5]);
    } else if (match[6]) {
      pushChunks(richText, match[6], { strikethrough: true });
    } else if (match[7]) {
      pushChunks(richText, match[7], { underline: true });
    } else if (match[8]) {
      pushChunks(richText, match[8], { bold: true });
    } else if (match[9]) {
      pushChunks(richText, match[9], { italic: true });
    }

    cursor = pattern.lastIndex;
  }

  pushChunks(richText, text.slice(cursor));
  return richText.length ? richText : chunkText(" ");
}

function pushEquation(richText: RichText[], expression: string): void {
  const normalized = normalizeEquationExpression(expression);
  if (!normalized || !isStrongKatexExpression(normalized) || normalized.length > 1000) {
    pushChunks(richText, `$${expression}$`);
    return;
  }

  richText.push({
    type: "equation",
    equation: {
      expression: normalized,
    },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
    },
  });
}

function pushChunks(
  richText: RichText[],
  text: string,
  options: { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean; link?: string } = {},
): void {
  if (!text) {
    return;
  }

  for (const chunk of splitEvery(text, 1900)) {
    const content = options.code ? chunk : cleanupPlainText(chunk);
    if (!content) {
      continue;
    }

    richText.push({
      type: "text",
      text: {
        content,
        link: options.link ? { url: options.link } : null,
      },
      annotations: {
        bold: options.bold,
        italic: options.italic,
        strikethrough: options.strikethrough,
        underline: options.underline,
        code: options.code,
      },
    });
  }
}

function cleanupPlainText(text: string): string {
  return stripInvisible(text)
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1");
}

function cleanupListItemText(text: string): string {
  const cleaned = cleanupPlainText(text)
    .replace(/<br\s*\/?>/gi, " ")
    .trim();

  return isVisuallyBlank(cleaned) ? "" : cleaned;
}

function stripInvisible(text: string): string {
  return text.replace(/[\u200b\u200c\u200d\ufeff]/g, "");
}

function isVisuallyBlank(text: string): boolean {
  return stripInvisible(text)
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .trim() === "";
}

function isMarkerOnly(text: string): boolean {
  return /^[\s\u00a0\u200b\u200c\u200d\ufeff\u2022\u2023\u25e6\u2219\u00b7]*$/.test(text) && /[\u2022\u2023\u25e6\u2219\u00b7]/.test(text);
}

function chunkText(text: string): RichText[] {
  return splitEvery(text, 1900).map((content) => ({
    type: "text",
    text: {
      content,
      link: null,
    },
  }));
}

function splitEvery(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.length ? chunks : [" "];
}

function normalizeCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return "plain text";
  }

  if (normalized === "js") {
    return "javascript";
  }

  if (normalized === "ts") {
    return "typescript";
  }

  if (normalized === "sh") {
    return "shell";
  }

  if (normalized === "py") {
    return "python";
  }

  return SUPPORTED_CODE_LANGUAGES.has(normalized) ? normalized : "plain text";
}

function normalizeEquationExpression(expression: string): string {
  return expression
    .trim()
    .replaceAll("⊙", "\\odot ")
    .replaceAll("·", "\\cdot ")
    .replaceAll("×", "\\times ")
    .replaceAll("÷", "\\div ")
    .replaceAll("≤", "\\le ")
    .replaceAll("≥", "\\ge ")
    .replaceAll("≠", "\\ne ")
    .replaceAll("≈", "\\approx ")
    .replaceAll("∞", "\\infty ")
    .replaceAll("∑", "\\sum ")
    .replaceAll("∏", "\\prod ")
    .replaceAll("√", "\\sqrt ")
    .replaceAll("→", "\\to ")
    .replaceAll("←", "\\leftarrow ")
    .replaceAll("∈", "\\in ")
    .replace(/\.\.\./g, "\\ldots ")
    .replace(/\s+/g, " ");
}

function looksLikeInlineEquation(expression: string): boolean {
  return /[\\^_{}=<>]|[+\-*/]|[a-zA-Z]/.test(expression);
}

function isStrongKatexExpression(expression: string): boolean {
  if (!looksLikeInlineEquation(expression)) {
    return false;
  }

  if (/[\u4e00-\u9fff：；，。]/.test(expression) || expression.length > 500) {
    return false;
  }

  if (/\\(?:frac|sqrt|sum|prod|left|right|begin|end|odot|times|cdot|ldots)/.test(expression)) {
    return true;
  }

  return /[_^{}]/.test(expression) && /[=+\-*/\\]/.test(expression);
}

function isSupportedExternalImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && url.length <= 2000;
  } catch {
    return false;
  }
}
