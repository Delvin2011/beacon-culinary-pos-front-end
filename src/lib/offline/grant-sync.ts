// O3: the offline grant (contract 5, 6). Asked for while online by the owner of this till's open shift; stored as
// received. Valid only for this till's open shift and its owner, signed in, before expiresAt by server time.
// deviceId is stored but not checked: the till can't know its own, and the store only ever holds grants issued to
// this browser's cookie (a revoked till shows as till-status registered=false, which wipes everything).

import { readApiError } from "@/lib/api-error"
import { OfflineErrorCode, parseGrant, type OfflineGrant } from "@/lib/offline/contract"
import { getOfflineSeq, putGrant, putOfflineSeq } from "@/lib/offline/db"
import { recordServerTime } from "@/lib/offline/server-time"
import { parseUtcTimestamp } from "@/lib/receipt"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

export type GrantResult =
  | { kind: "ok"; grant: OfflineGrant }
  | { kind: "refused"; status: number; code: string | null }
  | { kind: "failed" }

// These end any stored grant (and the unlock value) on this till.
export const GRANT_DELETING_CODES: readonly string[] = [
  OfflineErrorCode.NO_OPEN_SHIFT,
  OfflineErrorCode.DEVICE_NOT_REGISTERED,
  OfflineErrorCode.OFFLINE_DISABLED,
]

// O4's numbering continues from the larger of the till's own next number and the server's (contract 7).
async function saveOfflineSeq(grant: OfflineGrant): Promise<void> {
  const stored = await getOfflineSeq()
  const sameDay = stored?.tradingDay === grant.tradingDay
  await putOfflineSeq({
    nextOfflineSeq: sameDay ? Math.max(stored.nextOfflineSeq, grant.nextOfflineSeq) : grant.nextOfflineSeq,
    tradingDay: grant.tradingDay,
    shiftId: grant.shiftId,
  })
}

export async function requestGrant(authFetch: AuthFetch): Promise<GrantResult> {
  try {
    const res = await authFetch("/pos/offline/grant", { method: "POST" })
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as unknown
      const grant = parseGrant(body)
      if (!grant) return { kind: "failed" }
      await putGrant(body)
      recordServerTime(grant.serverTimeUtc)
      await saveOfflineSeq(grant)
      return { kind: "ok", grant }
    }
    const { code } = await readApiError(res)
    return { kind: "refused", status: res.status, code }
  } catch {
    return { kind: "failed" }
  }
}

export interface GrantCheck {
  // This till's open shift (till-status), its owner, and the signed-in user.
  shiftId: number | null
  ownerId: number | null
  userId: number | null
  now: number // server time
}

export function isGrantValid(grant: OfflineGrant | null, { shiftId, ownerId, userId, now }: GrantCheck): grant is OfflineGrant {
  if (!grant || shiftId === null || ownerId === null || userId === null) return false
  const expiresAt = parseUtcTimestamp(grant.expiresAt)
  return (
    grant.shiftId === shiftId &&
    grant.cashierId === userId &&
    grant.cashierId === ownerId &&
    expiresAt !== null &&
    expiresAt.getTime() > now
  )
}

// Renew when less than maxOfflineHours is left: an outage starting now must not outlast the grant.
export function grantNeedsRenewal(grant: OfflineGrant, maxOfflineHours: number, now: number): boolean {
  const expiresAt = parseUtcTimestamp(grant.expiresAt)
  return expiresAt === null || expiresAt.getTime() - now < maxOfflineHours * 3_600_000
}
