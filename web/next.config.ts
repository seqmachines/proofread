import type { NextConfig } from "next";

// D1 (SPEC.md §10, layout A): the app lives under /proofread on the acolytics.com root.
// next/link and the app router prefix routes automatically; code that builds a URL by hand
// reads NEXT_PUBLIC_BASE_PATH (lib/basePath.ts). The backend is reached directly from the
// browser at NEXT_PUBLIC_API_URL (lib/api.ts), never through this prefix.
const basePath = "/proofread";

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // The dev badge sat on top of the bottom chat strip; errors still surface in the console and overlay.
  devIndicators: false,
};

export default nextConfig;
