// Per-till automatic printing switches, stored in this browser only. Clearing the browser data turns both back on
// (the default); the till setup guide says so.

import { useSyncExternalStore } from "react"

export const PRINT_SETTINGS_KEY = "pos.printSettings"

export interface PrintSettings {
  autoPrintReceipt: boolean
  autoPrintKitchenTicket: boolean
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { autoPrintReceipt: true, autoPrintKitchenTicket: true }

export function loadPrintSettings(): PrintSettings {
  try {
    const raw = localStorage.getItem(PRINT_SETTINGS_KEY)
    if (!raw) return DEFAULT_PRINT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<PrintSettings> | null
    return {
      autoPrintReceipt: typeof parsed?.autoPrintReceipt === "boolean" ? parsed.autoPrintReceipt : true,
      autoPrintKitchenTicket: typeof parsed?.autoPrintKitchenTicket === "boolean" ? parsed.autoPrintKitchenTicket : true,
    }
  } catch {
    return DEFAULT_PRINT_SETTINGS
  }
}

const listeners = new Set<() => void>()
let snapshot: PrintSettings | null = null

export function savePrintSettings(next: PrintSettings): void {
  try {
    localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: the change lasts until the page reloads.
  }
  snapshot = next
  for (const listener of Array.from(listeners)) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): PrintSettings {
  if (!snapshot) snapshot = loadPrintSettings()
  return snapshot
}

// For tests: forget the in-memory copy so the next read comes from storage.
export function resetPrintSettingsSnapshot(): void {
  snapshot = null
}

export function usePrintSettings(): PrintSettings {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PRINT_SETTINGS)
}
