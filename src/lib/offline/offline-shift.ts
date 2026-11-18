// O3: the shift after a reload while offline. The shift context saves the last shift it loaded online and, when a
// lookup gets no answer and no shift is on screen, restores it, but only if this till may sell offline on it:
// offline enabled and registered (the saved till-status), a valid grant for that shift, and the signed-in user owns
// it. Saved only while the saved till-status says offline is on, so with offline off nothing changes.

import type { Shift } from "@/contexts/shift-context"
import { deleteMeta, getGrant, getMeta, setMeta } from "@/lib/offline/db"
import { isGrantValid } from "@/lib/offline/grant-sync"
import { serverNow } from "@/lib/offline/server-time"
import { signedInUserId } from "@/lib/offline/signed-in-user"

// null: there is no open shift (a 404), so nothing may be restored.
export async function saveLastShift(shift: Shift | null): Promise<void> {
  if (!shift) {
    await deleteMeta("lastShift")
    return
  }
  const status = await getMeta("tillStatus")
  if (status?.offlineEnabled && status.registered) await setMeta("lastShift", shift)
  else await deleteMeta("lastShift")
}

export async function restoreOfflineShift(user: { id?: string; cashierId?: number } | null | undefined): Promise<Shift | null> {
  const [shift, status, stored] = await Promise.all([getMeta("lastShift"), getMeta("tillStatus"), getGrant()])
  if (!shift || !status?.offlineEnabled || !status.registered) return null
  const valid = isGrantValid(stored?.grant ?? null, {
    shiftId: shift.id,
    ownerId: shift.owner.id,
    userId: signedInUserId(user),
    now: serverNow(),
  })
  return valid ? { ...shift, ownedByCaller: true } : null
}
