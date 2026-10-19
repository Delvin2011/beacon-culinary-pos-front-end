"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  actionFieldName,
  blockerHref,
  isEnvelope,
  type EndOfDayBlocker,
  type ReportAction,
  type ReportEnvelope,
} from "@/lib/reports"

// The outcome of a request made for a report or row action.
export type ActionOutcome =
  | { ok: true; body: unknown }
  | { ok: false; message: string; blockers: EndOfDayBlocker[] }

// Sends an action's request. Errors come back as { error, code, blockers? } or a field map; every blocker is kept.
export async function sendAction(
  authFetch: (path: string, init?: RequestInit) => Promise<Response>,
  method: string,
  path: string,
  body?: unknown,
): Promise<ActionOutcome> {
  try {
    const res = await authFetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => null)) as unknown
    if (res.ok) return { ok: true, body: payload }
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
    const blockers = Array.isArray(record.blockers) ? (record.blockers as EndOfDayBlocker[]) : []
    const message =
      typeof record.error === "string" && record.error.trim()
        ? record.error
        : typeof record.message === "string" && record.message.trim()
          ? record.message
          : Object.values(record).filter((value): value is string => typeof value === "string").join(" ") ||
            (res.status === 403 ? "You don't have permission to do this." : "The action failed. Try again.")
    return { ok: false, message, blockers }
  } catch {
    return { ok: false, message: "The action failed. Check the connection and try again.", blockers: [] }
  }
}

export function BlockerList({ blockers }: { blockers: EndOfDayBlocker[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5">
      {blockers.map((blocker, index) => {
        const href = blockerHref(blocker)
        return (
          <li key={`${blocker.code}-${index}`}>
            {blocker.message}
            {href && (
              <>
                {" "}
                <Link href={href} className="font-medium underline underline-offset-2">
                  Open
                </Link>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

interface ReportActionsProps {
  actions: ReportAction[]
  // Called after a successful action: with the envelope it returned (Close Day returns the Z), or null to reload.
  onDone: (result: ReportEnvelope | null) => void
}

// Report-level actions from the envelope: a button each, a confirm step (with the action's fields, if any),
// and the reasons a disabled one can't run.
export function ReportActions({ actions, onDone }: ReportActionsProps) {
  const { authFetch } = useAuth()
  const [pending, setPending] = useState<ReportAction | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ label: string; message: string; blockers: EndOfDayBlocker[] } | null>(null)

  const pendingFields = pending?.fields ?? []
  const missingRequired = pendingFields.some((field) => field.required && !(fieldValues[actionFieldName(field)] ?? "").trim())

  const run = async (action: ReportAction) => {
    const fields = action.fields ?? []
    // Fields go in the JSON body; empty optional ones are left out.
    const body =
      fields.length > 0
        ? Object.fromEntries(
            fields
              .map((field) => [actionFieldName(field), (fieldValues[actionFieldName(field)] ?? "").trim()] as const)
              .filter(([, value]) => value !== ""),
          )
        : undefined
    setPending(null)
    setRunning(action.key)
    setFailure(null)
    const outcome = await sendAction(authFetch, action.method, action.path, body)
    setRunning(null)
    if (outcome.ok) {
      onDone(isEnvelope(outcome.body) ? outcome.body : null)
      return
    }
    setFailure({ label: action.label, message: outcome.message, blockers: outcome.blockers })
  }

  const start = (action: ReportAction) => {
    setFieldValues({})
    if (action.confirm || (action.fields?.length ?? 0) > 0) setPending(action)
    else void run(action)
  }

  if (actions.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        {actions.map((action) => (
          <div key={action.key} className="space-y-1">
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-900 hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950"
              disabled={!action.enabled || running !== null}
              onClick={() => start(action)}
            >
              {running === action.key ? "Working…" : action.label}
            </Button>
            {!action.enabled && (action.disabledReasons?.length ?? 0) > 0 && (
              <ul className="max-w-md list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {action.disabledReasons?.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      {failure && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {failure.label}: {failure.message}
          </p>
          {failure.blockers.length > 0 && <BlockerList blockers={failure.blockers} />}
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.label}?</DialogTitle>
            {pending?.confirm && <DialogDescription className="text-foreground">{pending.confirm}</DialogDescription>}
          </DialogHeader>
          {pendingFields.map((field) => {
            const name = actionFieldName(field)
            return (
              <div key={name} className="space-y-1">
                <Label htmlFor={`action-field-${name}`}>
                  {field.label}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{field.required ? "(required)" : "(optional)"}</span>
                </Label>
                <textarea
                  id={`action-field-${name}`}
                  rows={2}
                  value={fieldValues[name] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value
                    setFieldValues((current) => ({ ...current, [name]: value }))
                  }}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )
          })}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={missingRequired} onClick={() => pending && void run(pending)}>
              {pending?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
