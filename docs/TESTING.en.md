# Markdrop Manual Test Checklist

Run this checklist after changes to capture logic, Markdown conversion, save integrations, options UI, or extension permissions.

## Build

- Run `npm run typecheck`.
- Run `npm run build`.
- Reload the unpacked extension from `chrome://extensions` or `edge://extensions`.
- Confirm the options page footer shows the expected build ID.

## Fresh Browser Install

- Load `dist/` into a clean Chrome or Edge profile.
- Open the Markdrop options page.
- Confirm Notion, Feishu, and Obsidian platform cards are visible.
- Confirm required fields are marked with `*`.
- Confirm no real credentials are prefilled.
- Switch language preference between `Auto`, `中文`, and `English`; confirm the options page and save dialog update.

## Generic Web Capture

- Select plain text on a normal web page.
- Use the browser context menu `Save to Markdrop`.
- Confirm the save dialog opens.
- Confirm the title is derived from the page title.
- Save to each configured destination.

## AI Platform Buttons

For each supported AI platform, confirm that one save button appears below each answer and not inside reasoning blocks, copy toolbars, or unrelated floating containers.

- ChatGPT
- Claude
- DeepSeek
- Doubao
- Gemini
- Kimi
- Qianwen/Tongyi

For each platform, save a representative answer containing:

- Headings
- Paragraphs
- Bold and italic text
- Inline code
- Code blocks with language labels
- Tables
- Ordered and unordered lists, including nested lists
- Task lists
- Block quotes
- Inline and block formulas
- Horizontal dividers

## Selection Capture On AI Pages

- Select a subsection of an AI answer.
- Save the selection.
- Confirm formulas and code blocks are not flattened or swallowed into surrounding code blocks.
- Confirm the saved title still uses the AI answer/page title.
- Confirm selected content does not accidentally include adjacent answers.

## Notion

- Validate a Notion Page target.
- Validate a Notion Data Source target.
- Save a full AI answer to a Page target.
- Save a selection to a Page target.
- Confirm formulas render readably.
- Confirm supported Markdown tables are saved as tables.
- Confirm code blocks keep line breaks and language labels.
- Confirm the error message is clear when the target is not shared with the integration.

## Feishu

- Log in through OAuth.
- Save to a Docs folder target.
- Save to a Wiki directory target.
- Confirm native tables are created for Markdown tables.
- Confirm formulas render readably or degrade to readable text.
- Confirm code blocks keep line breaks.
- Confirm token refresh failures ask the user to log in again.

## Obsidian

- Validate the Local REST API target.
- Save to a vault folder path such as `AI notes`.
- Confirm saved files are Markdown files under the expected folder.
- Confirm `obsidian://` open links work when a vault name is configured.
- Confirm code fences close correctly and later content is not swallowed into code blocks.
- Confirm code blocks retain language labels for syntax highlighting.
- Confirm task lists are saved as `- [x]` / `- [ ]`.
- Confirm formulas remain readable in Obsidian preview.

## Regression Notes

If a platform differs from the original web rendering, capture:

- Source platform and URL
- Browser and extension build ID
- Screenshot of original content
- Screenshot of saved result
- `Copy captured Markdown` output, if available
