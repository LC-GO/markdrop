import type { CapturedContent } from "../../utils/types";

export interface AiPlatformAdapter {
  name: string;
  matches(hostname: string): boolean;
  scan(context: AiPlatformContext): void;
}

export interface AiPlatformContext {
  captureAnswer(element: HTMLElement, platformName: string): CapturedContent;
  openSavePanel(content: CapturedContent): void;
}
