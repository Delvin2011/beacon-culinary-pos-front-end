export type IngredientUnit = "KG" | "LITRE" | "EACH";

export type QuantityMode =
  | { kind: "single"; label: string }
  // Stock Take: Expected is fetched live per-row from the sheet's location the moment an
  // ingredient is selected (never user-typed); Actual is entered; Variance Qty/Value are
  // computed live and always shown for this mode (no separate toggle, unlike orderedReceived).
  | { kind: "expectedActual"; expectedLabel: string; actualLabel: string }
  // GRV: Ordered is a read-only reference figure (blank unless PO-linked), Received is entered,
  // Variance (received - ordered) is computed live and blank whenever Ordered is blank.
  | { kind: "orderedReceived"; receivedLabel: string; showVariance: boolean };

export type ReasonRequirement = "required" | "optional" | "hidden";

export interface LineItemColumnConfig {
  reasonRequirement: ReasonRequirement;
  quantityMode: QuantityMode;
  showLineValue: boolean;
  // GRV needs Unit Cost to be freely entered (it's what's being recorded this delivery), not
  // auto-filled read-only the way Issue's Unit Value is. Defaults to false (today's behavior).
  unitValueEditable?: boolean;
  unitValueLabel?: string;
  reasonLabel?: string;
  // Stock Take: a physical count of exactly zero is a legitimate, important result (an
  // ingredient that's completely out), not an incomplete row. Defaults to false everywhere
  // else — Issue/Waste/Order/GRV quantities of zero don't make sense.
  allowZeroQuantity?: boolean;
  // expectedActual mode only. Defaults to true. Set false so a clerk counts blind — Unit Value,
  // Expected Qty, Variance Qty, and Variance Value all stay hidden on submission (a clerk who
  // can see the expected figure while entering their count can just match it, defeating the
  // point of a physical count); the admin review screen shows all four regardless.
  revealExpectedAndVariance?: boolean;
}

export interface LineItemHeaderField {
  key: string;
  label: string;
  kind: "text-input" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
}

export interface IngredientOption {
  id: number;
  name: string;
  unit: IngredientUnit;
  unitValue: number | null;
  itemCode: string | null;
}

export interface LineItemRow {
  clientId: string;
  ingredientId: number | null;
  ingredientName: string;
  unit: IngredientUnit | null;
  unitValue: string;
  quantity: string;
  reason: string;
  // Only meaningful for orderedReceived mode, and only set when the row originated from a
  // PO-line picker (see LineItemSheet's renderAboveLines) — stays null/undefined for ad-hoc rows.
  purchaseOrderLineId?: number | null;
  quantityOrdered?: number | null;
  // expectedActual mode only — fetched live from the sheet's location when an ingredient is
  // selected (see LineItemSheet's fetchExpectedQuantity prop), re-fetched if the location changes.
  expectedQuantity?: number | null;
  expectedQuantityLoading?: boolean;
}

export interface LineItemSubmitLine {
  ingredientId: number;
  quantity: number;
  reason: string;
  unitValue: number | null;
  purchaseOrderLineId?: number | null;
}

export interface LineItemSheetSubmitPayload {
  requestType: string;
  locationIds: number[];
  extraFields: Record<string, string>;
  lines: LineItemSubmitLine[];
}

export interface ReviewLine {
  lineId: number;
  ingredientId: number;
  ingredientName: string;
  unit: IngredientUnit;
  unitValue: number | null;
  requestedQuantity: number;
  actionedQuantity: string;
  reason: string;
}

export interface ActionedLine {
  ingredientId: number;
  actionedQuantity: number;
}
