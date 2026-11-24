"use client"

// T1-3: what every screen shows about the customer (src/lib/customer-status.ts), around the whole app:
//  - suspended (503 CUSTOMER_SUSPENDED): a full-page message over the screen, with "Try again". The screen stays
//    mounted underneath (inert), so the session, the cart and any pending sale are exactly as they were when it
//    ends. While suspended the only call is a /health check every 60 s ± 15 s (src/lib/customer-recovery.ts).
//  - unavailable (503 CUSTOMER_UNAVAILABLE) away from the POS: a banner with the usual "Can't reach the server"
//    wording. The POS has its connection indicator ("Server unavailable") and O1's outage behaviour instead.
//  - an unknown address (an empty 404, confirmed by /health): a banner, "This address isn't set up.", on any screen.
// Screens keep their own messages as well. None of this signs anyone out or deletes anything.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useCustomerStatus } from "@/hooks/use-customer-status"
import { checkCustomerNow, startRecoveryChecks } from "@/lib/customer-recovery"
import { SUSPENDED_MESSAGE, UNKNOWN_ADDRESS_MESSAGE } from "@/lib/customer-status"
import { CONNECTION_MESSAGES } from "@/lib/net"

const isPosPath = (pathname: string | null) => pathname === "/pos" || (pathname?.startsWith("/pos/") ?? false)

function useCheckNow() {
  const [checking, setChecking] = useState(false)
  const check = async () => {
    if (checking) return
    setChecking(true)
    try {
      await checkCustomerNow()
    } finally {
      setChecking(false)
    }
  }
  return { checking, check }
}

export function CustomerStatusGate({ children }: { children: ReactNode }) {
  const { suspended, unavailable, unknownAddress } = useCustomerStatus()
  const pathname = usePathname()
  const { checking, check } = useCheckNow()
  const appRef = useRef<HTMLDivElement>(null)

  useEffect(() => startRecoveryChecks(), [])

  // The screen under the message can't be reached by keyboard or pointer, or read out.
  useEffect(() => {
    const app = appRef.current
    if (!app) return
    if (suspended) {
      app.setAttribute("inert", "")
      app.setAttribute("aria-hidden", "true")
    } else {
      app.removeAttribute("inert")
      app.removeAttribute("aria-hidden")
    }
  }, [suspended])

  const banner = suspended
    ? null
    : unknownAddress
      ? UNKNOWN_ADDRESS_MESSAGE
      : unavailable && !isPosPath(pathname)
        ? CONNECTION_MESSAGES.network
        : null

  return (
    <>
      {banner && (
        <div role="alert" className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>{banner}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void check()} disabled={checking}>
            {checking ? "Checking…" : "Try again"}
          </Button>
        </div>
      )}
      <div ref={appRef} className="contents">
        {children}
      </div>
      {suspended && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="customer-suspended-title"
          aria-describedby="customer-suspended-message"
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950 px-6 text-center text-white"
        >
          <div className="max-w-md space-y-5">
            <h1 id="customer-suspended-title" className="text-2xl font-bold">
              Service unavailable
            </h1>
            <p id="customer-suspended-message" className="text-base text-slate-200">
              {SUSPENDED_MESSAGE}
            </p>
            <Button type="button" onClick={() => void check()} disabled={checking} className="min-h-[44px] px-6">
              {checking ? "Checking…" : "Try again"}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
