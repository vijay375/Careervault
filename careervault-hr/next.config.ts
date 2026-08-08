import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.join(appDir, "shared");

/** Production multi-zone path (e.g. `/hr`). Empty for local :3001. */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim().replace(/\/$/, "") || undefined;

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  turbopack: {
    root: appDir,
    resolveAlias: {
      "@shared": sharedDir,
      "@shared/*": path.join(sharedDir, "*"),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@shared": sharedDir,
      "@shared/email-delivery": path.join(sharedDir, "email-delivery.ts"),
      "@shared/document-request-emails": path.join(sharedDir, "document-request-emails.ts"),
    };
    return config;
  },
};

export default nextConfig;
