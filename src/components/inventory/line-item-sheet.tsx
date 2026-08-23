"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocations } from "@/hooks/use-locations";
import { IngredientSearchSelect } from "@/components/inventory/ingredient-search-select";
import type {
  IngredientOption,
  LineItemColumnConfig,
  LineItemHeaderField,
  LineItemRow,
  LineItemSheetSubmitPayload,
} from "@/components/inventory/line-item-sheet-types";

function emptyRow(index: number): LineItemRow {
  return {
    clientId: `row-${Date.now()}-${index}`,
    ingredientId: null,
    ingredientName: "",
    unit: null,
    unitValue: "",
    quantity: "",
    reason: "",
    purchaseOrderLineId: null,
    quantityOrdered: null,
  };
}

function varianceClassName(variance: number): string {
  if (variance < 0) return "font-medium text-rose-700";
  if (variance > 0) return "font-medium text-emerald-700";
  return "font-medium";
}

interface LineItemSheetProps {
  title: string;
  requestType: string;
  locationCount: 0 | 1 | 2;
  locationLabels?: string[];
  defaultLocationNameByIndex?: (string | undefined)[];
  extraFieldsConfig?: LineItemHeaderField[];
  columnConfig: LineItemColumnConfig;
  ingredientOptions: IngredientOption[];
  requestedByName: string;
  submitLabel?: string;
  onSubmit: (payload: LineItemSheetSubmitPayload) => Promise<void>;
  renderAboveLines?: (ctx: {
    rows: LineItemRow[];
    addRow: (prefill?: Partial<LineItemRow>) => void;
  }) => ReactNode;
}

export function LineItemSheet({
  title,
  requestType,
  locationCount,
  locationLabels,
  defaultLocationNameByIndex,
  extraFieldsConfig = [],
  columnConfig,
  ingredientOptions,
  requestedByName,
  submitLabel = "Submit",
  onSubmit,
  renderAboveLines,
}: LineItemSheetProps) {
  const { locations, loading: locationsLoading } = useLocations();
  const [rows, setRows] = useState<LineItemRow[]>([emptyRow(0)]);
  const [locationIds, setLocationIds] = useState<(number | null)[]>(
    Array.from({ length: locationCount }, () => null),
  );
  const [locationsInitialised, setLocationsInitialised] = useState(false);
  const [extraFieldValues, setExtraFieldValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdAt] = useState(() => new Date());

  if (!locationsInitialised && locations.length > 0 && defaultLocationNameByIndex) {
    const defaults = locationIds.map((current, index) => {
      if (current !== null) return current;
      const wantedName = defaultLocationNameByIndex[index];
      const match = wantedName ? locations.find((location) => location.name === wantedName) : undefined;
      return match?.id ?? null;
    });
    setLocationIds(defaults);
    setLocationsInitialised(true);
  }

  const addRow = (prefill?: Partial<LineItemRow>) => {
    setRows((prev) => [...prev, { ...emptyRow(prev.length), ...prefill }]);
  };

  const updateRow = (clientId: string, patch: Partial<LineItemRow>) => {
    setRows((prev) => prev.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)));
  };

  const removeRow = (clientId: string) => {
    setRows((prev) => prev.filter((row) => row.clientId !== clientId));
  };

  const lineValue = (row: LineItemRow): number | null => {
    const quantity = Number(row.quantity);
    const unitValue = row.unitValue.trim() === "" ? null : Number(row.unitValue);
    if (unitValue === null || !Number.isFinite(unitValue) || !Number.isFinite(quantity)) return null;
    return quantity * unitValue;
  };

  const variance = (row: LineItemRow): number | null => {
    const received = Number(row.quantity);
    if (row.quantityOrdered === null || row.quantityOrdered === undefined || !Number.isFinite(received)) {
      return null;
    }
    return received - row.quantityOrdered;
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const quantity = Number(row.quantity);
        const value = lineValue(row);
        if (row.ingredientId !== null && Number.isFinite(quantity) && quantity > 0) {
          acc.quantity += quantity;
        }
        if (value !== null) acc.value += value;
        return acc;
      },
      { quantity: 0, value: 0 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const handleSubmit = async () => {
    setError(null);

    if (locationIds.some((id) => id === null)) {
      setError("Select a location for every configured location field.");
      return;
    }

    for (const field of extraFieldsConfig) {
      if (field.required && !extraFieldValues[field.key]?.trim()) {
        setError(`${field.label} is required.`);
        return;
      }
    }

    const completeRows = rows.filter((row) => row.ingredientId !== null && row.quantity.trim() !== "");

    if (completeRows.length === 0) {
      setError("Add at least one complete line item.");
      return;
    }

    for (const row of completeRows) {
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`Enter a valid quantity for ${row.ingredientName}.`);
        return;
      }
      if (columnConfig.reasonRequirement === "required" && !row.reason.trim()) {
        setError(`Reason is required for ${row.ingredientName}.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({
        requestType,
        locationIds: locationIds.filter((id): id is number => id !== null),
        extraFields: extraFieldValues,
        lines: completeRows.map((row) => ({
          ingredientId: row.ingredientId as number,
          quantity: Number(row.quantity),
          reason: row.reason.trim(),
          unitValue: row.unitValue.trim() === "" ? null : Number(row.unitValue),
          purchaseOrderLineId: row.purchaseOrderLineId ?? null,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit.");
    } finally {
      setSubmitting(false);
    }
  };

  const quantityMode = columnConfig.quantityMode;
  const isOrderedReceived = quantityMode.kind === "orderedReceived";
  const showVarianceColumn = isOrderedReceived && quantityMode.showVariance;
  const receivedLabel = isOrderedReceived ? quantityMode.receivedLabel : quantityMode.kind === "single" ? quantityMode.label : "Qty";
  const unitValueLabel = columnConfig.unitValueLabel ?? "Unit Value";
  const columnCount =
    3 + // Item, UoM, Unit Value
    (isOrderedReceived ? 1 : 0) + // Ordered
    1 + // Received/Qty
    (showVarianceColumn ? 1 : 0) +
    (columnConfig.showLineValue ? 1 : 0) +
    (columnConfig.reasonRequirement !== "hidden" ? 1 : 0) +
    1; // Remove

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>

      <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-3">
        <div className="space-y-1">
          <Label>Sheet No.</Label>
          <p className="text-sm text-muted-foreground">Pending — assigned on submit</p>
        </div>
        <div className="space-y-1">
          <Label>Date / Time</Label>
          <p className="text-sm text-muted-foreground">{createdAt.toLocaleString()}</p>
        </div>
        <div className="space-y-1">
          <Label>Requested By</Label>
          <p className="text-sm text-muted-foreground">{requestedByName}</p>
        </div>

        {Array.from({ length: locationCount }).map((_, index) => (
          <div className="space-y-1" key={index}>
            <Label>{locationLabels?.[index] ?? "Location"}</Label>
            <Select
              value={locationIds[index] !== null ? String(locationIds[index]) : ""}
              onValueChange={(value) =>
                setLocationIds((prev) => prev.map((id, i) => (i === index ? Number(value) : id)))
              }
              disabled={locationsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a location…" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={String(location.id)}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

        {extraFieldsConfig.map((field) => (
          <div className="space-y-1" key={field.key}>
            <Label>{field.label}</Label>
            {field.kind === "select" ? (
              <Select
                value={extraFieldValues[field.key] ?? ""}
                onValueChange={(value) => setExtraFieldValues((prev) => ({ ...prev, [field.key]: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}…`} />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={extraFieldValues[field.key] ?? ""}
                onChange={(event) =>
                  setExtraFieldValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
              />
            )}
          </div>
        ))}
      </div>

      {renderAboveLines?.({ rows, addRow })}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Line Items</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => addRow()}>
            + Add Item
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>UoM</TableHead>
              <TableHead>{unitValueLabel}</TableHead>
              {isOrderedReceived && <TableHead>Ordered</TableHead>}
              <TableHead>{receivedLabel}</TableHead>
              {showVarianceColumn && <TableHead>Receipt Variance</TableHead>}
              {columnConfig.showLineValue && <TableHead>Line Value</TableHead>}
              {columnConfig.reasonRequirement !== "hidden" && <TableHead>{columnConfig.reasonLabel ?? "Reason"}</TableHead>}
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-6 text-center text-sm text-muted-foreground">
                  No line items yet. Click &quot;+ Add Item&quot; to start.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const value = lineValue(row);
                const rowVariance = variance(row);
                return (
                  <TableRow key={row.clientId}>
                    <TableCell className="min-w-[200px]">
                      <IngredientSearchSelect
                        options={ingredientOptions}
                        value={row.ingredientId}
                        onSelect={(ingredient) =>
                          updateRow(row.clientId, {
                            ingredientId: ingredient.id,
                            ingredientName: ingredient.name,
                            unit: ingredient.unit,
                            unitValue: ingredient.unitValue !== null ? String(ingredient.unitValue) : "",
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>{row.unit ?? "—"}</TableCell>
                    <TableCell>
                      {columnConfig.unitValueEditable ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.unitValue}
                          onChange={(event) => updateRow(row.clientId, { unitValue: event.target.value })}
                          className="w-24"
                        />
                      ) : row.unitValue.trim() !== "" ? (
                        Number(row.unitValue).toFixed(2)
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {isOrderedReceived && (
                      <TableCell>
                        {row.quantityOrdered !== null && row.quantityOrdered !== undefined
                          ? row.quantityOrdered
                          : "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <Input
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={row.quantity}
                        onChange={(event) => updateRow(row.clientId, { quantity: event.target.value })}
                        className="w-28"
                      />
                    </TableCell>
                    {showVarianceColumn && (
                      <TableCell>
                        {rowVariance !== null ? (
                          <span className={varianceClassName(rowVariance)}>
                            {rowVariance > 0 ? "+" : ""}
                            {rowVariance}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    )}
                    {columnConfig.showLineValue && (
                      <TableCell>{value !== null ? value.toFixed(2) : "—"}</TableCell>
                    )}
                    {columnConfig.reasonRequirement !== "hidden" && (
                      <TableCell>
                        <Input
                          value={row.reason}
                          onChange={(event) => updateRow(row.clientId, { reason: event.target.value })}
                          placeholder={columnConfig.reasonRequirement === "required" ? "Required" : "Optional"}
                          className="min-w-[160px]"
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Button type="button" variant="outline" size="sm" onClick={() => removeRow(row.clientId)}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableBody>
              <TableRow className="font-medium">
                <TableCell colSpan={3}>Totals</TableCell>
                {isOrderedReceived && <TableCell />}
                <TableCell>{totals.quantity.toFixed(4)}</TableCell>
                {showVarianceColumn && <TableCell />}
                {columnConfig.showLineValue && <TableCell>{totals.value.toFixed(2)}</TableCell>}
                {columnConfig.reasonRequirement !== "hidden" && <TableCell />}
                <TableCell />
              </TableRow>
            </TableBody>
          )}
        </Table>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="w-full">
        {submitting ? "Submitting…" : submitLabel}
      </Button>
    </div>
  );
}
