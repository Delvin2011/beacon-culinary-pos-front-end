import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "nogit";
  }
}
// One id per build: the heartbeat's appVersion (O3), and the service worker's cache version.
// e.g. "0.1.0-a662bd7-mi3k2x1a" (well under the contract's 50 characters).
// Next loads this file in several build processes; the first one's id is passed on to the others through the
// environment, so the build id and the id inlined into the client code are the same.
process.env.POS_APP_BUILD_ID ??= `${version}-${gitSha()}-${Date.now().toString(36)}`;
const buildId = process.env.POS_APP_BUILD_ID;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  generateBuildId: async () => buildId,
  env: { NEXT_PUBLIC_APP_VERSION: buildId },
};

// T1-0d: the app calls /api on its own address (src/lib/api-url.ts). Front Door (production) and Caddy (the local
// stack) send /api/* to the backend with the prefix removed. Under `npm run dev` alone, this rewrite does the same,
// to DEV_API_PROXY_TARGET (default http://localhost:8080; the backend needs cookie.path-prefix=/api so the refresh
// cookie's path is /api/auth/refresh).
// Development only, and it can't reach production: Next calls this function with the phase, and `next build` runs it
// in PHASE_PRODUCTION_BUILD, where no rewrite is defined. The standalone server never reads this file again: it uses
// the rewrites saved in .next/routes-manifest.json at build time, which are empty. npm run check:build verifies it.
export default function config(phase) {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return nextConfig;
  const target = (process.env.DEV_API_PROXY_TARGET || "http://localhost:8080").replace(/\/+$/, "");
  return {
    ...nextConfig,
    // The dev server's gzip holds back the kitchen, bar and board event streams until they end; off in development only.
    compress: false,
    async rewrites() {
      return [{ source: "/api/:path*", destination: `${target}/:path*` }];
    },
  };
}
