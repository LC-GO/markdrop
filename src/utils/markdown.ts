import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { inferCodeLanguage, normalizeCodeLanguage, normalizeCodeLanguageLabel } from "./codeLanguage";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

turndown.use(gfm);

turndown.addRule("stableTables", {
  filter: (node) => node.nodeName === "TABLE",
  replacement: (_content, node) => renderMarkdownTable(node as HTMLTableElement),
});

turndown.addRule("fencedCodeLanguage", {
  filter: (node) => node.nodeName === "PRE",
  replacement: (_content, node) => {
    const pre = node as HTMLElement;
    const code = pre.querySelector("code");
    const text = extractCodeText(pre, code).replace(/\n+$/g, "");
    const language = detectLanguage(pre, code) || inferCodeLanguage(text);
    return `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n`;
  },
});

turndown.addRule("strikethrough", {
  filter: ["del", "s"],
  replacement: (content) => `~~${content}~~`,
});

turndown.addRule("underline", {
  filter: "u",
  replacement: (content) => `<u>${content}</u>`,
});

turndown.addRule("horizontalRule", {
  filter: "hr",
  replacement: () => "\n\n---\n\n",
});

turndown.addRule("visualDivider", {
  filter: (node) => isVisualDividerElement(node),
  replacement: () => "\n\n---\n\n",
});

turndown.addRule("dataMathBlock", {
  filter: (node) => isDataMathBlock(node),
  replacement: (_content, node) => {
    const expression = cleanupMathExpression((node as Element).getAttribute("data-math") ?? "");
    return expression ? `\n\n$$\n${expression}\n$$\n\n` : "";
  },
});

turndown.addRule("dataMathInline", {
  filter: (node) => isDataMathInline(node),
  replacement: (_content, node) => {
    const expression = cleanupMathExpression((node as Element).getAttribute("data-math") ?? "");
    return expression ? `$${expression}$` : "";
  },
});

turndown.addRule("displayMath", {
  filter: (node) => isDisplayMathElement(node),
  replacement: (_content, node) => {
    const expression = extractMathExpression(node as Element);
    return expression ? `\n\n$$\n${expression}\n$$\n\n` : mathFallbackText(node as Element, true);
  },
});

turndown.addRule("inlineMath", {
  filter: (node) => isInlineMathElement(node),
  replacement: (_content, node) => {
    const expression = extractMathExpression(node as Element);
    return expression ? `$${expression}$` : mathFallbackText(node as Element, false);
  },
});

turndown.addRule("safeImages", {
  filter: "img",
  replacement: (_content, node) => {
    const image = node as HTMLImageElement;
    const alt = cleanupImageAlt(image.getAttribute("alt") ?? "");
    const src = normalizeImageUrl(image.getAttribute("src") ?? "");

    if (src && isExternalImageUrl(src)) {
      return `\n\n![${alt}](${src})\n\n`;
    }

    return alt ? `\n\n[图片未保存：${alt}]\n\n` : "\n\n[图片未保存]\n\n";
  },
});

export function htmlToMarkdown(html: string, textFallback = ""): string {
  if (html.trim()) {
    const preprocessed = preprocessHtmlForMarkdown(html);
    return cleanupMarkdown(restoreMathPlaceholders(turndown.turndown(preprocessed.html), preprocessed.math));
  }

  return cleanupMarkdown(textFallback);
}

export function prependSource(markdown: string, sourceUrl: string): string {
  if (!sourceUrl) {
    return markdown;
  }

  return `[Source](${sourceUrl})\n\n${markdown}`.trim();
}

function cleanupMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, " ")
    .replace(/^\s*[-*+]\s*(?:[\u200b\u200c\u200d\ufeff]|&nbsp;|<br\s*\/?>|\s)*$/gim, "")
    .replace(/^\s*[•‣◦]\s*$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function preprocessHtmlForMarkdown(html: string): { html: string; math: string[] } {
  if (typeof document === "undefined") {
    return { html, math: [] };
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const math: string[] = [];

  wrapper.querySelectorAll<HTMLElement>(".math-block[data-math], [data-markdrop-math='block'][data-math]").forEach((node) => {
    if (node.closest("table")) {
      return;
    }

    const expression = cleanupMathExpression(node.getAttribute("data-math") ?? "");
    if (!looksLikeMathExpression(expression)) {
      return;
    }

    const token = `MARKDROPMATHBLOCK${math.length}END`;
    math.push(expression);

    const replacement = document.createElement("p");
    replacement.textContent = token;
    node.replaceWith(replacement);
  });

  return { html: wrapper.innerHTML, math };
}

function restoreMathPlaceholders(markdown: string, math: string[]): string {
  if (!math.length) {
    return markdown;
  }

  return markdown.replace(
    /\b(?:MARKDROPMATHBLOCK(\d+)END|MARKDROP\\?_MATH\\?_BLOCK\\?_(\d+)\\?_END)\b/g,
    (_match, compactIndexText: string | undefined, legacyIndexText: string | undefined) => {
      const expression = math[Number(compactIndexText ?? legacyIndexText)];
      return expression ? `\n\n$$\n${expression}\n$$\n\n` : "";
    },
  );
}

function renderMarkdownTable(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.children)
        .filter((cell) => ["td", "th"].includes(cell.tagName.toLowerCase()))
        .map((cell) => renderTableCell(cell as HTMLElement)),
    )
    .filter((row) => row.length > 0);

  if (!rows.length) {
    return "";
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  if (columnCount < 2) {
    return rows.map((row) => row.join(" ")).join("\n");
  }

  const normalizedRows = rows.map((row) => [...row, ...Array<string>(columnCount - row.length).fill("")]);
  const header = normalizedRows[0];
  const body = normalizedRows.slice(1);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];

  return `\n\n${lines.join("\n")}\n\n`;
}

function renderTableCell(cell: HTMLElement): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  normalizeMathInTableCell(clone);
  clone.querySelectorAll("button, svg").forEach((node) => node.remove());

  const text = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  return escapeMarkdownTableText(text || " ");
}

const tableCellMathSelector = [
  ".math-block[data-math]",
  "[data-markdrop-math][data-math]",
  ".katex-display",
  ".katex",
  ".katex-mathml",
  "mjx-container",
  "mjx-assistive-mml",
  "math",
  "[data-tex]",
  "[data-latex]",
  "[data-math]",
  "[data-formula]",
  "[data-expression]",
  "[data-original-tex]",
].join(",");

function normalizeMathInTableCell(root: HTMLElement): void {
  Array.from(root.querySelectorAll<Element>(tableCellMathSelector))
    .filter((node) => isTopLevelTableMathCandidate(node, root))
    .forEach((node) => {
      const expression = extractMathExpression(node);
      if (!looksLikeMathExpression(expression)) {
        return;
      }

      const replacement = document.createElement("span");
      replacement.textContent = `$${expression}$`;
      node.replaceWith(replacement);
    });
}

function isTopLevelTableMathCandidate(node: Element, root: HTMLElement): boolean {
  let parent = node.parentElement;
  while (parent && parent !== root) {
    if (parent.matches(tableCellMathSelector)) {
      return false;
    }
    parent = parent.parentElement;
  }
  return true;
}

function escapeMarkdownTableText(text: string): string {
  return text.replace(/\|/g, "\\|").trim();
}

function detectLanguage(pre: HTMLElement, code: HTMLElement | null): string {
  const candidates = [
    code ? detectLanguageFromElement(code) : "",
    detectLanguageFromElement(pre),
    detectNearbyCodeLanguage(pre),
  ];

  return candidates.find(Boolean) ?? "";
}

function detectLanguageFromElement(element: Element): string {
  const attributes = [
    "data-language",
    "data-lang",
    "data-code-language",
    "data-highlight-language",
    "data-lexer",
    "aria-label",
  ];

  for (const attribute of attributes) {
    const language = normalizeCodeLanguageLabel(element.getAttribute(attribute) ?? "");
    if (language) {
      return language;
    }
  }

  const className = element.getAttribute("class") ?? "";
  const classLanguage =
    className.match(/(?:^|\s)language-([a-z0-9+#.-]+)/i)?.[1] ??
    className.match(/(?:^|\s)lang-([a-z0-9+#.-]+)/i)?.[1] ??
    className.match(/(?:^|\s)highlight-([a-z0-9+#.-]+)/i)?.[1];

  return normalizeCodeLanguage(classLanguage ?? "");
}

function detectNearbyCodeLanguage(pre: HTMLElement): string {
  const nearby = collectNearbyCodeLanguageLabels(pre);
  for (const label of nearby) {
    const language = normalizeCodeLanguageLabel(label);
    if (language) {
      return language;
    }
  }

  return "";
}

function collectNearbyCodeLanguageLabels(pre: HTMLElement): string[] {
  const labels: string[] = [];
  let current: HTMLElement | null = pre;

  for (let depth = 0; current && depth < 4; depth += 1) {
    const previous = current.previousElementSibling;
    if (previous instanceof HTMLElement) {
      labels.push(shortElementLabel(previous));
    }

    const parent: HTMLElement | null = current.parentElement;
    if (parent) {
      labels.push(detectLanguageFromElement(parent));
      labels.push(...collectShortChildLabelsBefore(parent, current));
    }

    current = parent;
  }

  return labels.filter(Boolean);
}

function collectShortChildLabelsBefore(parent: HTMLElement, child: HTMLElement): string[] {
  const labels: string[] = [];
  for (const sibling of Array.from(parent.children)) {
    if (sibling === child) {
      break;
    }
    if (sibling instanceof HTMLElement && !sibling.querySelector("pre, code")) {
      labels.push(shortElementLabel(sibling));
    }
  }
  return labels.slice(-3);
}

function shortElementLabel(element: HTMLElement): string {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length <= 40 ? text : "";
}

function extractCodeText(pre: HTMLElement, code: HTMLElement | null): string {
  const target = code ?? pre;
  const rawText = normalizeCodeText(target.textContent ?? pre.textContent ?? "");
  const domText = normalizeCodeText(readCodeDomText(target));

  return lineCount(domText) > lineCount(rawText) ? domText : rawText;
}

function readCodeDomText(node: Node): string {
  let text = "";

  const walk = (current: Node, root: Node) => {
    if (current.nodeType === Node.TEXT_NODE) {
      text += current.textContent ?? "";
      return;
    }

    if (!(current instanceof HTMLElement)) {
      current.childNodes.forEach((child) => walk(child, root));
      return;
    }

    const tagName = current.tagName.toLowerCase();
    if (tagName === "br") {
      text += "\n";
      return;
    }

    const boundary = current !== root && isCodeLineBoundary(current);
    const beforeLength = text.length;
    current.childNodes.forEach((child) => walk(child, root));

    if (boundary && text.length > beforeLength && !text.endsWith("\n")) {
      text += "\n";
    }
  };

  walk(node, node);
  return text;
}

function isCodeLineBoundary(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  if (["div", "p", "li", "tr"].includes(tagName)) {
    return true;
  }

  const label = [element.getAttribute("class"), element.getAttribute("data-line"), element.getAttribute("data-line-number")]
    .join(" ")
    .toLowerCase();
  return /\b(line|cm-line|view-line)\b/.test(label);
}

function normalizeCodeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

function lineCount(text: string): number {
  return text ? text.split("\n").length : 0;
}

function normalizeImageUrl(src: string): string {
  const value = src.trim();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) {
    return "";
  }

  try {
    return new URL(value, globalThis.location?.href).href;
  } catch {
    return "";
  }
}

function isExternalImageUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function cleanupImageAlt(alt: string): string {
  return alt.replace(/[[\]\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function isVisualDividerElement(node: Node): boolean {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  if ((node.textContent ?? "").trim()) {
    return false;
  }

  const label = [
    node.getAttribute("role"),
    node.getAttribute("aria-orientation"),
    node.getAttribute("data-testid"),
    node.className.toString(),
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(separator|divider|horizontal-rule|border-t|border-b)\b/.test(label)) {
    return true;
  }

  const style = node.getAttribute("style")?.toLowerCase() ?? "";
  return /border-(top|bottom)\s*:/.test(style);
}

function isDataMathBlock(node: Node): boolean {
  if (!(node instanceof Element) || node.closest("table")) {
    return false;
  }

  if (node.getAttribute("data-markdrop-math") === "inline") {
    return false;
  }

  const expression = cleanupMathExpression(node.getAttribute("data-math") ?? "");
  if (!looksLikeMathExpression(expression)) {
    return false;
  }

  return (
    node.getAttribute("data-markdrop-math") === "block" ||
    node.classList.contains("math-block") ||
    Boolean(node.querySelector(".katex-display, math"))
  );
}

function isDataMathInline(node: Node): boolean {
  if (!(node instanceof Element) || node.closest("table")) {
    return false;
  }

  const expression = cleanupMathExpression(node.getAttribute("data-math") ?? "");
  if (!looksLikeMathExpression(expression)) {
    return false;
  }

  return node.getAttribute("data-markdrop-math") === "inline" || node.classList.contains("math-inline");
}

function hasClass(node: Node, className: string): boolean {
  return node instanceof Element && node.classList.contains(className);
}

function isDisplayMathElement(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  return hasClass(node, "katex-display") || isDisplayMathJax(node) || node.tagName.toLowerCase() === "math";
}

function isInlineMathElement(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  return isDataMathInline(node) || hasClass(node, "katex") || isInlineMathJax(node);
}

function isDisplayMathJax(node: Node): boolean {
  return node instanceof Element && node.tagName.toLowerCase() === "mjx-container" && node.getAttribute("display") === "true";
}

function isInlineMathJax(node: Node): boolean {
  return node instanceof Element && node.tagName.toLowerCase() === "mjx-container" && node.getAttribute("display") !== "true";
}

export function extractMathExpression(element: Element): string {
  const candidates = [
    findMathAnnotation(element),
    findMathScript(element),
    findMathMlExpression(element),
    findMathAttribute(element),
    findReadableMathText(element),
  ].map(cleanupMathExpression);

  return selectBestMathExpression(candidates);
}

function findMathAnnotation(element: Element): string {
  const annotation = Array.from(element.querySelectorAll("annotation")).find((node) =>
    /tex|latex/i.test(node.getAttribute("encoding") ?? ""),
  );
  return annotation?.textContent ?? "";
}

function findMathScript(element: Element): string {
  const script = element.querySelector('script[type*="math/tex"], script[type*="math/latex"]');
  return script?.textContent ?? "";
}

function cleanupMathExpression(expression: string): string {
  return decodeHtmlEntities(expression)
    .replace(/^\\\(\s*/, "")
    .replace(/\s*\\\)$/, "")
    .replace(/^\\\[\s*/, "")
    .replace(/\s*\\\]$/, "")
    .replace(/^\s*\$+\s*/, "")
    .replace(/\s*\$+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findMathAttribute(element: Element): string {
  const attributes = [
    "data-tex",
    "data-latex",
    "data-math",
    "data-formula",
    "data-expression",
    "data-original-tex",
    "copy-text",
    "data-clipboard-text",
  ];
  const nodes = [element, ...Array.from(element.querySelectorAll("*"))];

  for (const node of nodes) {
    for (const attribute of attributes) {
      const value = node.getAttribute(attribute);
      if (value && looksLikeMathExpression(value)) {
        return value;
      }
    }
  }

  return "";
}

function findMathMlExpression(element: Element): string {
  const math = element.matches("math") ? element : element.querySelector("math");
  return math ? mathMlToLatex(math) : "";
}

function findReadableMathText(element: Element): string {
  const text = Array.from(element.querySelectorAll<HTMLElement>(".katex-mathml, mjx-assistive-mml, math"))
    .map((node) => node.textContent ?? "")
    .find((value) => looksLikeMathExpression(value));

  return text ?? "";
}

function mathFallbackText(element: Element, display: boolean): string {
  const text = cleanupMathExpression(findReadableMathText(element) || element.textContent || "");
  if (!text) {
    return display ? "\n\n[公式无法识别]\n\n" : "[公式无法识别]";
  }

  return display ? `\n\n${text}\n\n` : text;
}

function looksLikeMathExpression(value: string): boolean {
  const text = value.trim();
  return text.length > 0 && text.length < 3000 && /[\\^_{}=<>+\-*/∑∏√≤≥≈≠∞α-ωΑ-Ω]/.test(text);
}

function selectBestMathExpression(candidates: string[]): string {
  return candidates
    .filter((candidate) => candidate && looksLikeMathExpression(candidate))
    .sort((left, right) => mathExpressionScore(right) - mathExpressionScore(left))[0] ?? "";
}

function mathExpressionScore(expression: string): number {
  let score = 0;

  if (/\\(?:frac|sqrt|sum|prod|left|right|begin|end|odot|times|cdot|ldots)/.test(expression)) {
    score += 120;
  }

  if (/[_^{}]/.test(expression)) {
    score += 80;
  }

  if (/\\[a-zA-Z]+/.test(expression)) {
    score += 60;
  }

  if (/[=<>+\-*/∈≤≥≈≠⊙×·]/.test(expression)) {
    score += 30;
  }

  if (/[\u4e00-\u9fff]/.test(expression)) {
    score -= 200;
  }

  score -= Math.max(0, expression.length - 500);
  return score;
}

function mathMlToLatex(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (!(node instanceof Element)) {
    return "";
  }

  const children = Array.from(node.childNodes).map(mathMlToLatex).filter(Boolean);
  const name = node.localName.toLowerCase();

  switch (name) {
    case "math":
    case "semantics":
    case "mrow":
    case "mstyle":
    case "mpadded":
    case "menclose":
      return joinMathParts(children);
    case "mi":
    case "mn":
      return node.textContent ?? "";
    case "mo":
      return mapMathOperator(node.textContent ?? "");
    case "mtext":
      return `\\text{${node.textContent ?? ""}}`;
    case "msub":
      return `${children[0] ?? ""}_{${children[1] ?? ""}}`;
    case "msup":
      return `${children[0] ?? ""}^{${children[1] ?? ""}}`;
    case "msubsup":
      return `${children[0] ?? ""}_{${children[1] ?? ""}}^{${children[2] ?? ""}}`;
    case "mfrac":
      return `\\frac{${children[0] ?? ""}}{${children[1] ?? ""}}`;
    case "msqrt":
      return `\\sqrt{${joinMathParts(children)}}`;
    case "mroot":
      return `\\sqrt[${children[1] ?? ""}]{${children[0] ?? ""}}`;
    case "mover":
      return `\\overset{${children[1] ?? ""}}{${children[0] ?? ""}}`;
    case "munder":
      return `\\underset{${children[1] ?? ""}}{${children[0] ?? ""}}`;
    case "munderover":
      return `\\overset{${children[2] ?? ""}}{\\underset{${children[1] ?? ""}}{${children[0] ?? ""}}}`;
    case "mfenced":
      return `\\left(${joinMathParts(children)}\\right)`;
    case "mtable":
      return `\\begin{matrix}${children.join("\\\\")}\\end{matrix}`;
    case "mtr":
      return children.join(" & ");
    case "mtd":
      return joinMathParts(children);
    case "annotation":
      return "";
    default:
      return joinMathParts(children) || node.textContent || "";
  }
}

function joinMathParts(parts: string[]): string {
  return parts.join("").replace(/\s+/g, " ").trim();
}

function mapMathOperator(operator: string): string {
  const normalized = operator.trim();
  const operators: Record<string, string> = {
    "×": "\\times",
    "·": "\\cdot",
    "÷": "\\div",
    "≤": "\\le",
    "≥": "\\ge",
    "≠": "\\ne",
    "≈": "\\approx",
    "∞": "\\infty",
    "⊤": "^T",
    "∑": "\\sum",
    "∏": "\\prod",
    "√": "\\sqrt",
    "→": "\\to",
    "←": "\\leftarrow",
    "∈": "\\in",
  };

  return operators[normalized] ?? normalized;
}

function decodeHtmlEntities(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}
