# Markdrop

Markdrop is a local-first browser extension for saving selected web content and AI answers, including selected snippets and full answers, as structured notes.

It currently supports:

- Notion pages and data sources
- Feishu Docs folders and Feishu Wiki directories (knowledge bases)
- Obsidian vault folders through the Obsidian Local REST API plugin

Markdrop does not run a backend service. Tokens, secrets, and target configuration stay in the local browser extension storage.

## Features

- Save selected text from ordinary web pages.
- Save through the browser context menu.
- Inject per-answer `Save` buttons on supported AI platforms.
- Preserve Markdown-friendly structure: headings, paragraphs, lists, tables, quotes, code blocks, task lists, formulas, links, and inline code.
- Keep Notion, Feishu, and Obsidian targets isolated, even when target names are identical.
- Configure several save locations and choose the target at save time.
- Product UI supports `Auto / 中文 / English`; Auto follows the browser language.

Supported AI platforms include ChatGPT, Claude, Gemini, DeepSeek, Doubao, and Qianwen.

## Usage

- Select text and use the browser context menu `Save to Markdrop`.
- On supported AI platforms, click the `Save` button below a specific AI answer to save the full answer, or use selection saving.

The save dialog lets you edit the title, choose a destination, include or omit the source URL, and preview the captured Markdown.

## Install Option 1: Download A Release, Recommended For Users

If you only want to install and use Markdrop, download a packaged extension from GitHub Releases.

1. Download the latest `markdrop-*.zip`.
2. Unzip it locally.
3. Open `chrome://extensions` or `edge://extensions`.
4. Enable Developer mode.
5. Click `Load unpacked`.
6. Select the unzipped extension folder.

This path does not require Node.js or npm commands.

## Install Option 2: Build From Source, For Developers

If you want to modify the code, debug features, or package the extension yourself, run these commands in the project folder:

```bash
npm install
npm run typecheck
npm run build
```

The unpacked extension is generated in `dist/`.

Then load it in Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select the `dist/` folder.

After every rebuild, reload the extension from the browser extensions page.

## Open The Options Page

Open the extension details page and click `Extension options`, or open the Markdrop popup and use the settings entry.

The options page has one platform card for each destination:

- `Notion`: Internal Integration Token and Notion save targets.
- `Feishu`: self-built app credentials, OAuth login, and Feishu save targets.
- `Obsidian`: Local REST API URL/API key and vault folder targets.

Fields marked with `*` are required.

## Configure Notion

1. Go to [Notion integrations](https://www.notion.so/my-integrations).
2. Create an internal integration.
3. Copy the `Internal Integration Token` into Markdrop.
4. Open the target Notion page or data source.
5. In Notion, connect/share that page or data source with the integration. The normal people-share box is not always enough if the integration is not connected.
6. Add a Markdrop Notion save target:
   - Target name: only used in Markdrop's save dialog.
   - Type: `Page` or `Data Source`.
   - Notion URL or ID: paste the page/data source URL directly.
   - Title property: only change this for data sources whose title property is not named `Name`.
7. Click `Validate`.

### Notion Data Source / Database Notes

If you want to save into a Notion database:

1. Create a table database in Notion. A full-page database is recommended for testing.
2. Open the database page, click `...` in the upper-right corner, then open `Connections` and add your Notion integration, for example `Markdrop`.
3. Add a Notion save target in Markdrop:
   - Type: choose `Data Source / Database`.
   - Notion URL or ID: you can paste the database page URL from the browser address bar. Markdrop will resolve the underlying Data Source automatically.
   - Title property: this must match the database title column. Chinese Notion often uses `名称`; English Notion usually uses `Name`.
4. Click `Validate`. After validation succeeds, saves will create new database entries.

If validation says it cannot find the database/data source, first check whether the database page has the integration added under `Connections`. Sharing with a normal member or email account is not always the same as connecting the integration.

## Configure Feishu

Use a self-built Feishu app. Each user should create and configure their own app.

1. Create a self-built app in the [Feishu Open Platform](https://open.feishu.cn/).
2. Copy the app's `App ID` and `App Secret` from the app credentials/basic information page into Markdrop.
3. Copy Markdrop's `OAuth Redirect URL` from the options page.
4. Add that redirect URL to the Feishu app's security/OAuth redirect URL settings.
5. Import and apply for permissions in the Feishu app permission management page:
   - Open batch permission import/export.
   - Choose import.
   - Paste the JSON below.

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

Permission usage:

- `tenant` group: lets the app access Docs folders, Wiki directories, and create/read/write documents.
- `user` group: lets Markdrop create, write, and convert documents as the authorized user after OAuth login.
- `offline_access`: obtains a refresh token so the Feishu login can be refreshed.
- `docx:document:create`: creates new Feishu Docs documents in the target location.
- `docx:document:readonly`: validates and reads basic document information.
- `docx:document:write_only`: writes headings, paragraphs, code blocks, formulas, and other document blocks.
- `docx:document.block:convert`: converts Markdown and tables into native Feishu document blocks.
- `drive:drive`: accesses folders and files when saving to a Docs folder.
- `wiki:wiki`: accesses Wiki nodes when saving to an existing Wiki directory.

If the console says a scope does not exist, follow Feishu's current console prompt and remove that item before importing again. Do not omit `docx:document.block:convert`; without it, tables and similar content may fall back to plain text or code blocks.

6. Submit for approval, publish, or enable the app as required by your tenant.
7. Click `Login with Feishu` in Markdrop and approve access. If you just added permissions, log out first and then log in again.
8. Add a Feishu save target:
   - Feishu Docs folder: paste a folder link or folder token.
   - Feishu Wiki directory: paste an existing Wiki directory/page link or node token. Markdrop creates documents under that directory; it does not create a new Wiki space.

Common required permissions are documented in [docs/SECURITY_AND_PRIVACY.en.md](docs/SECURITY_AND_PRIVACY.en.md).

## Configure Obsidian

Markdrop writes Markdown files through the community plugin `Local REST API`.

1. Install and enable the `Local REST API` plugin in Obsidian.
2. Copy the API key from the plugin settings.
3. If HTTPS works in the browser but extension fetches fail, enable the plugin's non-encrypted HTTP server and use `http://127.0.0.1:27123`.
4. Fill in Markdrop's Obsidian settings:
   - Local REST API URL
   - API Key
   - Vault name, optional, only used to open saved files through `obsidian://` links
5. Add an Obsidian save target:
   - Target name: only used in Markdrop's save dialog.
   - Vault folder path: for example `AI notes`; use `/` or `.` for the vault root.

## Testing, Security, And Release

- Run [docs/TESTING.en.md](docs/TESTING.en.md) after capture/save changes.
- Read [docs/SECURITY_AND_PRIVACY.en.md](docs/SECURITY_AND_PRIVACY.en.md) for data flow and permissions.
- Use [docs/RELEASE_CHECKLIST.en.md](docs/RELEASE_CHECKLIST.en.md) before publishing or sharing a packaged build.
