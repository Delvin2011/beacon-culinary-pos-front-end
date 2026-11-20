"use client"

// The input for one site setting, by type. Works on text: the row turns it into the API value only when saving.

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { settingCopy, type SiteSetting } from "@/lib/site-settings"

interface SettingInputProps {
  setting: SiteSetting
  id: string
  text: string
  invalid: boolean
  describedBy?: string
  disabled?: boolean
  onChange: (text: string) => void
}

function Affix({ children }: { children: string }) {
  return <span className="text-sm text-muted-foreground">{children}</span>
}

export function SettingInput({ setting, id, text, invalid, describedBy, disabled, onChange }: SettingInputProps) {
  const copy = settingCopy(setting.key)
  const common = { id, disabled, "aria-invalid": invalid, "aria-describedby": describedBy }

  switch (setting.type) {
    case "BOOLEAN": {
      const on = text === "true"
      return (
        <button
          type="button"
          role="switch"
          {...common}
          aria-checked={on}
          onClick={() => onChange(on ? "false" : "true")}
          className={cn(
            "inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
            on ? "bg-primary" : "bg-input",
          )}
        >
          <span className={cn("block h-5 w-5 rounded-full bg-background shadow transition-transform", on ? "translate-x-5" : "translate-x-0")} />
          <span className="sr-only">{on ? "On" : "Off"}</span>
        </button>
      )
    }

    case "DATE":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" className="w-[170px]" {...common} value={text} onChange={(event) => onChange(event.target.value)} />
          {setting.limits?.nullable && text !== "" && (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange("")}>
              Clear
            </Button>
          )}
        </div>
      )

    case "TIME":
      return <Input type="time" className="w-[130px]" {...common} value={text} onChange={(event) => onChange(event.target.value)} />

    case "TIME_RANGE": {
      const [start = "", end = ""] = text.split("-")
      return (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
          <Input
            type="time"
            className="w-[130px]"
            id={id}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-label={`${copy.label}: start`}
            value={start}
            onChange={(event) => onChange(`${event.target.value}-${end}`)}
          />
          <Affix>to</Affix>
          <Input
            type="time"
            className="w-[130px]"
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-label={`${copy.label}: end`}
            value={end}
            onChange={(event) => onChange(`${start}-${event.target.value}`)}
          />
        </div>
      )
    }

    case "INTEGER":
      return (
        <div className="flex items-center gap-2">
          <Input inputMode="numeric" className="w-[110px]" {...common} value={text} onChange={(event) => onChange(event.target.value)} />
          {copy.unit === "minutes" && <Affix>minutes</Affix>}
          {copy.unit === "hours" && <Affix>hours</Affix>}
        </div>
      )

    default:
      return (
        <div className="flex items-center gap-2">
          {copy.unit === "rand" && <Affix>R</Affix>}
          <Input inputMode="decimal" className="w-[150px]" {...common} value={text} onChange={(event) => onChange(event.target.value)} />
          {(copy.unit === "percent" || copy.unit === "fraction-percent") && <Affix>%</Affix>}
        </div>
      )
  }
}
