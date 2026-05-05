# Security And Privacy

Markdrop is a local-first browser extension. It does not include a Markdrop backend service.

## Stored Locally

The following data is stored in browser extension storage:

- Notion Internal Integration Token
- Feishu App ID and App Secret
- Feishu OAuth access/refresh tokens
- Obsidian Local REST API URL and API Key
- Save target names and target IDs/URLs
- User preferences such as source URL, buttons, interface language, and title template

Do not commit exported browser storage or screenshots that reveal secrets.

## Network Destinations

Markdrop sends data only when the user explicitly saves content or tests a configured target.

- Notion requests go to `https://api.notion.com/*`.
- Feishu requests go to `https://open.feishu.cn/*` and OAuth pages under `https://accounts.feishu.cn/*`.
- Obsidian requests go to the configured local URL, usually `https://127.0.0.1:27124` or `http://127.0.0.1:27123`.

Captured page content is sent only to the destination selected by the user in the save dialog.

## Browser Permissions

`activeTab`:
Used to capture the currently active page when the user clicks the extension or uses selection save.

`contextMenus`:
Used for the `Save to Markdrop` right-click menu.

`identity`:
Used for Feishu OAuth with `chrome.identity.launchWebAuthFlow`.

`scripting`:
Used to inject capture helpers into the active tab when needed.

`storage`:
Used to store local settings and credentials in extension storage.

`<all_urls>` host access:
Needed because generic text selection and AI answer capture must work across ordinary web pages and supported AI sites. Markdrop should only read selected content or the specific AI answer that the user saves.

## Feishu Permissions

Feishu uses user OAuth authorization. The current code requests these scopes:

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

These permissions are used only when the user explicitly saves content or validates a target:

- `tenant` group: lets the app access Docs folders, Wiki directories, and create/read/write documents.
- `user` group: lets Markdrop create, write, and convert documents as the authorized user after OAuth login.
- `offline_access`: refreshes the Feishu OAuth login.
- `docx:document:create`: creates new Docs documents.
- `docx:document:readonly`: validates and reads basic document information.
- `docx:document:write_only`: writes document blocks.
- `docx:document.block:convert`: converts Markdown and tables into native Feishu document blocks.
- `drive:drive`: accesses Docs folder targets.
- `wiki:wiki`: accesses existing Wiki directory targets.

If a Feishu API response says a permission is missing, add that permission in the Feishu Open Platform, publish/enable the app as required, then log out of Feishu in Markdrop and authorize again.

## Obsidian Local REST API

Obsidian support depends on the community plugin `Local REST API`.

- HTTPS may fail in browser extensions when the local certificate is self-signed.
- If HTTPS opens in the browser but Markdrop cannot fetch it, enable the plugin's non-encrypted HTTP server and use `http://127.0.0.1:27123`.
- The API key should be treated like a password for the local vault.
