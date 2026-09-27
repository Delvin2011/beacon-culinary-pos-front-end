"use client";

import { Delete } from "lucide-react";

interface NumericKeypadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
  size?: "default" | "compact";
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
  size = "default",
}: NumericKeypadProps) {
  const compact = size === "compact";

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
    <div className={`grid grid-cols-3 w-full ${compact ? "gap-2 max-w-[15rem]" : "gap-3 max-w-xs"}`}>
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
            className={`flex w-full items-center justify-center bg-white/10 font-semibold text-white transition-colors hover:bg-white/20 active:scale-95 active:bg-white/30 disabled:pointer-events-none disabled:opacity-40 select-none ${
              compact ? "h-14 rounded-xl text-xl" : "h-[72px] rounded-2xl text-2xl"
            }`}
          >
            {key === "backspace" ? <Delete className="h-6 w-6" /> : key}
          </button>
        );
      })}
    </div>
  );
}
