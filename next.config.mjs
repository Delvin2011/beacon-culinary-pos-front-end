import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

export default nextConfig;
