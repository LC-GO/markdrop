# Markdrop 产品需求文档（PRD）

> 版本：v0.3 | 状态：开发中 | 用途：交付 Claude Code / Codex 开发

---

## 一、产品概述

**Markdrop** 是一款浏览器扩展插件，允许用户在任意网页（尤其是 AI 对话平台）上，通过划词或点击按钮，将内容以 Markdown 格式一键保存到 Notion、Obsidian、飞书等笔记平台。

- **定位**：轻量级、全网通用的 Markdown 内容剪藏工具
- **目标用户**：重度使用 AI 工具、有笔记整理习惯的用户（开发者、研究者、学生、创作者）
- **商业模式**：免费开源（MIT 协议），挂载于开发者工作室主页
- **服务端**：无。插件为纯客户端工具，所有数据存储在用户本地，开发者无需维护任何服务器

---

## 二、核心功能

### 2.1 划词保存（核心，通用）

- 用户在任意网页选中文字后，出现浮动工具栏或右键菜单，显示「Save to Markdrop」选项
- 点击后将选中内容转为 Markdown 格式，保存至用户配置的笔记平台
- 适用范围：所有网页，不限于 AI 平台

### 2.2 AI 平台一键保存按钮（核心体验）

- 在以下 AI 平台的每条回答旁，自动注入「Save」按钮：
  - ChatGPT（chat.openai.com）
  - Claude（claude.ai）
  - Gemini（gemini.google.com）
  - DeepSeek（chat.deepseek.com）
  - Doubao（doubao.com）
  - Qianwen（qianwen.com）
  - 可扩展支持更多平台
- 点击按钮，将该条完整回答转为 Markdown，打开保存面板，用户选择常用存储目录后保存至笔记平台
- 按钮样式轻量，不干扰原平台 UI

### 2.3 Markdown 转换

- 将网页 HTML 内容转换为标准 Markdown 格式
- 保留以下格式：
  - 标题层级（H1-H6）
  - 代码块（含语言标注）
  - 有序 / 无序列表
  - 加粗、斜体、行内代码
  - 表格
  - 链接
- 推荐使用 Turndown 库实现 HTML → Markdown 转换

### 2.4 笔记平台对接

所有平台均采用**用户自持 Token** 方式对接，无需任何服务端中转。用户在各平台自行申请 Token 后填入插件设置即可使用。

#### 阶段一：Notion（MVP）

**授权方式**：Notion Internal Integration Token

**用户配置步骤**：
1. 前往 notion.so/my-integrations 创建内部集成
2. 复制生成的 Token，粘贴至插件设置
3. 在 Notion 中将目标 Page / Data Source / Database 共享给该集成

**保存行为**：
- 用户在插件设置中维护多个常用存储目录，每个目录对应一个 Notion Page / Data Source / Database
- 每次保存时弹出保存面板，用户选择本次要保存到哪个常用存储目录
- 每次保存在目标位置创建新 Page
- 页面标题默认为：[来源页面标题] - [日期]
- 页面顶部附加来源 URL（可在设置中关闭）
- 内容以 Markdown 解析后写入 Notion Block

#### 阶段二：Obsidian

**授权方式**：Obsidian Local REST API 插件的 API Key

**用户配置步骤**：
1. 在 Obsidian 社区插件中安装 Local REST API
2. 启用插件，复制 API Key，粘贴至 Markdrop 设置
3. 配置本地服务端口（默认 27123）和目标文件夹路径

**保存行为**：
- 在指定 Vault 文件夹中创建新 .md 文件
- 文件名默认为：[来源页面标题]-[日期].md
- 文件顶部以 YAML frontmatter 记录来源 URL 和保存时间

#### 阶段三：飞书

**授权方式**：飞书自建应用 User Access Token

**用户配置步骤**：
1. 在飞书开放平台创建自建应用，获取 App ID 和 App Secret
2. 填入 Markdrop 设置，插件在本地完成授权换取 Token
3. 选择目标知识库或文件夹

**保存行为**：
- 在指定知识库或文件夹中创建新文档
- 内容转换为飞书文档格式写入

---

## 三、用户配置

插件提供设置页面（Options Page），主要用于管理常用存储目录。保存动作触发后，插件会打开保存面板，用户可在本次保存时选择目标目录。

- **笔记平台连接**：Notion / Obsidian / 飞书（阶段一仅实现 Notion）
- **各平台 Token 填写**：阶段一为 Notion Internal Integration Token
- **常用存储目录**：用户可添加多个目录，例如「AI 摘录」「学习资料」「项目调研」「临时收集」
- **目录检测**：用户可检测 Notion Token 与目标 ID 是否可访问
- **默认目录**：用户可设置默认目录，但保存时仍可切换
- **保存触发方式**：划词浮动按钮 / 右键菜单 / AI 平台注入按钮（各自开关）
- **文档标题格式**：自定义（默认：[来源页面标题] - [日期]）
- **是否附加来源 URL**：开关，默认开启

---

## 四、技术架构

### 4.1 技术栈

| 模块 | 技术选型 |
|------|----------|
| 插件框架 | WebExtensions API（兼容 Chrome / Edge / Firefox） |
| Manifest 版本 | Manifest V3 |
| HTML → Markdown | Turndown.js |
| Notion 对接 | Notion API（官方）+ Internal Integration Token |
| Obsidian 对接 | Local REST API 插件 |
| 飞书对接 | 飞书开放平台 API |
| 数据存储 | chrome.storage.local（Token 和配置全部本地存储） |
| 构建工具 | esbuild（第一版轻量构建；后续可迁移 Vite + CRXJS 或 WXT） |
| 服务端 | 无 |

### 4.2 插件结构

```
markdrop/
├── manifest.json
├── background/
│   └── service-worker.js       # 处理 API 调用
├── content/
│   ├── content-script.js       # 注入浮动按钮、AI 平台适配
│   └── platforms/
│       ├── chatgpt.js
│       ├── claude.js
│       ├── doubao.js
│       ├── deepseek.js
│       ├── tongyi.js
│       └── gemini.js
├── popup/
│   └── popup.html              # 点击插件图标的快捷面板
├── options/
│   └── options.html            # 设置页面
├── utils/
│   ├── markdown.js             # HTML → Markdown 转换
│   ├── notion.js               # Notion API 封装
│   ├── obsidian.js             # Obsidian API 封装
│   └── feishu.js               # 飞书 API 封装
└── assets/
    └── icons/                  # 128x128 / 48x48 / 16x16
```

### 4.3 数据流

```
用户触发（划词 / 点击按钮）
    ↓
content-script 获取内容（window.getSelection 或 DOM 读取）
    ↓
Turndown 转换为 Markdown
    ↓
打开保存面板，用户选择常用存储目录、确认标题
    ↓
background service-worker 读取本地存储的 Token 和目录配置
    ↓
直接调用目标平台 API（Notion / Obsidian / 飞书）
    ↓
创建新文档，返回成功提示
```

### 4.4 隐私与安全说明

- 用户 Token 存储在 chrome.storage.local，仅在用户本地，不经过任何第三方服务器
- 插件不收集用户内容、不追踪用户行为
- 所有 API 请求由用户浏览器直接发出，目标为各笔记平台官方接口
- 开发者无法访问任何用户数据

---

## 五、MVP 范围（第一版）

第一版只交付以下功能，其余进入 Backlog：

- [x] 划词保存（浮动按钮 + 右键菜单）
- [x] AI 平台回答保存按钮（ChatGPT / Claude / Gemini / DeepSeek / Doubao / Qianwen）
- [x] 保存面板（选择常用存储目录 + 修改标题 + 附加来源 URL）
- [x] Notion 对接（Internal Integration Token + 常用目录 + 创建页面）
- [x] HTML → Markdown 转换（基础格式）
- [x] 保存时附加来源 URL
- [x] 设置页面（Token 填写 + 常用存储目录配置 + 目录检测）
- [x] 保存成功 / 失败提示

**暂不包含（Backlog）：**
- Obsidian 对接
- 飞书对接
- Firefox 适配
- 多语言支持

---

## 六、浏览器兼容性

| 浏览器 | 阶段 | 说明 |
|--------|------|------|
| Chrome | 阶段一 | 主要目标，上架 Chrome Web Store |
| Edge | 阶段一 | 与 Chrome 同一代码，同步发布 |
| Firefox | 阶段二 | 少量 API 适配后发布至 AMO |
| Safari | 暂不支持 | 开发成本过高 |

---

## 七、开源信息

- **协议**：MIT License
- **仓库命名建议**：markdrop 或 markdrop-extension
- **主页**：挂载于开发者工作室现有域名子页面
- **Chrome 商店**：上架前需准备隐私政策页面、商店截图、插件图标
- **维护说明**：开发者不承诺持续维护，欢迎社区 PR 贡献平台适配和功能扩展

---

## 八、非功能性要求

- 插件体积尽量小，不引入不必要的依赖
- 所有用户数据（Token、配置）存储在本地，不上传至任何服务器
- 隐私政策明确声明：不收集用户内容、不追踪用户行为
- 代码注释清晰，方便社区贡献

---

## 九、后续迭代方向（供参考）

- 支持 Obsidian、飞书平台
- 支持保存时添加自定义标签 / 备注
- Popup 面板显示最近保存记录
- 支持图片剪藏
- 支持 Firefox

---

*文档由 Claude 辅助整理，基于产品讨论记录生成。v0.3 更新：AI 平台回答保存按钮进入第一版核心范围；设置页明确为管理常用存储目录，保存时选择本次目标目录。*
