// @vitest-environment node
// (next.config.mjs reads package.json from its own file: URL, which jsdom doesn't give.)
// T1-0d: under `npm run dev` alone, /api/* goes to a local backend through a rewrite in next.config.mjs. That rewrite
// exists only in the development phase: a build (and the server it produces) has none, so no backend address can
// reach production.
import { afterEach, describe, expect, it } from "vitest"
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants"
import type { NextConfig } from "next"
import config from "../../next.config.mjs"

const configFor = config as (phase: string) => NextConfig
const saved = process.env.DEV_API_PROXY_TARGET

afterEach(() => {
  if (saved === undefined) delete process.env.DEV_API_PROXY_TARGET
  else process.env.DEV_API_PROXY_TARGET = saved
})

describe("the development API rewrite", () => {
  it("is absent from a build and from the production server, even with a target set", () => {
    process.env.DEV_API_PROXY_TARGET = "http://backend.example:9999"
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      expect(configFor(phase).rewrites).toBeUndefined()
    }
  })

  it("sends /api/* to the local backend with the prefix removed", async () => {
    delete process.env.DEV_API_PROXY_TARGET
    const rewrites = await configFor(PHASE_DEVELOPMENT_SERVER).rewrites!()
    expect(rewrites).toEqual([{ source: "/api/:path*", destination: "http://localhost:8080/:path*" }])
  })

  it("follows DEV_API_PROXY_TARGET, without a trailing slash", async () => {
    process.env.DEV_API_PROXY_TARGET = "http://127.0.0.1:9090/"
    const rewrites = await configFor(PHASE_DEVELOPMENT_SERVER).rewrites!()
    expect(rewrites).toEqual([{ source: "/api/:path*", destination: "http://127.0.0.1:9090/:path*" }])
  })

  it("turns compression off in development only, so event streams pass through at once", () => {
    expect(configFor(PHASE_DEVELOPMENT_SERVER).compress).toBe(false)
    expect(configFor(PHASE_PRODUCTION_BUILD).compress).toBeUndefined()
  })

  it("keeps the rest of the config in every phase", () => {
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      const next = configFor(phase)
      expect(next.output).toBe("standalone")
      expect(next.env?.NEXT_PUBLIC_APP_VERSION).toBe(process.env.POS_APP_BUILD_ID)
      // No image optimiser: sharp isn't in the standalone server (next.config.mjs).
      expect(next.images?.unoptimized).toBe(true)
    }
  })
})
