"use client"

// T1-3: the customer's status (suspended, unavailable, unknown address) for any component, with no provider: it is
// module state (src/lib/customer-status.ts), set by every API response.

import { useSyncExternalStore } from "react"
import { ACTIVE_CUSTOMER, getCustomerStatus, subscribeCustomerStatus, type CustomerStatus } from "@/lib/customer-status"

export function useCustomerStatus(): CustomerStatus {
  return useSyncExternalStore(subscribeCustomerStatus, getCustomerStatus, () => ACTIVE_CUSTOMER)
}
