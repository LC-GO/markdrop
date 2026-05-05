# 发布清单

在分享构建产物、发布版本或公开仓库前使用这份清单。

## 源码卫生

- 确认没有提交真实的 Notion、Feishu 或 Obsidian 凭据。
- 确认 `.gitignore` 排除了 `node_modules/`、`dist/`、本地备份、日志和 `.env` 文件。
- 确认 `README.md` 能把中文和英文用户导向完整说明。
- 确认 `README.zh-CN.md` 和 `README.en.md` 能从全新安装讲清三平台配置。
- 确认 `docs/SECURITY_AND_PRIVACY.md` 和英文版说明了权限和数据流。
- 确认 `docs/TESTING.md` 已针对最新捕获/保存改动跑过。

## 版本

- 更新 `public/manifest.json` 版本号。
- 更新 `package.json` 版本号。
- 更新 `package-lock.json` 版本号。
- 产品行为变化时，更新 `MARKDROP_BUILD_ID`。

## 构建

```bash
npm run typecheck
npm run build
```

然后在 Chrome 或 Edge 重新加载 `dist/` 并做一次冒烟测试：

- 打开配置页。
- 验证至少一个保存位置。
- 保存一条完整 AI 回答。
- 保存一次划词内容。
- 确认保存结果能在目标应用中打开。

## 打包

- 从干净工作区构建。
- 只打包浏览器需要的扩展输出。
- 不包含本地浏览器存储、含密钥截图或临时笔记。

