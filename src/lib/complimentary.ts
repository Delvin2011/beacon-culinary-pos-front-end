// Complimentary meals: an order a manager authorises with no payment. It still goes to the kitchen and uses stock;
// its list value (preDiscountTotal) is kept so reports can show what was given away. Not a discount.

export type OrderKind = "SALE" | "COMPLIMENTARY";

export type ComplimentaryReasonCode = "STAFF_MEAL" | "MANAGEMENT" | "GUEST" | "TASTING" | "OTHER";

// The one place the reasons and their labels live: checkout form, receipt, order lists and Oversight.
export const COMPLIMENTARY_REASONS: Array<{ value: ComplimentaryReasonCode; label: string }> = [
  { value: "STAFF_MEAL", label: "Staff meal" },
  { value: "MANAGEMENT", label: "Management" },
  { value: "GUEST", label: "Guest" },
  { value: "TASTING", label: "Tasting" },
  { value: "OTHER", label: "Other" },
];

export function complimentaryReasonLabel(code: string): string {
  return COMPLIMENTARY_REASONS.find((reason) => reason.value === code)?.label ?? code.replaceAll("_", " ").toLowerCase();
}

export interface ComplimentaryRequest {
  reasonCode: ComplimentaryReasonCode;
  note?: string;
  // Exactly one of the two.
  authorization: { authorizationToken?: string; sessionToken?: string };
}

export interface OrderComplimentary {
  reasonCode: ComplimentaryReasonCode;
  note: string | null;
  authorizedBy: { id: number; name: string };
}

export function isComplimentary(order: { orderKind?: OrderKind | string | null }): boolean {
  return order.orderKind === "COMPLIMENTARY";
}
