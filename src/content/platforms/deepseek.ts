import { scanGenericAiAnswers } from "./shared";
import type { AiPlatformAdapter, AiPlatformContext } from "./types";

export const deepseekAdapter: AiPlatformAdapter = {
  name: "DeepSeek",
  matches(hostname) {
    return hostname === "chat.deepseek.com" || hostname.endsWith(".deepseek.com");
  },
  scan(context: AiPlatformContext) {
    scanGenericAiAnswers(context, {
      platformName: "DeepSeek",
      selectors: [
        "[class*='ds-markdown']",
        "[class*='markdown']",
        "[class*='prose']",
        "[class*='assistant']",
        "[class*='answer']",
        "[class*='response']",
      ],
      answerHints: ["ds-markdown"],
    });
  },
};
