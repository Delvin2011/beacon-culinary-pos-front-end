"use client"

// T1-8: the customer's name and logo for any component, with no provider (src/lib/customer-branding.ts). The server
// render shows the neutral name; the browser then shows the remembered one, then the one just fetched.

import { useSyncExternalStore } from "react"
import { getCustomerBranding, NEUTRAL_BRANDING, subscribeCustomerBranding, type CustomerBranding } from "@/lib/customer-branding"

export function useCustomerBranding(): CustomerBranding {
  return useSyncExternalStore(subscribeCustomerBranding, getCustomerBranding, () => NEUTRAL_BRANDING)
}
