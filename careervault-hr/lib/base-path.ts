/**
 * HR Portal is always mounted under `/hr` for same-origin role-based access.
 */
export function getBasePath() {
  return String(process.env.NEXT_PUBLIC_BASE_PATH || "/hr")
    .trim()
    .replace(/\/$/, "") || "/hr";
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
