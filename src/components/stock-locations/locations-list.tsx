"use client"

// The stock locations (GET /admin/locations), inactive ones greyed, in display order: name, Primary or Secondary,
// Active or Inactive, the stock-on-hand summary and what each is assigned to. Add, rename, move up/down, deactivate
// and activate. Moving swaps two rows with two PUTs (contract 4.3, no bulk endpoint) and reloads the list after;
// if the second PUT fails, the list says so.

import { useCallback, useEffect, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "@/hooks/use-toast"
import {
  LocationError,
  assignmentLabel,
  kindLabel,
  listAdminLocations,
  planMove,
  stockSummaryText,
  updateLocation,
  type AdminLocation,
} from "@/lib/locations"
import { cn } from "@/lib/utils"
import { LocationFormDialog } from "./location-form-dialog"
import { LocationStatusDialog } from "./location-status-dialog"

export const FORBIDDEN_MESSAGE = "You don't have permission to manage stock locations. Only an admin can."

// Display order: sortOrder, then id (contract section 3).
function sorted(list: AdminLocation[]): AdminLocation[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
}

export interface LocationsListProps {
  onLoaded?: (locations: AdminLocation[]) => void
  // Bumped by the page when something else (the assignments) changed what the list shows.
  reloadKey?: number
}

export function LocationsList({ onLoaded, reloadKey = 0 }: LocationsListProps) {
  const { authFetch } = useAuth()
  const [locations, setLocations] = useState<AdminLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "error" } | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminLocation | null>(null)
  const [statusTarget, setStatusTarget] = useState<AdminLocation | null>(null)
  const [moving, setMoving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setLocations(sorted(await listAdminLocations(authFetch)))
    } catch (err) {
      setLoadError(err instanceof LocationError && err.forbidden ? FORBIDDEN_MESSAGE : "Unable to load the stock locations.")
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    onLoaded?.(locations)
  }, [locations, onLoaded])

  const gone = (message: string) => {
    setFormOpen(false)
    setStatusTarget(null)
    setNotice({ text: message, tone: "info" })
    void load()
  }

  const move = async (index: number, direction: "up" | "down") => {
    const steps = planMove(locations, index, direction)
    if (steps.length === 0) return
    setMoving(true)
    setNotice(null)
    let done = 0
    try {
      for (const step of steps) {
        await updateLocation(authFetch, step.id, { name: step.name, sortOrder: step.sortOrder })
        done += 1
      }
    } catch (err) {
      const reason = err instanceof LocationError ? err.message : "The server couldn't be reached."
      const moved = locations[index]
      const other = locations[direction === "up" ? index - 1 : index + 1]
      setNotice({
        tone: "error",
        text:
          done === 0
            ? `${moved.name} wasn't moved: ${reason}`
            : `The move was only half done: ${moved.name} moved, but ${other?.name ?? "the other location"} didn't (${reason}). The list shows the order now; move it again to finish.`,
      })
    } finally {
      setMoving(false)
      await load()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          The primary location receives every delivery and supplies every issue. Secondary locations request stock from it.
        </p>
        <Button
          onClick={() => {
            setNotice(null)
            setEditing(null)
            setFormOpen(true)
          }}
          disabled={loading || loadError !== null}
        >
          Add location
        </Button>
      </div>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            notice.tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-muted/40",
          )}
        >
          {notice.text}
        </div>
      )}

      {loadError ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Order</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Stock on hand</TableHead>
                <TableHead className="hidden lg:table-cell">Assigned to</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && locations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    Loading stock locations…
                  </TableCell>
                </TableRow>
              ) : (
                locations.map((location, index) => (
                  <TableRow
                    key={location.id}
                    data-testid={`location-${location.id}`}
                    data-inactive={location.active ? undefined : "true"}
                    className={cn(!location.active && "bg-muted/40 text-muted-foreground")}
                  >
                    <TableCell className="whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={moving || loading || index === 0}
                        onClick={() => void move(index, "up")}
                        aria-label={`Move ${location.name} up`}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={moving || loading || index === locations.length - 1}
                        onClick={() => void move(index, "down")}
                        aria-label={`Move ${location.name} down`}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{location.name}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                          location.kind === "PRIMARY" && "border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
                        )}
                      >
                        {kindLabel(location.kind)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                          location.active ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-muted",
                        )}
                      >
                        {location.active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      <span className={cn(location.stockSummary.ingredientsNegative > 0 && "text-rose-700 dark:text-rose-400")}>
                        {stockSummaryText(location.stockSummary)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      {location.assignedTo.length > 0 ? location.assignedTo.map(assignmentLabel).join(", ") : "—"}
                    </TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setNotice(null)
                          setEditing(location)
                          setFormOpen(true)
                        }}
                        aria-label={`Rename ${location.name}`}
                      >
                        Rename
                      </Button>
                      {location.kind === "PRIMARY" ? (
                        <span className="text-xs text-muted-foreground" title="Every delivery is received here.">
                          Always active
                        </span>
                      ) : (
                        <Button
                          variant={location.active ? "outline" : "default"}
                          size="sm"
                          onClick={() => {
                            setNotice(null)
                            setStatusTarget(location)
                          }}
                          aria-label={`${location.active ? "Deactivate" : "Activate"} ${location.name}`}
                        >
                          {location.active ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <LocationFormDialog
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(location, created) => {
          setFormOpen(false)
          toast({ title: created ? `${location.name} added` : `Renamed to ${location.name}` })
          void load()
        }}
        onGone={gone}
      />
      <LocationStatusDialog
        location={statusTarget}
        onClose={() => setStatusTarget(null)}
        onDone={(location) => {
          setStatusTarget(null)
          toast({ title: location.active ? `${location.name} activated` : `${location.name} deactivated` })
          void load()
        }}
        onGone={gone}
      />
    </div>
  )
}
