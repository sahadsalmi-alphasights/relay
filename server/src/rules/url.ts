/**
 * §3 (bug fix) — project_link is now required at intake; this is the
 * server-side check backing that (never trust client-side validation alone).
 * Only http/https are accepted — a project link is meant to be something a
 * teammate can click and open, not a javascript:/data:/mailto: URI.
 */
export function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
