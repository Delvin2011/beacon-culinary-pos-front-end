export function isKitchenAccessRole(role?: string): boolean {
  if (!role) return false;
  const normalised = role.toUpperCase();
  return normalised.includes("KITCHEN") || normalised.includes("ADMIN");
}

export function isStockAccessRole(role?: string): boolean {
  if (!role) return false;
  const normalised = role.toUpperCase();
  return normalised.includes("STOCK") || normalised.includes("ADMIN");
}
