import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.join(appDir, "shared");

/**
 * Multi-zone: proxy `/hr` to the HR Portal deployment.
 * Set HR_ZONE_URL to the HR project's origin (no trailing slash), e.g.
 * https://careervault-hr.vercel.app
 */
const hrZoneUrl = (process.env.HR_ZONE_URL || "").trim().replace(/\/$/, "");

const nextConfig: NextConfig = {
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
  async rewrites() {
    if (!hrZoneUrl) {
      return [];
    }

    return [
      {
        source: "/hr",
        destination: `${hrZoneUrl}/hr`,
      },
      {
        source: "/hr/:path*",
        destination: `${hrZoneUrl}/hr/:path*`,
      },
    ];
  },
};

export default nextConfig;
