"use client"

// Assignments (GET/PUT /admin/locations/assignments, contract 4.6–4.7): the production location, and the source
// location for each sales station. Only active secondaries can be chosen (from GET /admin/locations, passed in by the
// page). Save sends only what changed. A location that can't be used (ASSIGNMENT_NOT_SECONDARY, LOCATION_INACTIVE,
// LOCATION_NOT_FOUND) reloads the assignments and the list and asks to choose again.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import {
  LocationError,
  SALES_STATIONS,
  activeSecondaries,
  assignmentChanges,
  assignmentErrorMessage,
  fetchAssignments,
  isChooseAgain,
  saveAssignments,
  stationLabel,
  type AdminLocation,
  type LocationAssignments,
  type SalesStation,
} from "@/lib/locations"
import { ASSIGNMENTS_ANCHOR } from "./deactivate-refused"

const SELECT_CLASS = "h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm disabled:opacity-60"

type Chosen = { production: number; stations: Record<SalesStation, number> }

function chosenFrom(assignments: LocationAssignments): Chosen {
  return {
    production: assignments.production.id,
    stations: { KITCHEN: assignments.stations.KITCHEN.id, BAR: assignments.stations.BAR.id, NONE: assignments.stations.NONE.id },
  }
}

export interface AssignmentsSectionProps {
  // GET /admin/locations, from the list above.
  locations: AdminLocation[]
  // Ask the page to reload the list (its "Assigned to" column changes).
  onChanged: () => void
}

export function AssignmentsSection({ locations, onChanged }: AssignmentsSectionProps) {
  const { authFetch } = useAuth()
  const [current, setCurrent] = useState<LocationAssignments | null>(null)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const next = await fetchAssignments(authFetch)
      setCurrent(next)
      setChosen(chosenFrom(next))
    } catch (err) {
      setLoadError(err instanceof LocationError ? err.message : "Unable to load the assignments.")
    }
  }, [authFetch])

  useEffect(() => {
    void load()
  }, [load])

  const options = useMemo(() => activeSecondaries(locations), [locations])
  const changes = current && chosen ? assignmentChanges(current, chosen) : null

  const save = async () => {
    if (!current || !chosen) return
    const body = assignmentChanges(current, chosen)
    setMessage(null)
    if (!body) {
      setMessage({ text: "Nothing to save: no assignment was changed.", tone: "info" })
      return
    }
    setSaving(true)
    try {
      const saved = await saveAssignments(authFetch, body)
      setCurrent(saved)
      setChosen(chosenFrom(saved))
      toast({ title: "Assignments saved", description: "They apply from the next sale, planning confirmation or sync." })
      onChanged()
    } catch (err) {
      if (!(err instanceof LocationError)) {
        setMessage({ text: "Unable to save the assignments. Check the connection and try again.", tone: "error" })
        return
      }
      setMessage({ text: assignmentErrorMessage(err), tone: err.code === "LOCATION_INVALID" ? "info" : "error" })
      if (isChooseAgain(err)) {
        await load()
        onChanged()
      }
    } finally {
      setSaving(false)
    }
  }

  // The options for one select: active secondaries, plus the current choice if it isn't one of them (so the select
  // still shows what is stored).
  const selectFor = (id: string, label: string, value: number, onChange: (next: number) => void) => {
    const stored = current ? [current.production, ...SALES_STATIONS.map((s) => current.stations[s])].find((ref) => ref.id === value) : undefined
    const missing = !options.some((option) => option.id === value)
    return (
      <select
        id={id}
        aria-label={label}
        className={SELECT_CLASS}
        value={value}
        disabled={saving}
        onChange={(event) => {
          setMessage(null)
          onChange(Number(event.target.value))
        }}
      >
        {missing && (
          <option value={value} disabled>
            {stored?.name ?? `Location #${value}`} (can&apos;t be chosen)
          </option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    )
  }

  return (
    <section id={ASSIGNMENTS_ANCHOR} aria-labelledby="location-assignments-heading" className="space-y-4 scroll-mt-20">
      <div className="space-y-1">
        <h2 id="location-assignments-heading" className="text-lg font-semibold">
          Assignments
        </h2>
        <p className="text-sm text-muted-foreground">Which secondary location does each job. Only active secondary locations can be chosen.</p>
      </div>

      {loadError ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : !current || !chosen ? (
        <p className="text-sm text-muted-foreground">Loading the assignments…</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1 rounded-md border p-3">
            <label htmlFor="assignment-production" className="text-sm font-medium">
              Production location
            </label>
            {selectFor("assignment-production", "Production location", chosen.production, (next) => setChosen({ ...chosen, production: next }))}
            <p className="text-xs text-muted-foreground">Where the daily planning issue sheet sends ingredients (from {current.primary.name}).</p>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Stock source for each sales station</p>
            {SALES_STATIONS.map((station) => (
              <div key={station} className="space-y-1">
                <label htmlFor={`assignment-station-${station}`} className="text-sm">
                  {stationLabel(station)}
                </label>
                {selectFor(`assignment-station-${station}`, `${stationLabel(station)} station source`, chosen.stations[station], (next) =>
                  setChosen({ ...chosen, stations: { ...chosen.stations, [station]: next } }),
                )}
                <p className="text-xs text-muted-foreground">Sales at this station take their stock from here.</p>
                {station !== "KITCHEN" && (
                  <p className="text-xs text-muted-foreground">Bar items and items handed over at the till don&apos;t use stock yet; this applies once they do.</p>
                )}
              </div>
            ))}
          </div>

          {message && (
            <div
              role={message.tone === "error" ? "alert" : "status"}
              className={
                message.tone === "error"
                  ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  : "rounded-md border bg-muted/40 px-3 py-2 text-sm"
              }
            >
              {message.text}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save assignments"}
            </Button>
            {changes && (
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setChosen(chosenFrom(current))
                  setMessage(null)
                }}
              >
                Undo changes
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
