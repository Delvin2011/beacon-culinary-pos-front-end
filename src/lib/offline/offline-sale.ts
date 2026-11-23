// O4: one offline sale, built on the till. The payload is the contract's sale (docs/2026-11-18-o4-offline-sync-api-
// contract.md, section 3) without tillClockAtSendUtc, which is set when a batch is sent.
//
// - Money is integer cents until the payload is written.
// - A line's lineTotal is unitPrice × quantity WITHOUT its extras; each extra has its own lineTotal
//   (priceDelta × quantity); subtotal and total are the sum of both. No discount offline, so total = subtotal.
// - VAT is O2b's rule on the total at the snapshot's rate.
// - Numbers: offlineSeq per till per trading day; receipt T1-YYYYMMDD-NNNN (≤ 30), collection T1-N (≤ 20).

import { CURRENCY_SYMBOL } from "@/lib/locale"
import { centsToAmount, formatCents, rateToTenThousandths, tenThousandthsToRate, vatIncludedCents } from "@/lib/offline/cents"

export const RECEIPT_NUMBER_MAX_LENGTH = 30
export const COLLECTION_NUMBER_MAX_LENGTH = 20
export const CARD_REFERENCE_MAX_LENGTH = 50
export const MAX_PAYMENTS = 2

// ---- The cart, in cents ----

export interface OfflineCartExtra {
  dailyComponentStockId: number | null
  name: string
  priceDeltaCents: number
  quantity: number
}

export interface OfflineCartLine {
  dailyMealOptionId: number | null
  name: string
  station: string
  unitPriceCents: number
  quantity: number
  extras: OfflineCartExtra[]
}

export interface PricedExtra extends OfflineCartExtra {
  lineTotalCents: number
}

export interface PricedLine extends Omit<OfflineCartLine, "extras"> {
  lineTotalCents: number
  extras: PricedExtra[]
}

export interface PricedCart {
  lines: PricedLine[]
  // Lines and extras together.
  subtotalCents: number
}

export function priceCart(lines: OfflineCartLine[]): PricedCart {
  let subtotalCents = 0
  const priced = lines.map((line) => {
    const lineTotalCents = line.unitPriceCents * line.quantity
    subtotalCents += lineTotalCents
    const extras = line.extras.map((extra) => {
      const extraTotal = extra.priceDeltaCents * extra.quantity
      subtotalCents += extraTotal
      return { ...extra, lineTotalCents: extraTotal }
    })
    return { ...line, lineTotalCents, extras }
  })
  return { lines: priced, subtotalCents }
}

// ---- Payments ----

export type OfflinePaymentDraft =
  | { method: "CASH"; amountCents: number; tenderedCents: number }
  // cardReference null only for a stuck online card sale whose cashier has no slip (the server flags it).
  | { method: "CARD"; amountCents: number; cardReference: string | null }
  | { method: "ACCOUNT"; amountCents: number; accountId: number }

export type PaymentProblem =
  | "NO_PAYMENT"
  | "TOO_MANY_PAYMENTS"
  | "ACCOUNT_COMBINED"
  | "ACCOUNTS_DISABLED"
  | "AMOUNT_NOT_POSITIVE"
  | "PAYMENTS_DONT_ADD_UP"
  | "CASH_SHORT"
  | "CARD_REFERENCE_MISSING"
  | "CARD_REFERENCE_TOO_LONG"

export const PAYMENT_PROBLEM_MESSAGES: Record<PaymentProblem, string> = {
  NO_PAYMENT: "Add a payment.",
  TOO_MANY_PAYMENTS: `At most ${MAX_PAYMENTS} payments per sale.`,
  ACCOUNT_COMBINED: "An account payment can't be combined with another payment.",
  ACCOUNTS_DISABLED: "Account sales aren't available offline on this till.",
  AMOUNT_NOT_POSITIVE: "Each payment must be more than R0.00.",
  PAYMENTS_DONT_ADD_UP: "The payments must add up to the total.",
  CASH_SHORT: "The cash tendered must cover the amount.",
  CARD_REFERENCE_MISSING: "Enter the card slip reference.",
  CARD_REFERENCE_TOO_LONG: `The card slip reference can be at most ${CARD_REFERENCE_MAX_LENGTH} characters.`,
}

export interface PaymentRules {
  accountsEnabled: boolean
  // A stuck online card sale whose cashier has no slip: allowed without a reference (D8's only exception).
  allowMissingCardReference?: boolean
}

// The online split rules (at most 2 payments, ACCOUNT on its own) plus the offline ones (cash covers the amount,
// card slip reference). Null when the payments are fine.
export function paymentProblem(totalCents: number, payments: OfflinePaymentDraft[], rules: PaymentRules): PaymentProblem | null {
  if (payments.length === 0) return "NO_PAYMENT"
  if (payments.length > MAX_PAYMENTS) return "TOO_MANY_PAYMENTS"
  const hasAccount = payments.some((payment) => payment.method === "ACCOUNT")
  if (hasAccount && payments.length > 1) return "ACCOUNT_COMBINED"
  if (hasAccount && !rules.accountsEnabled) return "ACCOUNTS_DISABLED"
  for (const payment of payments) {
    if (!Number.isInteger(payment.amountCents) || payment.amountCents <= 0) return "AMOUNT_NOT_POSITIVE"
    if (payment.method === "CASH" && !(payment.tenderedCents >= payment.amountCents)) return "CASH_SHORT"
    if (payment.method === "CARD") {
      const reference = payment.cardReference?.trim() ?? ""
      if (!reference && !rules.allowMissingCardReference) return "CARD_REFERENCE_MISSING"
      if (reference.length > CARD_REFERENCE_MAX_LENGTH) return "CARD_REFERENCE_TOO_LONG"
    }
  }
  const paid = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
  return paid === totalCents ? null : "PAYMENTS_DONT_ADD_UP"
}

// Change is exactly tendered − amount.
export function changeDueCents(payment: { amountCents: number; tenderedCents: number }): number {
  return payment.tenderedCents - payment.amountCents
}

// The account's offline charges under this grant, this one included, may not pass the cap (decision A). Null when
// allowed; otherwise the refusal, with the cap as the grant or snapshot gave it.
export function accountCapMessage(capCents: number | null, alreadyChargedCents: number, chargeCents: number): string | null {
  if (capCents === null) return null
  if (alreadyChargedCents + chargeCents <= capCents) return null
  return `Account limit for offline sales reached (${CURRENCY_SYMBOL}${formatCents(capCents)}).`
}

// ---- Numbers ----

export interface SeqState {
  nextOfflineSeq: number
  tradingDay: string
}

// The larger of the till's own next number and the grant's, each counted only on its own trading day.
export function chooseOfflineSeq(stored: SeqState | null, grant: SeqState, tradingDay: string): number {
  const local = stored && stored.tradingDay === tradingDay ? stored.nextOfflineSeq : 1
  const fromGrant = grant.tradingDay === tradingDay ? grant.nextOfflineSeq : 1
  return Math.max(1, local, fromGrant)
}

// "T1", "2026-11-18", 7 → "T1-20261118-0007". Null when it wouldn't fit the contract's 30 characters.
export function offlineReceiptNumber(tillCode: string, tradingDay: string, seq: number): string | null {
  const number = `${tillCode}-${tradingDay.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`
  return number.length <= RECEIPT_NUMBER_MAX_LENGTH ? number : null
}

// "T1", 7 → "T1-7". Null when longer than 20 characters.
export function offlineCollectionNumber(tillCode: string, seq: number): string | null {
  const number = `${tillCode}-${seq}`
  return number.length <= COLLECTION_NUMBER_MAX_LENGTH ? number : null
}

// ---- The payload (contract section 3) ----

export interface OfflineSaleExtraPayload {
  dailyComponentStockId: number | null
  name: string
  priceDelta: number
  quantity: number
  lineTotal: number
}

export interface OfflineSaleLinePayload {
  dailyMealOptionId: number | null
  name: string
  station: string
  quantity: number
  unitPrice: number
  lineTotal: number
  extras: OfflineSaleExtraPayload[]
}

export type OfflineSalePaymentPayload =
  | { method: "CASH"; amount: number; amountTendered: number; changeDue: number }
  | { method: "CARD"; amount: number; cardReference?: string }
  | { method: "ACCOUNT"; amount: number; accountId: number }

export interface OfflineSalePayload {
  clientOrderId: string
  grantId: string
  offlineSeq: number
  offlineReceiptNumber: string
  collectionNumber: string
  soldAt: string
  shiftId: number
  cashierId: number
  unlockedOffline: boolean
  snapshotVersion: string
  lines: OfflineSaleLinePayload[]
  subtotal: number
  total: number
  vatRate: number
  vatIncludedAmount: number
  payments: OfflineSalePaymentPayload[]
}

export interface OfflineSaleInput {
  clientOrderId: string
  grant: { grantId: string; shiftId: number; cashierId: number }
  tillCode: string
  tradingDay: string
  offlineSeq: number
  soldAt: string
  unlockedOffline: boolean
  snapshotVersion: string
  vatRate: number
  lines: OfflineCartLine[]
  payments: OfflinePaymentDraft[]
  rules: PaymentRules
}

export type CartProblem = "NO_LINES" | "BAD_QUANTITY" | "BAD_PRICE" | "BAD_VAT_RATE" | "NUMBER_TOO_LONG"

export const CART_PROBLEM_MESSAGES: Record<CartProblem, string> = {
  NO_LINES: "Add an item to the order.",
  BAD_QUANTITY: "Each item needs a quantity of at least 1.",
  BAD_PRICE: "An item has no valid price in the offline menu.",
  BAD_VAT_RATE: "The offline menu has no valid VAT rate. Reconnect to keep selling.",
  NUMBER_TOO_LONG: "This till's code is too long for offline receipt numbers.",
}

export type BuildResult =
  | { ok: true; sale: OfflineSalePayload; totalCents: number; vatCents: number }
  | { ok: false; problem: CartProblem | PaymentProblem; message: string }

function cartProblem(lines: OfflineCartLine[]): CartProblem | null {
  if (lines.length === 0) return "NO_LINES"
  for (const line of lines) {
    const items = [line, ...line.extras]
    if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) return "BAD_QUANTITY"
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) return "BAD_PRICE"
    if (line.extras.some((extra) => !Number.isInteger(extra.priceDeltaCents) || extra.priceDeltaCents < 0)) return "BAD_PRICE"
  }
  return null
}

function paymentPayload(payment: OfflinePaymentDraft): OfflineSalePaymentPayload {
  switch (payment.method) {
    case "CASH":
      return {
        method: "CASH",
        amount: centsToAmount(payment.amountCents),
        amountTendered: centsToAmount(payment.tenderedCents),
        changeDue: centsToAmount(changeDueCents(payment)),
      }
    case "CARD": {
      const reference = payment.cardReference?.trim()
      return reference ? { method: "CARD", amount: centsToAmount(payment.amountCents), cardReference: reference } : { method: "CARD", amount: centsToAmount(payment.amountCents) }
    }
    case "ACCOUNT":
      return { method: "ACCOUNT", amount: centsToAmount(payment.amountCents), accountId: payment.accountId }
  }
}

const fail = (problem: CartProblem | PaymentProblem): BuildResult => ({
  ok: false,
  problem,
  message: problem in CART_PROBLEM_MESSAGES ? CART_PROBLEM_MESSAGES[problem as CartProblem] : PAYMENT_PROBLEM_MESSAGES[problem as PaymentProblem],
})

// The sale as it will be recorded and sent. Checks the cart and payments; the account cap is checked by the
// outbox, which knows what the account has already been charged under this grant.
export function buildOfflineSale(input: OfflineSaleInput): BuildResult {
  const linesProblem = cartProblem(input.lines)
  if (linesProblem) return fail(linesProblem)
  const rate = rateToTenThousandths(input.vatRate)
  if (rate === null || rate < 0) return fail("BAD_VAT_RATE")

  const cart = priceCart(input.lines)
  const totalCents = cart.subtotalCents
  const problem = paymentProblem(totalCents, input.payments, input.rules)
  if (problem) return fail(problem)

  const receiptNumber = offlineReceiptNumber(input.tillCode, input.tradingDay, input.offlineSeq)
  const collectionNumber = offlineCollectionNumber(input.tillCode, input.offlineSeq)
  if (!receiptNumber || !collectionNumber) return fail("NUMBER_TOO_LONG")

  const vatCents = vatIncludedCents(totalCents, rate)
  const sale: OfflineSalePayload = {
    clientOrderId: input.clientOrderId,
    grantId: input.grant.grantId,
    offlineSeq: input.offlineSeq,
    offlineReceiptNumber: receiptNumber,
    collectionNumber,
    soldAt: input.soldAt,
    shiftId: input.grant.shiftId,
    cashierId: input.grant.cashierId,
    unlockedOffline: input.unlockedOffline,
    snapshotVersion: input.snapshotVersion,
    lines: cart.lines.map((line) => ({
      dailyMealOptionId: line.dailyMealOptionId,
      name: line.name,
      station: line.station,
      quantity: line.quantity,
      unitPrice: centsToAmount(line.unitPriceCents),
      lineTotal: centsToAmount(line.lineTotalCents),
      extras: line.extras.map((extra) => ({
        dailyComponentStockId: extra.dailyComponentStockId,
        name: extra.name,
        priceDelta: centsToAmount(extra.priceDeltaCents),
        quantity: extra.quantity,
        lineTotal: centsToAmount(extra.lineTotalCents),
      })),
    })),
    subtotal: centsToAmount(totalCents),
    total: centsToAmount(totalCents),
    vatRate: tenThousandthsToRate(rate),
    vatIncludedAmount: centsToAmount(vatCents),
    payments: input.payments.map(paymentPayload),
  }
  return { ok: true, sale, totalCents, vatCents }
}
