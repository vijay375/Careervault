import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.join(appDir, "shared");

/**
 * HR Portal is always mounted under `/hr` so CareerVault can use one public
 * origin (role-based access after the shared login on `/`).
 */
const basePath = "/hr";

const nextConfig: NextConfig = {
  basePath,
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
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
