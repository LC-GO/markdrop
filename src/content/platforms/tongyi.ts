import { scanGenericAiAnswers } from "./shared";
import type { AiPlatformAdapter, AiPlatformContext } from "./types";

export const tongyiAdapter: AiPlatformAdapter = {
  name: "Qianwen",
  matches(hostname) {
    return (
      hostname === "tongyi.aliyun.com" ||
      hostname.endsWith(".tongyi.aliyun.com") ||
      hostname === "qianwen.aliyun.com" ||
      hostname.endsWith(".qianwen.aliyun.com") ||
      hostname === "qianwen.com" ||
      hostname.endsWith(".qianwen.com")
    );
  },
  scan(context: AiPlatformContext) {
    scanGenericAiAnswers(context, {
      platformName: "Qianwen",
      selectors: [
        "[class*='markdown']",
        "[class*='prose']",
        "[class*='assistant']",
        "[class*='answer']",
        "[class*='response']",
        "[class*='message']",
      ],
      answerHints: ["tongyi", "qianwen"],
    });
  },
};
