# Markdrop

Markdrop 是一个本地优先的浏览器扩展，用来把普通网页划词内容和 AI 回答（支持划词和整篇）保存为结构化笔记。

目前支持：

- Notion 页面和 Data Source
- Feishu 云文档文件夹和 Feishu Wiki 目录（知识库）
- Obsidian Vault 文件夹，通过 Obsidian Local REST API 插件写入 Markdown 文件

Markdrop 不提供后端服务。Token、密钥和保存位置配置只保存在当前浏览器的扩展本地存储中。

## 功能

- 保存普通网页划词内容。
- 通过浏览器右键菜单保存。
- 在支持的 AI 平台回答下方注入独立 `Save` 按钮。
- 尽量保留 Markdown 结构：标题、段落、列表、表格、引用、代码块、任务列表、公式、链接和行内代码。
- Notion、Feishu、Obsidian 保存位置互相隔离，同名位置会在保存弹窗里显示平台前缀。
- 配置多个保存位置，并在保存时选择目标。
- 产品 UI 支持 `Auto / 中文 / English`，默认跟随浏览器语言。

支持的 AI 平台包括 ChatGPT、Claude、DeepSeek、豆包、Gemini、Kimi、千问/通义。

## 使用方式

- 选中文本后使用浏览器右键菜单 `Save to Markdrop`。
- 在支持的 AI 平台中，点击具体回答下方的 `Save` 按钮完成整篇回答保存或使用划词保存。

保存弹窗中可以编辑标题、选择目标、决定是否附带来源 URL，并预览捕获到的 Markdown。

## 安装方式一：下载 Release 包，推荐普通用户

如果你只是想安装使用 Markdrop，推荐从 GitHub Releases 下载打包好的扩展包。

1. 下载最新的 `markdrop-*.zip`。
2. 解压到本地文件夹。
3. 打开 `chrome://extensions` 或 `edge://extensions`。
4. 开启开发者模式。
5. 点击 `加载已解压的扩展程序` / `Load unpacked`。
6. 选择刚才解压出来的扩展文件夹。

这种方式不需要安装 Node.js，也不需要运行 npm 命令。

## 安装方式二：从源码构建，适合开发者

如果你想修改代码、调试功能，或者自己从源码打包扩展，请在项目目录运行：

```bash
npm install
npm run typecheck
npm run build
```

构建后的浏览器扩展位于 `dist/`。

然后在 Chrome 或 Edge 中加载：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启开发者模式。
3. 点击 `加载已解压的扩展程序` / `Load unpacked`。
4. 选择 `dist/` 文件夹。

每次重新构建后，需要在浏览器扩展管理页重新加载该扩展。

## 打开配置页

在浏览器扩展详情页点击 `Extension options`，或打开 Markdrop 弹窗后进入设置。

配置页按平台分为三块：

- `Notion`：Internal Integration Token 和 Notion 保存位置。
- `Feishu`：自建应用凭据、OAuth 登录和 Feishu 保存位置。
- `Obsidian`：Local REST API URL/API Key 和 Vault 文件夹保存位置。

带 `*` 的字段为必填项。

## 配置 Notion

1. 打开 [Notion integrations](https://www.notion.so/my-integrations)。
2. 创建 internal integration。
3. 复制 `Internal Integration Token` 到 Markdrop。
4. 打开目标 Notion 页面或 Data Source。
5. 在 Notion 中把该页面或 Data Source 连接/授权给这个 integration。普通成员分享框不一定等同于 integration 授权。
6. 在 Markdrop 添加 Notion 保存位置：
   - 保存位置名称：只用于 Markdrop 保存弹窗中区分目标。
   - 类型：`Page` 或 `Data Source`。
   - Notion URL 或 ID：直接粘贴页面/Data Source 链接。
   - 标题字段：只有当 Data Source 的标题字段不叫 `Name` 时才需要修改。
7. 点击 `验证`。

### Notion Data Source / Database 说明

如果要保存到 Notion 数据库：

1. 在 Notion 中新建一个表格数据库，推荐使用 Full page database。
2. 打开该数据库页面右上角 `...` → `连接 / Connections`，添加你的 Notion integration，例如 `Markdrop`。
3. 在 Markdrop 中添加 Notion 保存位置：
   - 类型选择 `Data Source / Database`。
   - `Notion URL 或 ID` 可以直接粘贴数据库页面地址栏链接；Markdrop 会自动解析该数据库下的 Data Source。
   - `标题字段` 必须与数据库的标题列名称一致。中文 Notion 默认可能是 `名称`，英文 Notion 通常是 `Name`。
4. 点击 `验证`，通过后即可保存。

如果验证提示找不到 database/data source，优先检查该数据库页面是否已经在 `连接 / Connections` 中添加了你的 integration；普通成员分享框不一定等同于 integration 授权。

## 配置 Feishu

Feishu 使用自建应用。开源使用时，每个用户需要创建并配置自己的应用。

1. 在 [Feishu Open Platform](https://open.feishu.cn/) 创建自建应用。
2. 在应用的“凭证与基础信息”中复制 `App ID` 和 `App Secret`，填入 Markdrop。
3. 从 Markdrop 配置页复制 `OAuth 回调地址`。
4. 在 Feishu 应用的“安全设置 / 重定向 URL”中添加该回调地址。
5. 在 Feishu 应用的“权限管理”中导入并申请权限：
   - 进入“批量导入/导出权限”。
   - 选择“导入”。
   - 粘贴下面的 JSON。

```json
{
  "scopes": {
    "tenant": [
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive",
      "wiki:wiki"
    ],
    "user": [
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive",
      "offline_access",
      "wiki:wiki"
    ]
  }
}
```

权限用途：

- `tenant` 组：用于应用访问云文档文件夹、Wiki 目录，以及创建/读写文档。
- `user` 组：用于用户 OAuth 授权后，以当前用户身份创建、写入和转换文档。
- `offline_access`：用于获取 refresh token，让 Feishu 登录状态可刷新。
- `docx:document:create`：在目标位置新建飞书文档。
- `docx:document:readonly`：验证和读取文档基础信息。
- `docx:document:write_only`：向文档写入段落、标题、代码块、公式等内容块。
- `docx:document.block:convert`：把 Markdown、表格等内容转换为飞书原生文档块。
- `drive:drive`：保存到云文档文件夹时访问文件夹和文件。
- `wiki:wiki`：保存到已有知识库目录时访问 Wiki 节点。

如果控制台提示某个 scope 不存在，请以 Feishu 控制台提示为准移除该项后再导入；但不要漏掉 `docx:document.block:convert`，否则表格等内容会退化为纯文本或代码块。

6. 按租户要求提交审批、发布或启用应用。
7. 回到 Markdrop 点击 `使用 Feishu 登录` 并授权。如果刚刚新增过权限，需要先退出登录再重新授权。
8. 添加 Feishu 保存位置：
   - 云文档文件夹：粘贴文件夹链接或 folder token。
   - Wiki 目录：粘贴已有 Wiki 目录/页面链接或 node token。Markdrop 会在该目录下新建文档，不会创建新的知识库。

常用权限见 [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md)。

## 配置 Obsidian

Obsidian 通过社区插件 `Local REST API` 写入 Markdown 文件。

1. 在 Obsidian 中安装并启用 `Local REST API` 插件。
2. 从插件设置复制 API Key。
3. 如果 HTTPS 地址能在浏览器打开，但扩展请求失败，可开启插件的非加密 HTTP 服务，并使用 `http://127.0.0.1:27123`。
4. 在 Markdrop 填写：
   - Local REST API URL
   - API Key
   - Vault 名称，可选，只用于通过 `obsidian://` 链接打开保存结果
5. 添加 Obsidian 保存位置：
   - 保存位置名称：只用于保存弹窗中区分目标。
   - Vault 文件夹路径：例如 `AI摘录`；使用 `/` 或 `.` 表示 Vault 根目录。

## 测试、安全和发布

- 修改捕获或保存逻辑后，请运行 [测试清单](docs/TESTING.md)。
- 数据流和权限说明见 [安全与隐私](docs/SECURITY_AND_PRIVACY.md)。
- 开源或发布前请检查 [发布清单](docs/RELEASE_CHECKLIST.md)。
