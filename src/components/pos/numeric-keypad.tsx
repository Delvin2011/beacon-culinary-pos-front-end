"use client";

import { Delete } from "lucide-react";

interface NumericKeypadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

const KEYS = [
  "1", "2", "3",
  "4", "5", "6",
  "7", "8", "9",
  "", "0", "backspace",
] as const;

type KeyValue = (typeof KEYS)[number];

export function NumericKeypad({
  value,
  onChange,
  maxLength,
  disabled = false,
}: NumericKeypadProps) {
  const handleKey = (key: KeyValue) => {
    if (disabled || key === "") return;

    if (key === "backspace") {
      onChange(value.slice(0, -1));
      return;
    }

    if (maxLength !== undefined && value.length >= maxLength) return;
    onChange(value + key);
  };

  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
      {KEYS.map((key, i) => {
        if (key === "") {
          return <div key={i} aria-hidden />;
        }

        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => handleKey(key)}
            className="flex h-[72px] w-full items-center justify-center rounded-2xl bg-white/10 text-2xl font-semibold text-white transition-colors hover:bg-white/20 active:scale-95 active:bg-white/30 disabled:pointer-events-none disabled:opacity-40 select-none"
          >
            {key === "backspace" ? <Delete className="h-6 w-6" /> : key}
          </button>
        );
      })}
    </div>
  );
}
