"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export type LocationDto = {
  id: number;
  name: string;
  active: boolean;
};

export function useLocations() {
  const { authFetch } = useAuth();
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/locations");
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
  }, [authFetch]);

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  return { locations, loading, error, refetch: fetchLocations };
}
