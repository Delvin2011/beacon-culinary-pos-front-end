"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { PrintMedium } from "@/lib/reports"

// RECEIPT80: the till's receipt and kitchen ticket on the 80 mm thermal printer, with no page margins (the content
// itself is 72 mm wide). Reports keep SLIP80, which has a small margin.
export type PrintPage = PrintMedium | "RECEIPT80"

const PAGE_RULES: Record<PrintPage, string> = {
  A4: "@page { size: A4; margin: 14mm; }",
  SLIP80: "@page { size: 80mm auto; margin: 3mm; }",
  RECEIPT80: "@page { size: 80mm auto; margin: 0; }",
}

// After window.print() returns, wait at most this long for `afterprint` before moving on to the next job. With
// --kiosk-printing print() returns at once and `afterprint` may never fire; in a normal browser print() blocks
// until the dialog closes and `afterprint` fires first.
export const PRINT_FALLBACK_TIMEOUT_MS = 2000

export interface PrintJob {
  medium: PrintPage
  content: ReactNode
}

// Prints jobs one after the other (e.g. the receipt, then the kitchen ticket). Each job is rendered into a portal on
// <body>; while printing, globals.css hides everything else and the page size is set for the job's medium.
// Printing never throws to the caller: a failing print() just moves on to the next job.
export function usePrintQueue() {
  const [queue, setQueue] = useState<PrintJob[]>([])
  const current = queue[0] ?? null

  useEffect(() => {
    if (!current) return
    const style = document.createElement("style")
    style.textContent = PAGE_RULES[current.medium]
    document.head.appendChild(style)
    document.documentElement.classList.add("printing")

    let finished = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer)
      window.removeEventListener("afterprint", next)
      style.remove()
      document.documentElement.classList.remove("printing")
    }
    function next() {
      if (finished) return
      finished = true
      cleanup()
      setQueue((jobs) => jobs.slice(1))
    }

    window.addEventListener("afterprint", next)
    // Let the portal paint before printing.
    const frame = window.requestAnimationFrame(() => {
      try {
        window.print()
      } catch {
        // Nothing to do: the till can't tell whether paper came out anyway.
      }
      if (!finished) timer = setTimeout(next, PRINT_FALLBACK_TIMEOUT_MS)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      if (!finished) cleanup()
    }
  }, [current])

  const enqueue = useCallback((...jobs: PrintJob[]) => {
    if (jobs.length > 0) setQueue((queued) => [...queued, ...jobs])
  }, [])

  const print = useCallback((medium: PrintPage, content: ReactNode) => enqueue({ medium, content }), [enqueue])

  const portal = current
    ? createPortal(
        <div className="print-portal" data-medium={current.medium}>
          {current.content}
        </div>,
        document.body,
      )
    : null

  return { enqueue, print, portal, printing: current !== null }
}
