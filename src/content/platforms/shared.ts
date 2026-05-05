import { injectSaveButton } from "./inject";
import type { AiPlatformContext } from "./types";

interface GenericAdapterOptions {
  platformName: string;
  selectors: string[];
  userHints?: string[];
  answerHints?: string[];
}

const DEFAULT_USER_HINTS = ["user", "human", "question", "query", "mine", "self", "composer", "input", "prompt"];
const DEFAULT_ANSWER_HINTS = [
  "assistant",
  "bot",
  "answer",
  "response",
  "model",
  "markdown",
  "prose",
  "message",
  "chat",
  "reply",
];

export function scanGenericAiAnswers(context: AiPlatformContext, options: GenericAdapterOptions): void {
  injectAfterThinkingBlocks(context, options);

  collectGenericAnswerNodes(options).forEach((node) => {
    if (!looksLikeAnswer(node, options)) {
      return;
    }

    injectSaveButton(node, options.platformName, context, node);
  });
}

function injectAfterThinkingBlocks(context: AiPlatformContext, options: GenericAdapterOptions): void {
  findThinkingBlocks().forEach((thinkingBlock) => {
    const finalAnswer = findVisibleFinalAnswerAfter(thinkingBlock);
    if (!finalAnswer) {
      return;
    }

    injectSaveButton(finalAnswer, options.platformName, context, finalAnswer);
  });
}

function findThinkingBlocks(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((node) => {
    if (isInsideComposer(node)) {
      return false;
    }

    const text = (node.textContent ?? "").trim();
    if (!text || text.length > 300) {
      return false;
    }

    if (!isThinkingText(text)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function findVisibleFinalAnswerAfter(thinkingBlock: HTMLElement): HTMLElement | null {
  const thinkingRect = thinkingBlock.getBoundingClientRect();
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3, p")).filter((node) => {
    if (node === thinkingBlock || isInsideComposer(node) || isLikelyUserMessage(node) || isThinkingText(node.textContent ?? "")) {
      return false;
    }

    const text = (node.textContent ?? "").trim();
    if (text.length < 6) {
      return false;
    }

    const position = thinkingBlock.compareDocumentPosition(node);
    if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const verticalDistance = rect.top - thinkingRect.bottom;
    return verticalDistance > -12 && verticalDistance < 1000;
  });

  const heading = candidates.find((node) => node.matches("h1, h2, h3"));
  const seed = heading ?? candidates[0];
  return seed ? expandAnswerContainer(seed) : null;
}

function collectGenericAnswerNodes(options: GenericAdapterOptions): HTMLElement[] {
  const found: HTMLElement[] = [];

  document.querySelectorAll<HTMLElement>(options.selectors.join(", ")).forEach((node) => {
    if (isInsideComposer(node) || isLikelyUserMessage(node, options.userHints)) {
      return;
    }

    const answer = findBestAnswerElement(node);
    if (
      answer &&
      !isInsideComposer(answer) &&
      !isLikelyUserMessage(answer, options.userHints) &&
      !hasThinkingMarkerNearby(answer)
    ) {
      found.push(answer);
    }
  });

  return chooseOneAnswerPerMessage(found);
}

function findBestAnswerElement(node: HTMLElement): HTMLElement | null {
  const followingFinalAnswer = chooseFollowingFinalAnswer(node);
  if (followingFinalAnswer) {
    return followingFinalAnswer;
  }

  const directMarkdown = chooseFinalAnswerBlock(node);
  if (directMarkdown) {
    return directMarkdown;
  }

  const message = node.closest<HTMLElement>(
    [
      "[data-message-id]",
      "[data-testid*='message']",
      "[data-role*='assistant']",
      "[class*='assistant']",
      "[class*='answer']",
      "[class*='response']",
      "[class*='message']",
      "article",
    ].join(", "),
  );

  return message ?? node;
}

function chooseFinalAnswerBlock(node: HTMLElement): HTMLElement | null {
  const followingFinalAnswer = chooseFollowingFinalAnswer(node);
  if (followingFinalAnswer) {
    return followingFinalAnswer;
  }

  const finalContainer = chooseFinalContainerFromHeadings(node);
  if (finalContainer) {
    return finalContainer;
  }

  const candidates = [
    ...(node.matches(markdownSelector()) ? [node] : []),
    ...Array.from(node.querySelectorAll<HTMLElement>(markdownSelector())),
  ].filter((candidate) => !isThinkingBlock(candidate) && !isInsideThinkingRegion(candidate) && !isInsideComposer(candidate));

  if (candidates.length) {
    return candidates[candidates.length - 1];
  }

  if (!isThinkingBlock(node) && !isInsideThinkingRegion(node) && node.matches(contentBlockSelector())) {
    return node;
  }

  const contentBlocks = Array.from(node.querySelectorAll<HTMLElement>(contentBlockSelector())).filter(
    (candidate) => !isThinkingBlock(candidate) && !isInsideThinkingRegion(candidate) && !isInsideComposer(candidate),
  );

  return contentBlocks[contentBlocks.length - 1] ?? null;
}

function chooseFinalContainerFromHeadings(node: HTMLElement): HTMLElement | null {
  const headings = Array.from(node.querySelectorAll<HTMLElement>("h1, h2, h3")).filter(
    (heading) => !isInsideThinkingRegion(heading) && !isInsideComposer(heading),
  );

  if (!headings.length) {
    return null;
  }

  return expandAnswerContainer(headings[0]);
}

function chooseFollowingFinalAnswer(node: HTMLElement): HTMLElement | null {
  if (!hasThinkingMarkerNearby(node)) {
    return null;
  }

  const nodeRect = node.getBoundingClientRect();
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3")).filter((heading) => {
    if (isInsideComposer(heading) || isLikelyUserMessage(heading) || isInsideThinkingRegion(heading)) {
      return false;
    }

    if (isThinkingText(heading.textContent ?? "")) {
      return false;
    }

    const position = node.compareDocumentPosition(heading);
    if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) {
      return false;
    }

    const headingRect = heading.getBoundingClientRect();
    if (nodeRect.width > 0 || nodeRect.height > 0) {
      const verticalDistance = headingRect.top - nodeRect.bottom;
      if (verticalDistance < -8 || verticalDistance > 900) {
        return false;
      }
    }

    return true;
  });

  const heading = headings[0];
  return heading ? expandAnswerContainer(heading) : null;
}

function hasThinkingMarkerNearby(node: HTMLElement): boolean {
  let current: HTMLElement | null = node;
  let depth = 0;

  while (current && current !== document.body && depth < 8) {
    if (containsThinkingMarker(current)) {
      return true;
    }

    let previous = current.previousElementSibling as HTMLElement | null;
    let previousCount = 0;
    while (previous && previousCount < 4) {
      if (containsThinkingMarker(previous)) {
        return true;
      }
      previous = previous.previousElementSibling as HTMLElement | null;
      previousCount += 1;
    }

    current = current.parentElement;
    depth += 1;
  }

  return false;
}

function expandAnswerContainer(seed: HTMLElement): HTMLElement {
  let current = seed;
  let parent = current.parentElement;

  while (parent && parent !== document.body && !isMessageRoot(parent)) {
    if (containsThinkingMarker(parent) || isLikelyUserMessage(parent)) {
      break;
    }

    if (!parent.contains(seed)) {
      break;
    }

    current = parent;
    parent = parent.parentElement;
  }

  return current;
}

function looksLikeAnswer(node: HTMLElement, options: GenericAdapterOptions): boolean {
  const text = node.textContent?.trim() ?? "";
  if (text.length < 8) {
    return false;
  }

  if (
    isInsideComposer(node) ||
    isLikelyUserMessage(node, options.userHints) ||
    isThinkingBlock(node) ||
    isInsideThinkingRegion(node)
  ) {
    return false;
  }

  const hasContentShape =
    Boolean(node.querySelector("p, pre, code, ol, ul, table, h1, h2, h3")) ||
    node.matches("p, pre, code, ol, ul, table, h1, h2, h3") ||
    node.matches(markdownSelector());

  if (!hasContentShape) {
    return false;
  }

  const label = elementLabel(node);
  const answerHints = [...DEFAULT_ANSWER_HINTS, ...(options.answerHints ?? [])];
  return answerHints.some((hint) => label.includes(hint)) || node.matches(markdownSelector()) || !isInsideThinkingRegion(node);
}

function isThinkingBlock(node: HTMLElement): boolean {
  const text = (node.textContent ?? "").trim().slice(0, 80).toLowerCase();
  const label = elementLabel(node);

  return (
    text.includes("已思考") ||
    text.includes("思考") ||
    text.includes("用时") ||
    text.includes("thought") ||
    text.includes("thinking") ||
    text.includes("reasoning") ||
    label.includes("thought") ||
    label.includes("thinking") ||
    label.includes("reasoning")
  );
}

function isInsideThinkingRegion(node: HTMLElement): boolean {
  if (isThinkingBlock(node)) {
    return true;
  }

  const root = findMessageRoot(node);
  let current: HTMLElement | null = node;

  while (current && current !== root && current !== document.body) {
    if (containsThinkingMarker(current) && !containsFinalAnswerMarker(current)) {
      return true;
    }

    const previous = current.previousElementSibling as HTMLElement | null;
    const previousText = previous?.textContent?.trim() ?? "";
    if (previous && isThinkingText(previousText) && previousText.length < 120) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function containsThinkingMarker(node: HTMLElement): boolean {
  const text = (node.textContent ?? "").trim().slice(0, 160).toLowerCase();
  const label = elementLabel(node);

  return (
    isThinkingText(text) ||
    label.includes("thought") ||
    label.includes("thinking") ||
    label.includes("reasoning")
  );
}

function containsFinalAnswerMarker(node: HTMLElement): boolean {
  return Boolean(node.querySelector("h1, h2, h3")) && !isThinkingText((node.textContent ?? "").trim().slice(0, 80));
}

function isThinkingText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("已思考") ||
    normalized.includes("思考") ||
    normalized.includes("用时") ||
    normalized.includes("thought") ||
    normalized.includes("thinking") ||
    normalized.includes("reasoning")
  );
}

function isLikelyUserMessage(node: HTMLElement, extraHints: string[] = []): boolean {
  const roleNode = node.closest<HTMLElement>("[data-message-author-role], [data-role], [role]");
  const role = [
    roleNode?.getAttribute("data-message-author-role"),
    roleNode?.getAttribute("data-role"),
    roleNode?.getAttribute("role"),
  ]
    .join(" ")
    .toLowerCase();

  if (role.includes("user") || role.includes("human")) {
    return true;
  }

  const label = elementLabel(node);
  return [...DEFAULT_USER_HINTS, ...extraHints].some((hint) => label.includes(hint));
}

function isInsideComposer(node: HTMLElement): boolean {
  return Boolean(
    node.closest(
      [
        "form",
        "textarea",
        "input",
        "[contenteditable='true']",
        "[data-testid*='composer']",
        "[data-testid*='input']",
        "[class*='composer']",
        "[class*='input']",
        "[class*='editor']",
      ].join(", "),
    ),
  );
}

function elementLabel(node: HTMLElement): string {
  return [
    node.getAttribute("data-testid"),
    node.getAttribute("data-role"),
    node.getAttribute("aria-label"),
    node.getAttribute("role"),
    node.className.toString(),
    node.id,
    node.closest<HTMLElement>("[data-testid]")?.getAttribute("data-testid"),
    node.closest<HTMLElement>("[data-role]")?.getAttribute("data-role"),
  ]
    .join(" ")
    .toLowerCase();
}

function chooseOneAnswerPerMessage(nodes: HTMLElement[]): HTMLElement[] {
  const byMessage = new Map<HTMLElement, HTMLElement>();

  nodes.forEach((node) => {
    if (isInsideThinkingRegion(node)) {
      return;
    }

    const root = findMessageRoot(node);
    const existing = byMessage.get(root);
    if (!existing || isBetterAnswerCandidate(existing, node)) {
      byMessage.set(root, node);
    }
  });

  return [...byMessage.values()];
}

function isBetterAnswerCandidate(current: HTMLElement, next: HTMLElement): boolean {
  const currentScore = answerCandidateScore(current);
  const nextScore = answerCandidateScore(next);

  if (nextScore !== currentScore) {
    return nextScore > currentScore;
  }

  return Boolean(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function answerCandidateScore(node: HTMLElement): number {
  let score = 0;

  if (!isInsideThinkingRegion(node)) {
    score += 1000;
  }

  if (node.querySelector("h1, h2, h3") || node.matches("h1, h2, h3")) {
    score += 400;
  }

  if (node.matches(markdownSelector())) {
    score += 120;
  }

  score += Math.min((node.textContent?.trim().length ?? 0) / 20, 120);
  return score;
}

function findMessageRoot(node: HTMLElement): HTMLElement {
  return (
    node.closest<HTMLElement>(
      [
        "[data-message-id]",
        "[data-testid*='message']",
        "[data-role*='assistant']",
        "[class*='assistant']",
        "[class*='answer']",
        "[class*='response']",
        "[class*='message']",
        "article",
      ].join(", "),
    ) ?? node
  );
}

function isMessageRoot(node: HTMLElement): boolean {
  return findMessageRoot(node) === node;
}

function markdownSelector(): string {
  return [
    '[data-testid="markdown"]',
    "[class*='markdown']",
    "[class*='prose']",
    "[class*='rich-text']",
    "[class*='md-content']",
    "[class*='md-content']",
  ].join(", ");
}

function contentBlockSelector(): string {
  return "p, pre, code, ol, ul, table, h1, h2, h3";
}
