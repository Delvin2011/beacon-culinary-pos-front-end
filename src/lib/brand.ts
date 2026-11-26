// The product's own words, in one place (T0-8). Nothing customer-specific: the customer's name comes from
// GET /public/branding (T1-8, src/lib/customer-branding.ts), and a guard (src/lib/no-hard-coded-brand.test.ts) fails
// on any business name built into src or public.

export const BRAND = {
  // The product name until one is chosen; also the name shown while nothing is known about this address.
  productName: "Canteen POS",
  description: "Canteen POS system",
  planLabel: "Canteen",
} as const
