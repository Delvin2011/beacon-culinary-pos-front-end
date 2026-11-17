"use client"

// What must finish before the till can be locked or the shift ended: a payment, a sale being sent or whose outcome
// is unknown (O1), a manager-PIN dialog, the cash-up. Screens report it with useLockBlocker; Lock till, End shift
// and auto-lock read it with useLockBusy and wait.

import { useEffect, useSyncExternalStore } from "react"

const active = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of Array.from(listeners)) listener()
}

export function setLockBlocker(reason: string, on: boolean): void {
  const had = active.has(reason)
  if (on === had) return
  if (on) active.add(reason)
  else active.delete(reason)
  emit()
}

export function isLockBusy(): boolean {
  return active.size > 0
}

export function lockBlockers(): string[] {
  return Array.from(active)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Marks `reason` busy while `on`; cleared on unmount.
export function useLockBlocker(reason: string, on: boolean): void {
  useEffect(() => {
    setLockBlocker(reason, on)
    return () => setLockBlocker(reason, false)
  }, [reason, on])
}

export function useLockBusy(): boolean {
  return useSyncExternalStore(subscribe, isLockBusy, () => false)
}

// Tests only.
export function resetLockBlockers(): void {
  active.clear()
  emit()
}
