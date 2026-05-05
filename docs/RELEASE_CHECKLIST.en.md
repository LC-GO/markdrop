# Release Checklist

Use this before sharing a build, publishing a release, or opening the repository.

## Source Hygiene

- Confirm no real Notion, Feishu, or Obsidian credentials are committed.
- Confirm `.gitignore` excludes `node_modules/`, `dist/`, local backups, logs, and `.env` files.
- Confirm `README.md` routes Chinese and English users to the full guides.
- Confirm `README.zh-CN.md` and `README.en.md` explain the three platform setup paths from a fresh install.
- Confirm `docs/SECURITY_AND_PRIVACY.md` and the English version explain permissions and data flow.
- Confirm `docs/TESTING.md` has been run for the latest capture/save changes.

## Versioning

- Update `public/manifest.json` version.
- Update `package.json` version.
- Update `package-lock.json` version.
- Update `MARKDROP_BUILD_ID` when product behavior changes.

## Build

```bash
npm run typecheck
npm run build
```

Then reload `dist/` in Chrome or Edge and run a smoke test:

- Open the options page.
- Validate at least one target.
- Save one full AI answer.
- Save one selected text snippet.
- Confirm the saved result opens in the target app.

## Packaging

- Build from a clean workspace.
- Package only the generated extension output needed by the browser.
- Do not include local browser storage, screenshots with secrets, or temporary notes.

