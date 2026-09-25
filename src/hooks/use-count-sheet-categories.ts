"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export type CountSheetCategoryDto = {
  id: number;
  name: string;
  active: boolean;
};

/**
 * Loads count sheet categories, sorted by id (the count sheet order).
 * The API returns active categories only unless includeInactive is set.
 */
export function useCountSheetCategories({ includeInactive = false }: { includeInactive?: boolean } = {}) {
  const { authFetch } = useAuth();
  const [categories, setCategories] = useState<CountSheetCategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const path = includeInactive ? "/count-sheet-categories?includeInactive=true" : "/count-sheet-categories";
      const res = await authFetch(path);
      const body = (await res.json().catch(() => null)) as CountSheetCategoryDto[] | unknown;
      if (!res.ok || !Array.isArray(body)) {
        throw new Error("Unable to load count sheet categories.");
      }
      setCategories([...body].sort((a, b) => a.id - b.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load count sheet categories.");
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch, includeInactive]);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  return { categories, loading, error, refetch: fetchCategories };
}
