// lib/basePath.ts — the app's URL prefix (next.config.ts basePath), for URLs built by hand.
// next/link, next/navigation and metadata routes prefix themselves; fetch() does not.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix an app-relative path ("/api/fixture") with the base path. */
export const withBasePath = (path: string) => `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
