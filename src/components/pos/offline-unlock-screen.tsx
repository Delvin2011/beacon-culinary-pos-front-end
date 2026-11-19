"use client"

// O3 (D13): the sign-in screen while offline, when this till can be unlocked offline. Only the shift owner's tile;
// their PIN is checked against the check value on this till. 5 wrong tries disable it until the till is online.

import { useEffect, useState } from "react"
import { CloudOff } from "lucide-react"
import { NumericKeypad } from "@/components/pos/numeric-keypad"
import type { OfflineUnlockOwner, UnlockResult } from "@/hooks/use-offline-unlock"
import { MAX_UNLOCK_FAILURES } from "@/lib/offline/unlock"
import { PIN_LENGTH } from "@/lib/pin"

export const OFFLINE_UNLOCK_DISABLED_MESSAGE = "Offline unlock is disabled until the till is back online."

export function wrongPinMessage(triesLeft: number): string {
  return `Incorrect PIN. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`
}

interface Props {
  owner: OfflineUnlockOwner
  disabled: boolean
  triesLeft: number | null
  notice: string | null
  unlock: (pin: string) => Promise<UnlockResult>
  onUnlocked: () => void
}

export function OfflineUnlockScreen({ owner, disabled, triesLeft, notice, unlock, onUnlocked }: Props) {
  const [pin, setPin] = useState("")
  const [checking, setChecking] = useState(false)

  // Auto-submits at 6 digits, as the online sign-in does. A wrong PIN clears the dots; the tries left come back
  // through props.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH || checking || disabled) return
    setChecking(true)
    void unlock(pin)
      .then((result) => {
        if (result === "unlocked") onUnlocked()
        else setPin("")
      })
      .finally(() => setChecking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  const message = disabled
    ? OFFLINE_UNLOCK_DISABLED_MESSAGE
    : triesLeft !== null && triesLeft < MAX_UNLOCK_FAILURES
      ? wrongPinMessage(triesLeft)
      : null

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-950 p-8">
      <div className="flex max-w-md items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-5 py-3 text-sm text-amber-100">
        <CloudOff className="h-4 w-4 shrink-0" />
        Offline: only {owner.name} can unlock this till.
      </div>

      {notice && <p className="text-sm text-sky-200">{notice}</p>}

      <div className="flex flex-col items-center gap-3">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-700 text-2xl font-bold text-white ring-2 ring-amber-300">
          {owner.name
            .split(" ")
            .map((word) => word[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <p className="text-xl font-semibold text-white">{owner.name}</p>
        <p className="text-sm text-slate-400">{disabled ? "Ask a manager once the till is back online." : "Enter your PIN"}</p>
      </div>

      <div className="flex gap-4" aria-label="PIN">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-colors ${
              i < pin.length ? "border-white bg-white" : "border-slate-600 bg-transparent"
            }`}
          />
        ))}
      </div>

      {message && (
        <div role="alert" className="max-w-xs rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-3 text-center text-sm text-rose-300">
          {message}
        </div>
      )}

      <NumericKeypad value={pin} onChange={setPin} maxLength={PIN_LENGTH} disabled={checking || disabled} />
    </div>
  )
}
