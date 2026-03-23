/**
 * Resolve an upload URL to a full absolute URL.
 * Backend returns paths like "/uploads/xxx.jpg" which are relative to the API origin,
 * not the frontend origin. If the URL is already absolute (e.g. R2), return as-is.
 */
export function resolveUploadUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  // VITE_API_URL is like "https://api.chia.dongtran.asia/api/v1"
  // We need the origin: "https://api.chia.dongtran.asia"
  const apiBase = import.meta.env.VITE_API_URL || "";
  try {
    const origin = new URL(apiBase).origin;
    return `${origin}${path}`;
  } catch {
    // Fallback: if VITE_API_URL is relative (e.g. "/api/v1"), path is already usable
    return path;
  }
}
