"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type {
  ActionedLine,
  LineItemColumnConfig,
  LineItemHeaderField,
  ReviewLine,
} from "@/components/inventory/line-item-sheet-types";

interface LineItemSheetReviewProps {
  title: string;
  headerInfo: { label: string; value: string }[];
  extraFieldsConfig?: LineItemHeaderField[];
  columnConfig: LineItemColumnConfig;
  lines: ReviewLine[];
  capLabel?: string;
  capRule?: (line: ReviewLine) => number | undefined;
  approveLabel?: string;
  onApprove: (payload: { lines: ActionedLine[]; extraFields: Record<string, string> }) => Promise<void>;
}

export function LineItemSheetReview({
  title,
  headerInfo,
  extraFieldsConfig = [],
  columnConfig,
  lines,
  capLabel,
  capRule,
  approveLabel = "Approve",
  onApprove,
}: LineItemSheetReviewProps) {
  const [actionedQuantities, setActionedQuantities] = useState<Record<number, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.lineId, String(line.requestedQuantity)])),
  );
  const [extraFieldValues, setExtraFieldValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateActionedQuantity = (line: ReviewLine, rawValue: string) => {
    const cap = capRule?.(line);
    const parsed = Number(rawValue);
    if (cap !== undefined && Number.isFinite(parsed) && parsed > cap) {
      setActionedQuantities((prev) => ({ ...prev, [line.lineId]: String(cap) }));
      return;
    }
    setActionedQuantities((prev) => ({ ...prev, [line.lineId]: rawValue }));
  };

  const lineValue = (line: ReviewLine): number | null => {
    const quantity = Number(actionedQuantities[line.lineId]);
    if (line.unitValue === null || !Number.isFinite(quantity)) return null;
    return quantity * line.unitValue;
  };

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const quantity = Number(actionedQuantities[line.lineId]);
        const value = lineValue(line);
        if (Number.isFinite(quantity)) acc.quantity += quantity;
        if (value !== null) acc.value += value;
        return acc;
      },
      { quantity: 0, value: 0 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, actionedQuantities]);

  const handleApprove = async () => {
    setError(null);

    for (const field of extraFieldsConfig) {
      if (field.required && !extraFieldValues[field.key]?.trim()) {
        setError(`${field.label} is required.`);
        return;
      }
    }

    const actionedLines: ActionedLine[] = [];
    for (const line of lines) {
      const quantity = Number(actionedQuantities[line.lineId]);
      if (!Number.isFinite(quantity) || quantity < 0) {
        setError(`Enter a valid actioned quantity for ${line.ingredientName}.`);
        return;
      }
      const cap = capRule?.(line);
      if (cap !== undefined && quantity > cap) {
        setError(`${line.ingredientName} cannot exceed ${cap}.`);
        return;
      }
      actionedLines.push({ ingredientId: line.ingredientId, actionedQuantity: quantity });
    }

    setSubmitting(true);
    try {
      await onApprove({ lines: actionedLines, extraFields: extraFieldValues });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to approve.");
    } finally {
      setSubmitting(false);
    }
  };

  const quantityColumnLabel =
    columnConfig.quantityMode.kind === "single" ? columnConfig.quantityMode.label : "Actioned Qty";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>

      <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-3">
        {headerInfo.map((item) => (
          <div className="space-y-1" key={item.label}>
            <Label>{item.label}</Label>
            <p className="text-sm text-muted-foreground">{item.value}</p>
          </div>
        ))}

        {extraFieldsConfig.map((field) => (
          <div className="space-y-1" key={field.key}>
            <Label>
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            <Input
              value={extraFieldValues[field.key] ?? ""}
              onChange={(event) =>
                setExtraFieldValues((prev) => ({ ...prev, [field.key]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>UoM</TableHead>
            <TableHead>Unit Value</TableHead>
            <TableHead>Requested</TableHead>
            {capLabel && <TableHead>{capLabel}</TableHead>}
            <TableHead>{quantityColumnLabel}</TableHead>
            {columnConfig.showLineValue && <TableHead>Line Value</TableHead>}
            {columnConfig.reasonRequirement !== "hidden" && (
              <TableHead>{columnConfig.reasonLabel ?? "Reason"}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const value = lineValue(line);
            const cap = capRule?.(line);
            return (
              <TableRow key={line.lineId}>
                <TableCell className="font-medium">{line.ingredientName}</TableCell>
                <TableCell>{line.unit}</TableCell>
                <TableCell>{line.unitValue !== null ? line.unitValue.toFixed(2) : "—"}</TableCell>
                <TableCell>{line.requestedQuantity}</TableCell>
                {capLabel && <TableCell>{cap !== undefined ? cap : "—"}</TableCell>}
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    step="0.0001"
                    max={cap}
                    value={actionedQuantities[line.lineId] ?? ""}
                    onChange={(event) => updateActionedQuantity(line, event.target.value)}
                    className="w-28"
                  />
                </TableCell>
                {columnConfig.showLineValue && (
                  <TableCell>{value !== null ? value.toFixed(2) : "—"}</TableCell>
                )}
                {columnConfig.reasonRequirement !== "hidden" && <TableCell>{line.reason || "—"}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
        {lines.length > 0 && (
          <TableBody>
            <TableRow className="font-medium">
              <TableCell colSpan={capLabel ? 5 : 4}>Totals</TableCell>
              <TableCell>{totals.quantity.toFixed(4)}</TableCell>
              {columnConfig.showLineValue && <TableCell>{totals.value.toFixed(2)}</TableCell>}
              {columnConfig.reasonRequirement !== "hidden" && <TableCell />}
            </TableRow>
          </TableBody>
        )}
      </Table>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" onClick={() => void handleApprove()} disabled={submitting || lines.length === 0} className="w-full">
        {submitting ? "Approving…" : approveLabel}
      </Button>
    </div>
  );
}
