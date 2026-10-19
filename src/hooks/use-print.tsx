"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { PrintMedium } from "@/lib/reports"

const PAGE_RULES: Record<PrintMedium, string> = {
  A4: "@page { size: A4; margin: 14mm; }",
  SLIP80: "@page { size: 80mm auto; margin: 3mm; }",
}

// Prints any content on A4 or an 80 mm slip. The content is rendered into a portal on <body>; while printing,
// globals.css hides everything else, and the page size is set for the chosen medium.
export function usePrint() {
  const [job, setJob] = useState<{ medium: PrintMedium; content: ReactNode } | null>(null)

  useEffect(() => {
    if (!job) return
    const style = document.createElement("style")
    style.textContent = PAGE_RULES[job.medium]
    document.head.appendChild(style)
    document.documentElement.classList.add("printing")
    const cleanup = () => {
      style.remove()
      document.documentElement.classList.remove("printing")
    }
    // Let the portal paint before the print dialog opens; window.print() blocks until it closes.
    const frame = window.requestAnimationFrame(() => {
      window.print()
      cleanup()
      setJob(null)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      cleanup()
    }
  }, [job])

  const print = useCallback((medium: PrintMedium, content: ReactNode) => setJob({ medium, content }), [])

  const portal = job
    ? createPortal(
        <div className="print-portal" data-medium={job.medium}>
          {job.content}
        </div>,
        document.body,
      )
    : null

  return { print, portal }
}
