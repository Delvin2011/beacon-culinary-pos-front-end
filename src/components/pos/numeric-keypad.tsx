"use client";

import { Delete } from "lucide-react";

interface NumericKeypadProps {
  value: string;
  onChange: (value: string) => void;
  // In decimal mode this limits the digits before the separator.
  maxLength?: number;
  disabled?: boolean;
  // "small" fits keypads into dialogs with limited height.
  size?: "default" | "compact" | "small";
  // Money entry: shows a "," key and emits values like "12.5" (at most 2 decimals, no leading zeros).
  decimal?: boolean;
}

const KEYS = [
  "1", "2", "3",
  "4", "5", "6",
  "7", "8", "9",
  "", "0", "backspace",
] as const;

type KeyValue = (typeof KEYS)[number] | "separator";

const MAX_DECIMALS = 2;

export function NumericKeypad({
  value,
  onChange,
  maxLength,
  disabled = false,
  size = "default",
  decimal = false,
}: NumericKeypadProps) {
  const gridClass = {
    default: "gap-3 max-w-xs",
    compact: "gap-2.5 max-w-[26rem]",
    small: "gap-3 max-w-md",
  }[size];
  const keyClass = {
    default: "h-[72px] rounded-2xl text-2xl",
    compact: "h-16 rounded-xl text-2xl",
    small: "h-16 rounded-xl text-3xl",
  }[size];

  const handleDecimalKey = (key: KeyValue) => {
    const [whole, fraction] = value.split(".");

    if (key === "separator") {
      if (fraction === undefined) onChange((whole || "0") + ".");
      return;
    }

    if (fraction !== undefined) {
      if (fraction.length < MAX_DECIMALS) onChange(value + key);
      return;
    }

    if (maxLength !== undefined && whole.length >= maxLength) return;
    onChange(whole === "0" ? key : value + key);
  };

  const handleKey = (key: KeyValue) => {
    if (disabled || key === "") return;

    if (key === "backspace") {
      onChange(value.slice(0, -1));
      return;
    }

    if (decimal) {
      handleDecimalKey(key);
      return;
    }

    if (maxLength !== undefined && value.length >= maxLength) return;
    onChange(value + key);
  };

  const keys: KeyValue[] = decimal ? KEYS.map((key) => (key === "" ? "separator" : key)) : [...KEYS];

  return (
    <div className={`grid grid-cols-3 w-full ${gridClass}`}>
      {keys.map((key, i) => {
        if (key === "") {
          return <div key={i} aria-hidden />;
        }

        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => handleKey(key)}
            aria-label={key === "separator" ? "Decimal comma" : key === "backspace" ? "Backspace" : undefined}
            className={`flex w-full items-center justify-center bg-white/10 font-semibold text-white transition-colors hover:bg-white/20 active:scale-95 active:bg-white/30 disabled:pointer-events-none disabled:opacity-40 select-none ${keyClass}`}
          >
            {key === "backspace" ? <Delete className="h-6 w-6" /> : key === "separator" ? "," : key}
          </button>
        );
      })}
    </div>
  );
}
