// Roles: ADMIN, CASHIER, KITCHEN, HEAD_CHEF, STOCK_ADMIN, STOCK_CLERK, BARISTA (possibly prefixed "ROLE_").
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

// The bar display (BAR_DISPLAY).
export function isBarAccessRole(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "BARISTA" || normalised === "ADMIN";
}

// A Barista only works the bar display: no back-office menus, no selling, no shifts.
export function isBaristaRole(role?: string): boolean {
  return normaliseRole(role) === "BARISTA";
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

// The reports hub and viewer. The server's catalogue decides which reports each role sees.
export function canViewReports(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "ADMIN" || normalised === "HEAD_CHEF";
}

// Light meal stock Review button and panel (MENU_VIEW + STOCK_VIEW once U2 lands).
export function canReviewMealStock(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "ADMIN" || normalised === "HEAD_CHEF";
}

// Raising an Issue request, Main Store → Kitchen (REQUEST_ISSUE once U2 lands).
export function canRequestIssue(role?: string): boolean {
  const normalised = normaliseRole(role);
  return normalised === "ADMIN" || normalised === "HEAD_CHEF" || normalised === "STOCK_ADMIN" || normalised === "STOCK_CLERK";
}

// Creating or editing catalog items (components, meals, recipes). Head Chefs view the catalog.
export function canEditCatalog(role?: string): boolean {
  return normaliseRole(role) === "ADMIN";
}
