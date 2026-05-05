export function formatDefaultTitle(template: string, pageTitle: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  const safePageTitle = pageTitle.trim() || "Untitled";

  return template
    .replaceAll("{pageTitle}", safePageTitle)
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .trim();
}
