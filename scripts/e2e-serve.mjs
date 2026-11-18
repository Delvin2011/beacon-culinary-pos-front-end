// O3: serves the production build for the Playwright tests the way Azure runs it: the standalone server.js, with
// .next/static and public/ (the service worker) copied in as deploy.ps1 does. Port 3200, this machine only.

import { cpSync, existsSync, rmSync } from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const STANDALONE = path.join(ROOT, ".next", "standalone")

if (!existsSync(path.join(STANDALONE, "server.js"))) {
  console.error("e2e-serve: no standalone build. Run npm run build first.")
  process.exit(1)
}

rmSync(path.join(STANDALONE, ".next", "static"), { recursive: true, force: true })
cpSync(path.join(ROOT, ".next", "static"), path.join(STANDALONE, ".next", "static"), { recursive: true })
if (existsSync(path.join(ROOT, "public"))) {
  rmSync(path.join(STANDALONE, "public"), { recursive: true, force: true })
  cpSync(path.join(ROOT, "public"), path.join(STANDALONE, "public"), { recursive: true })
}

const server = spawn(process.execPath, ["server.js"], {
  cwd: STANDALONE,
  env: { ...process.env, PORT: process.env.E2E_PORT ?? "3200", HOSTNAME: "127.0.0.1" },
  stdio: "inherit",
})
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill())
server.on("exit", (code) => process.exit(code ?? 0))
