# 安全与隐私

Markdrop 是本地优先的浏览器扩展，不包含 Markdrop 自己的后端服务。

## 本地存储的数据

以下数据保存在浏览器扩展本地存储中：

- Notion Internal Integration Token
- Feishu App ID 和 App Secret
- Feishu OAuth access token / refresh token
- Obsidian Local REST API URL 和 API Key
- 保存位置名称和目标 ID/URL
- 用户偏好，例如来源 URL、按钮开关、界面语言和标题模板

不要提交导出的浏览器存储，也不要提交暴露密钥的截图。

## 网络请求目的地

Markdrop 只会在用户主动保存内容或验证保存位置时发送请求。

- Notion 请求发送到 `https://api.notion.com/*`。
- Feishu 请求发送到 `https://open.feishu.cn/*`，OAuth 页面在 `https://accounts.feishu.cn/*`。
- Obsidian 请求发送到用户配置的本地地址，通常是 `https://127.0.0.1:27124` 或 `http://127.0.0.1:27123`。

捕获到的页面内容只会发送到用户在保存弹窗中选择的目标。

## 浏览器权限

`activeTab`：
用于在用户点击扩展或触发划词保存时读取当前页面。

`contextMenus`：
用于 `Save to Markdrop` 右键菜单。

`identity`：
用于 Feishu OAuth，调用 `chrome.identity.launchWebAuthFlow`。

`scripting`：
用于在需要时向当前标签页注入捕获脚本。

`storage`：
用于保存本地配置和凭据。

`<all_urls>` host access：
普通网页划词保存和 AI 回答捕获需要在不同站点工作。Markdrop 应只读取用户选中的内容或用户点击保存的那一条 AI 回答。

## Feishu 权限

Feishu 使用用户 OAuth 授权。当前代码请求的 scope 如下：

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

这些权限仅用于用户主动保存或验证目标时：

- `tenant` 组：用于应用访问云文档文件夹、Wiki 目录，以及创建/读写文档。
- `user` 组：用于用户 OAuth 授权后，以当前用户身份创建、写入和转换文档。
- `offline_access`：刷新 Feishu OAuth 登录状态。
- `docx:document:create`：创建新版文档。
- `docx:document:readonly`：验证和读取文档基础信息。
- `docx:document:write_only`：向文档写入内容块。
- `docx:document.block:convert`：把 Markdown、表格等内容转换成飞书原生文档块。
- `drive:drive`：访问云文档文件夹目标。
- `wiki:wiki`：访问已有知识库目录目标。

如果 Feishu API 返回缺少权限，请在 Feishu 开放平台添加该权限，按租户要求发布/启用应用，然后在 Markdrop 中退出 Feishu 登录并重新授权。

## Obsidian Local REST API

Obsidian 支持依赖社区插件 `Local REST API`。

- 本地 HTTPS 使用自签名证书时，浏览器扩展可能无法访问。
- 如果 HTTPS 地址可以在浏览器打开，但 Markdrop 无法请求，请启用插件的非加密 HTTP 服务，并使用 `http://127.0.0.1:27123`。
- API Key 应当像本地 Vault 的密码一样保管。
