import { scanGenericAiAnswers } from "./shared";
import type { AiPlatformAdapter, AiPlatformContext } from "./types";

export const kimiAdapter: AiPlatformAdapter = {
  name: "Kimi",
  matches(hostname) {
    return hostname === "kimi.moonshot.cn" || hostname.endsWith(".moonshot.cn");
  },
  scan(context: AiPlatformContext) {
    scanGenericAiAnswers(context, {
      platformName: "Kimi",
      selectors: [
        "[class*='markdown']",
        "[class*='prose']",
        "[class*='assistant']",
        "[class*='answer']",
        "[class*='response']",
        "[class*='message']",
      ],
      answerHints: ["segment", "chat"],
    });
  },
};
