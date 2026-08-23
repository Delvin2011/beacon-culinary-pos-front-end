interface GrvLike {
  ingredientId: number;
  costPerUnit: number;
  receivedAt: string;
}

// No ingredient stores a cost directly — cost only exists per-GRV. "Current" unit
// value is a frontend-side stand-in: the most recently received GRV's cost per unit.
export function mostRecentCostByIngredient(grvs: GrvLike[]): Record<number, number> {
  const latestByIngredient: Record<number, { costPerUnit: number; receivedAt: string }> = {};

  for (const grv of grvs) {
    const existing = latestByIngredient[grv.ingredientId];
    if (!existing || new Date(grv.receivedAt).getTime() > new Date(existing.receivedAt).getTime()) {
      latestByIngredient[grv.ingredientId] = { costPerUnit: grv.costPerUnit, receivedAt: grv.receivedAt };
    }
  }

  return Object.fromEntries(
    Object.entries(latestByIngredient).map(([ingredientId, entry]) => [Number(ingredientId), entry.costPerUnit]),
  );
}
