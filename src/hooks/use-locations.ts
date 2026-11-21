"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { activeSecondaries, locationsPath, primaryOf, type Location } from "@/lib/locations";

// T0-5d: GET /locations — active locations in display order, with kind (contract section 3).
// includeInactive adds deactivated ones, for filters on history screens.
export type LocationDto = Location;

export function useLocations(options: { includeInactive?: boolean } = {}) {
  const includeInactive = options.includeInactive ?? false;
  const { authFetch } = useAuth();
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(locationsPath(includeInactive));
      const body = (await res.json().catch(() => null)) as LocationDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error("Unable to load locations.");
      }
      setLocations(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load locations.");
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch, includeInactive]);

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  // The primary (found by kind) and the active secondaries, for GRV labels and the ISSUE picker.
  const primary = useMemo(() => primaryOf(locations), [locations]);
  const secondaries = useMemo(() => activeSecondaries(locations), [locations]);

  return { locations, primary, secondaries, loading, error, refetch: fetchLocations };
}
