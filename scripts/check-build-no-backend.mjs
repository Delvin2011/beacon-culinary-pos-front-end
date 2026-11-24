// T1-0d: checks a production build (npm run build) carries no backend address, so the same build serves every
// customer address. Run: npm run check:build (the e2e tests run it after their build). Exit code 1 on any finding.
//
// 1. .next/routes-manifest.json has no rewrite: the development-only /api rewrite (next.config.mjs) never reaches a
//    build, and the standalone server reads its rewrites from this file only.
// 2. No backend address in what is served or run: the client and server output (.next/static, .next/server,
//    .next/standalone without its node_modules) and public/sw.js. Searched for the old local backend and e2e mock
//    addresses, the old and the development-only setting names, and DEV_API_PROXY_TARGET's value if it is set now.
// 3. The client code does call /api (the check would otherwise pass on a build that makes no API calls at all).
// 4. Lists any .env file copied into the standalone output (a warning: it would ship with the server).

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const NEXT = path.join(ROOT, ".next")
const problems = []

if (!fs.existsSync(path.join(NEXT, "routes-manifest.json"))) {
  console.error("check:build: no build in .next. Run npm run build first.")
  process.exit(1)
}

// 1. Rewrites.
const manifest = JSON.parse(fs.readFileSync(path.join(NEXT, "routes-manifest.json"), "utf8"))
const rewrites = Array.isArray(manifest.rewrites)
  ? manifest.rewrites
  : [...(manifest.rewrites?.beforeFiles ?? []), ...(manifest.rewrites?.afterFiles ?? []), ...(manifest.rewrites?.fallback ?? [])]
if (rewrites.length > 0) problems.push(`routes-manifest.json has ${rewrites.length} rewrite(s): ${JSON.stringify(rewrites)}`)

// 2. Addresses.
const needles = ["localhost:8080", "127.0.0.1:8080", "127.0.0.1:8099", "NEXT_PUBLIC_AUTH_API_URL", "DEV_API_PROXY_TARGET"]
if (process.env.DEV_API_PROXY_TARGET) needles.push(process.env.DEV_API_PROXY_TARGET.replace(/\/+$/, ""))

function filesUnder(dir, skip = () => false) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (skip(full, entry)) return []
    return entry.isDirectory() ? filesUnder(full, skip) : [full]
  })
}

const TEXT = /\.(js|mjs|cjs|json|html|rsc|txt|css|map|body|meta)$/
const standaloneSkip = (full, entry) => entry.isDirectory() && entry.name === "node_modules"
const scanned = [
  ...filesUnder(path.join(NEXT, "static")),
  ...filesUnder(path.join(NEXT, "server")),
  ...filesUnder(path.join(NEXT, "standalone"), standaloneSkip),
  ...[path.join(ROOT, "public", "sw.js")].filter((file) => fs.existsSync(file)),
  ...["BUILD_ID", "required-server-files.json", "build-manifest.json", "app-build-manifest.json"]
    .map((name) => path.join(NEXT, name))
    .filter((file) => fs.existsSync(file)),
].filter((file) => TEXT.test(file) || path.basename(file) === "BUILD_ID")

let clientCallsApi = false
for (const file of scanned) {
  const text = fs.readFileSync(file, "utf8")
  for (const needle of needles) {
    if (text.includes(needle)) problems.push(`${path.relative(ROOT, file)} contains "${needle}"`)
  }
  if (file.startsWith(path.join(NEXT, "static")) && /["'`]\/api["'`]/.test(text)) clientCallsApi = true
}

// 3. The client calls /api.
if (!clientCallsApi) problems.push('no client chunk in .next/static contains "/api": the build makes no API calls?')

// 4. .env files in the standalone output.
const envFiles = filesUnder(path.join(NEXT, "standalone"), standaloneSkip).filter((file) => /^\.env/.test(path.basename(file)))
for (const file of envFiles) console.warn(`check:build: warning: ${path.relative(ROOT, file)} is in the standalone output`)

console.log(`check:build: ${scanned.length} files searched for ${needles.length} addresses; ${rewrites.length} rewrites`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`check:build: ${problem}`)
  process.exit(1)
}
console.log("check:build: no backend address in the build")
