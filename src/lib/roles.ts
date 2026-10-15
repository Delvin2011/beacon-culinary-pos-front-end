// Roles: ADMIN, CASHIER, KITCHEN, HEAD_CHEF, STOCK_ADMIN, STOCK_CLERK (possibly prefixed "ROLE_").
// Match exactly: STOCK_ADMIN contains "ADMIN" but is not an admin.
function normaliseRole(role?: string): string {
  return (role ?? "").toUpperCase().replace(/^ROLE_/, "");
}

export function isAdminRole(role?: string): boolean {
  return normaliseRole(role) === "ADMIN";
}

export function isKitchenAccessRole(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "KITCHEN" || normalised === "HEAD_CHEF" || normalised === "ADMIN";
}

// The stock-movement station: issue, order and waste requests. Head Chefs report waste here.
export function isStockAccessRole(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised.startsWith("STOCK") || normalised === "ADMIN" || normalised === "HEAD_CHEF";
}

// Physical stock counts at the station. Not Head Chefs, who don't do stock takes.
export function canCountStock(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised.startsWith("STOCK") || normalised === "ADMIN";
}

// Inventory (ingredients, GRVs, waste, purchase orders) and stock requests with their approvals.
export function canManageInventory(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "ADMIN" || normalised === "STOCK_ADMIN" || normalised === "HEAD_CHEF";
}

// Stock takes and their reviews.
export function canManageStockTakes(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "ADMIN" || normalised === "STOCK_ADMIN";
}

// Catalog management and daily meal planning.
export function canManageMenu(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "ADMIN" || normalised === "HEAD_CHEF";
}

// Capturing/editing/uploading GRVs, posting waste directly, and creating or editing ingredients.
// Head Chefs can view inventory but report waste through Stock requests → Waste.
export function canEditInventoryRecords(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "ADMIN" || normalised === "STOCK_ADMIN";
}

// Creating or editing catalog items (components, meals, recipes). Head Chefs view the catalog.
export function canEditCatalog(role?: string): boolean {
  return normaliseRole(role) === "ADMIN";
}
