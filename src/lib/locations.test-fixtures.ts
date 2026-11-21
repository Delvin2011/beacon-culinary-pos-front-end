// T0-5d: stock locations as the API returns them (contract docs/2026-11-21-t0-5c-locations-api-contract.md). Test-only.
// The names and ids are deliberately not the seeded ones, so a test passes only if the app takes both from the API.
import type { AdminLocation, Location, LocationAssignments } from "@/lib/locations"

export const PRIMARY = { id: 3, name: "Central Store" } as const
export const PRODUCTION = { id: 4, name: "Hot Line" } as const
export const COFFEE = { id: 7, name: "Coffee Station" } as const

// GET /locations
export function pickerLocations(): Location[] {
  return [
    { id: PRIMARY.id, name: PRIMARY.name, kind: "PRIMARY", sortOrder: 10 },
    { id: PRODUCTION.id, name: PRODUCTION.name, kind: "SECONDARY", sortOrder: 20 },
    { id: COFFEE.id, name: COFFEE.name, kind: "SECONDARY", sortOrder: 30 },
  ]
}

export function adminLocation(overrides: Partial<AdminLocation> & { id: number; name: string }): AdminLocation {
  return {
    kind: "SECONDARY",
    active: true,
    sortOrder: overrides.id * 10,
    stockSummary: { ingredientsWithStock: 0, ingredientsNegative: 0 },
    assignedTo: [],
    createdAt: null,
    createdByName: null,
    updatedAt: null,
    updatedByName: null,
    ...overrides,
  }
}

// GET /admin/locations
export function adminLocations(): AdminLocation[] {
  return [
    adminLocation({ ...PRIMARY, kind: "PRIMARY", sortOrder: 10, stockSummary: { ingredientsWithStock: 120, ingredientsNegative: 0 } }),
    adminLocation({
      ...PRODUCTION,
      sortOrder: 20,
      stockSummary: { ingredientsWithStock: 41, ingredientsNegative: 2 },
      assignedTo: ["PRODUCTION", "STATION_BAR", "STATION_KITCHEN", "STATION_NONE"],
    }),
    adminLocation({ ...COFFEE, sortOrder: 30, stockSummary: { ingredientsWithStock: 1, ingredientsNegative: 0 } }),
    adminLocation({ id: 9, name: "Old Pantry", sortOrder: 40, active: false }),
  ]
}

// GET /admin/locations/assignments
export function assignments(): LocationAssignments {
  return {
    primary: { ...PRIMARY },
    production: { ...PRODUCTION },
    stations: { KITCHEN: { ...PRODUCTION }, BAR: { ...PRODUCTION }, NONE: { ...PRODUCTION } },
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export function errorResponse(status: number, code: string, details?: Record<string, unknown>, error = "Refused."): Response {
  return jsonResponse({ error, code, ...(details ? { details } : {}) }, status)
}
