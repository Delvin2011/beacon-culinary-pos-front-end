"use client"

// O4 tasks 2 to 4: selling from the snapshot. The order builder keeps its cart and payment editor; this hook adds
// what offline needs: the local portion counts (the snapshot's minus what the outbox sold), the snapshot's accounts
// and cap, and recording a sale (checks, one IndexedDB transaction, then the local order to print).

import { useCallback, useMemo } from "react"
import { notifyOutboxChanged, useOutbox } from "@/contexts/outbox-context"
import { useOffline } from "@/contexts/offline-context"
import { useAuth } from "@/hooks/use-auth"
import { useOfflineSelling } from "@/hooks/use-offline-selling"
import { newRequestId } from "@/lib/pending-sale"
import { toCents } from "@/lib/offline/cents"
import type { SnapshotAccount } from "@/lib/offline/contract"
import { getMeta, getOfflineSeq } from "@/lib/offline/db"
import {
  buildOfflineSale,
  chooseOfflineSeq,
  type OfflineCartLine,
  type OfflinePaymentDraft,
} from "@/lib/offline/offline-sale"
import { offlineReceiptOrder } from "@/lib/offline/offline-receipt"
import { getOutboxEntry, recordOfflineSale, remainingAfter, soldSinceSnapshot, type NewOutboxEntry } from "@/lib/offline/outbox"
import { offlineElapsedMs, offlineLimits } from "@/lib/offline/readiness"
import { STOP_MESSAGES, stopReason } from "@/lib/offline/selling-state"
import { serverNow } from "@/lib/offline/server-time"
import type { ReceiptOrder } from "@/lib/receipt"

// The builder's cart line and payment entry, in its own (decimal) amounts.
export interface CheckoutLine {
  dailyMealOptionId: number
  name: string
  unitPrice: number
  quantity: number
  extras: Array<{ dailyComponentStockId: number; name: string; extraPrice: number; quantity: number }>
}

export interface CheckoutPayment {
  method: "CASH" | "CARD" | "ACCOUNT"
  amount: number
  amountTendered?: number
  cardReference?: string | null
  accountId?: number
}

export type OfflineRecordResult =
  // alreadyRecorded: a stuck sale already in the outbox (e.g. the page closed after writing it): only clear O1's record.
  | { ok: true; clientOrderId: string; order: ReceiptOrder; alreadyRecorded?: boolean }
  | { ok: false; message: string }

export interface RecordOptions {
  // O4 (H): a stuck online sale. Same clientOrderId, its confirm time as soldAt, printed "was pending online".
  // The money was already taken, so the local counts and the account cap don't refuse it; its account charge
  // still counts against the cap for later sales. Without a card slip, the server raises CARD_REFERENCE_MISSING.
  stuck?: { clientOrderId: string; soldAt: string; allowMissingCardReference: boolean }
}

export const SAVE_FAILED_MESSAGE = "This sale couldn't be saved on the till, so it isn't complete. Try Confirm again."
const NOT_SELLING_MESSAGE = "This till can't sell offline right now."
const SEQ_ATTEMPTS = 3

const fail = (message: string): OfflineRecordResult => ({ ok: false, message })

export function useOfflineCheckout() {
  const { grant, snapshot, tillStatus } = useOffline()
  const { user } = useAuth()
  const { entries } = useOutbox()
  const { selling } = useOfflineSelling()

  const sold = useMemo(() => (snapshot ? soldSinceSnapshot(entries, snapshot) : null), [entries, snapshot])

  // The local count for a tile: null = no limit; never below 0 (D4).
  const optionRemaining = useCallback(
    (optionId: number, snapshotRemaining: number | null): number | null => remainingAfter(snapshotRemaining, sold?.options.get(optionId) ?? 0),
    [sold],
  )
  const extraRemaining = useCallback(
    (extraId: number, snapshotRemaining: number | null): number | null => remainingAfter(snapshotRemaining, sold?.extras.get(extraId) ?? 0),
    [sold],
  )

  // Decision A: account sales offline when both the grant and the snapshot allow them.
  const accountsEnabled = Boolean(grant?.accountsEnabled && snapshot?.accountsEnabled)
  const accounts = useMemo<SnapshotAccount[]>(() => (accountsEnabled ? snapshot?.accounts ?? [] : []), [accountsEnabled, snapshot])
  const accountCap = grant?.accountCap ?? snapshot?.accountCap ?? null

  const record = useCallback(
    async (lines: CheckoutLine[], payments: CheckoutPayment[], options: RecordOptions = {}): Promise<OfflineRecordResult> => {
      const { stuck } = options
      if (selling.kind !== "selling" || !grant || !snapshot) return fail(NOT_SELLING_MESSAGE)

      // A stuck sale already in the outbox: nothing to write or print again.
      if (stuck) {
        const existing = await getOutboxEntry(stuck.clientOrderId)
        if (existing) return { ok: true, clientOrderId: existing.clientOrderId, order: offlineReceiptOrder(existing), alreadyRecorded: true }
      }
      const tillCode = grant.tillCode ?? tillStatus?.tillCode ?? null
      if (!grant.grantId || !tillCode) return fail(NOT_SELLING_MESSAGE)

      // The stops again, at this moment (the banner's state can be up to 30 s old).
      const now = serverNow()
      const offlineSince = await getMeta("offlineSince")
      const stop = stopReason({
        elapsedMs: offlineElapsedMs(offlineSince, now),
        grant,
        snapshot,
        now,
        limits: offlineLimits({ tillStatus, grant, snapshot }),
      })
      if (stop) return fail(STOP_MESSAGES[stop])

      // The cart in cents, with each item's station from the snapshot.
      const cart: OfflineCartLine[] = []
      for (const line of lines) {
        const unitPriceCents = toCents(line.unitPrice)
        if (unitPriceCents === null) return fail("An item has no valid price in the offline menu.")
        const extras = []
        for (const extra of line.extras) {
          const priceDeltaCents = toCents(extra.extraPrice)
          if (priceDeltaCents === null) return fail("An extra has no valid price in the offline menu.")
          extras.push({ dailyComponentStockId: extra.dailyComponentStockId, name: extra.name, priceDeltaCents, quantity: extra.quantity })
        }
        const station = snapshot.options.find((option) => option.id === line.dailyMealOptionId)?.station ?? "NONE"
        cart.push({ dailyMealOptionId: line.dailyMealOptionId, name: line.name, station, unitPriceCents, quantity: line.quantity, extras })
      }

      // D4: never more than the local count. Not for a stuck sale: it was already sold.
      const wanted = new Map<number, { name: string; quantity: number }>()
      const wantedExtras = new Map<number, { name: string; quantity: number }>()
      for (const line of cart) {
        const option = wanted.get(line.dailyMealOptionId!) ?? { name: line.name, quantity: 0 }
        wanted.set(line.dailyMealOptionId!, { ...option, quantity: option.quantity + line.quantity })
        for (const extra of line.extras) {
          const current = wantedExtras.get(extra.dailyComponentStockId!) ?? { name: extra.name, quantity: 0 }
          wantedExtras.set(extra.dailyComponentStockId!, { ...current, quantity: current.quantity + extra.quantity })
        }
      }
      for (const [id, item] of stuck ? [] : Array.from(wanted)) {
        const left = optionRemaining(id, snapshot.options.find((option) => option.id === id)?.portionsRemaining ?? null)
        if (left !== null && item.quantity > left) return fail(left === 0 ? `${item.name} is sold out.` : `Only ${left} ${item.name} left.`)
      }
      for (const [id, item] of stuck ? [] : Array.from(wantedExtras)) {
        const left = extraRemaining(id, snapshot.extras.find((extra) => extra.id === id)?.bufferRemaining ?? null)
        if (left !== null && item.quantity > left) return fail(left === 0 ? `${item.name} is sold out.` : `Only ${left} ${item.name} left.`)
      }

      const drafts: OfflinePaymentDraft[] = []
      for (const payment of payments) {
        const amountCents = toCents(payment.amount)
        if (amountCents === null) return fail("A payment amount isn't valid.")
        if (payment.method === "CASH") drafts.push({ method: "CASH", amountCents, tenderedCents: toCents(payment.amountTendered ?? payment.amount) ?? -1 })
        else if (payment.method === "CARD") drafts.push({ method: "CARD", amountCents, cardReference: payment.cardReference ?? null })
        else drafts.push({ method: "ACCOUNT", amountCents, accountId: payment.accountId ?? -1 })
      }

      const accountNames: Record<number, string> = {}
      for (const account of accounts) accountNames[account.id] = account.name
      const clientOrderId = stuck?.clientOrderId ?? newRequestId()
      const soldAt = stuck?.soldAt ?? new Date(now).toISOString()
      const tradingDay = snapshot.tradingDay
      const accountCapCents = stuck || accountCap === null ? null : toCents(accountCap)

      let seq = chooseOfflineSeq(await getOfflineSeq(), grant, tradingDay)
      for (let attempt = 0; attempt < SEQ_ATTEMPTS; attempt += 1) {
        const built = buildOfflineSale({
          clientOrderId,
          grant: { grantId: grant.grantId, shiftId: grant.shiftId, cashierId: grant.cashierId },
          tillCode,
          tradingDay,
          offlineSeq: seq,
          soldAt,
          // O3 D13: the offline session exists from an offline unlock until the next online sign-in.
          unlockedOffline: user?.offline === true,
          snapshotVersion: snapshot.snapshotVersion,
          vatRate: snapshot.vatRate ?? Number.NaN,
          lines: cart,
          payments: drafts,
          rules: { accountsEnabled, allowMissingCardReference: stuck?.allowMissingCardReference ?? false },
        })
        if (!built.ok) return fail(built.message)

        const entry: NewOutboxEntry = {
          clientOrderId,
          payload: built.sale,
          grant: grant.grant,
          grantId: grant.grantId,
          shiftId: grant.shiftId,
          tradingDay,
          soldAt,
          recordedAt: soldAt,
          wasPendingOnline: Boolean(stuck),
          print: { tillCode, tillName: tillStatus?.tillName ?? null, cashierName: grant.cashierName, accountNames },
        }
        const outcome = await recordOfflineSale(entry, accountCapCents)
        switch (outcome.kind) {
          case "recorded":
            notifyOutboxChanged()
            return { ok: true, clientOrderId, order: offlineReceiptOrder(entry) }
          case "seq-taken":
            seq = outcome.next
            continue
          case "over-cap":
            return fail(outcome.message)
          case "exists":
          case "failed":
            return fail(SAVE_FAILED_MESSAGE)
        }
      }
      return fail(SAVE_FAILED_MESSAGE)
    },
    [selling.kind, grant, snapshot, tillStatus, user?.offline, optionRemaining, extraRemaining, accounts, accountCap, accountsEnabled],
  )

  return { selling, optionRemaining, extraRemaining, accounts, accountsEnabled, accountCap, record }
}
