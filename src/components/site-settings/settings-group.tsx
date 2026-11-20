"use client"

// One group of site settings, as the API groups them, with its heading and a plain-language description. When the
// group's settings are inactive (offline without the entitlement) it is greyed with the reason; they stay editable.

import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { groupCopy, inactiveReasonText, type SiteSetting } from "@/lib/site-settings"

export function SettingsGroup({ group, settings, children }: { group: string; settings: SiteSetting[]; children: ReactNode }) {
  const copy = groupCopy(group)
  const inactive = settings.filter((s) => !s.active)
  const reasons = Array.from(new Set(inactive.map((s) => inactiveReasonText(s.inactiveReason))))
  const headingId = `settings-group-${group}`

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader className="pb-2">
        <CardTitle id={headingId} className="text-base">
          {copy.heading}
          {inactive.length > 0 && inactive.length === settings.length && <span className="ml-2 text-sm font-normal text-muted-foreground">(not in use)</span>}
        </CardTitle>
        {copy.description && <CardDescription>{copy.description}</CardDescription>}
        {reasons.map((reason) => (
          <p key={reason} role="note" className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {reason}
          </p>
        ))}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
