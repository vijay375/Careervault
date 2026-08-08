/**
 * Production multi-zone base path for the HR Portal (e.g. `/hr`).
 * Leave empty for local development on http://localhost:3001.
 */
export function getBasePath() {
  return String(process.env.NEXT_PUBLIC_BASE_PATH || "")
    .trim()
    .replace(/\/$/, "");
}

/** Prefix an absolute app path with the configured basePath. */
export function withBasePath(path: string) {
  const base = getBasePath();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!base) {
    return normalized;
  }
  if (normalized === base || normalized.startsWith(`${base}/`)) {
    return normalized;
  }
  return `${base}${normalized}`;
}
