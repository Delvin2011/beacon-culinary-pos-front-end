import { useContext } from "react";
import { ShiftContext } from "@/contexts/shift-context";

export function useShift() {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error("useShift must be used within a ShiftProvider.");
  return ctx;
}
