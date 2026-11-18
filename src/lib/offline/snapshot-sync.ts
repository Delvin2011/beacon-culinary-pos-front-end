// O3: today's snapshot (contract 8). Refreshed with If-None-Match; a 304 or any failure keeps the stored one.
// The ETag is the quoted snapshotVersion. While the API doesn't expose the ETag header to the browser (CORS), it is
// rebuilt from snapshotVersion; that fallback stays. A stored etag of null means "ask for the full body" (set when
// the accounts list was cleared), so the stored version is never used in its place.

import { readApiError } from "@/lib/api-error"
import { parseSnapshot } from "@/lib/offline/contract"
import { getSnapshot, putSnapshot, setMeta } from "@/lib/offline/db"
import { recordServerTime } from "@/lib/offline/server-time"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

export const SNAPSHOT_REFRESH_MS = 5 * 60_000

export type SnapshotResult =
  | { kind: "updated" }
  | { kind: "not-modified" }
  | { kind: "refused"; status: number; code: string | null }
  | { kind: "failed" }

// keepAccounts: false while this till has no open shift. The accounts list is kept only during a shift (it is
// cleared at shift close), so a snapshot fetched without one is stored without it, and without an ETag so the first
// refresh after a shift opens gets the full body instead of a 304.
export async function refreshSnapshot(authFetch: AuthFetch, { keepAccounts = true }: { keepAccounts?: boolean } = {}): Promise<SnapshotResult> {
  try {
    const stored = await getSnapshot()
    const etag = stored?.etag ?? null
    // no-store: the browser's own cache must not turn the server's 304 into a 200 from cache.
    const res = await authFetch("/pos/offline/snapshot", {
      cache: "no-store",
      headers: etag ? { "If-None-Match": etag } : undefined,
    })
    const now = new Date().toISOString()
    if (res.status === 304 && stored) {
      await setMeta("lastSnapshotAt", now)
      return { kind: "not-modified" }
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as unknown
      const snapshot = parseSnapshot(body)
      if (!snapshot) return { kind: "failed" }
      if (keepAccounts) {
        await putSnapshot(body, res.headers.get("ETag") ?? `"${snapshot.snapshotVersion}"`, now)
      } else {
        const withoutAccounts = { ...(body as Record<string, unknown>) }
        delete withoutAccounts.accounts
        await putSnapshot(withoutAccounts, null, now)
      }
      recordServerTime(snapshot.serverTimeUtc)
      await setMeta("lastSnapshotAt", now)
      return { kind: "updated" }
    }
    const { code } = await readApiError(res)
    return { kind: "refused", status: res.status, code }
  } catch {
    return { kind: "failed" }
  }
}
