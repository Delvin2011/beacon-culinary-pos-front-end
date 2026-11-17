"use client"

import { usePrintQueue } from "@/hooks/use-print-queue"

// Prints any content on A4, an 80 mm slip or the till's 80 mm receipt paper. Kept for the existing callers
// (reports, shift readings, the admin reprint); it runs on the print queue, so two prints in a row both come out.
export function usePrint() {
  const { print, portal } = usePrintQueue()
  return { print, portal }
}
