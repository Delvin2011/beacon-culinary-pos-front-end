import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"
import { resetApiFetch } from "@/lib/api-fetch"
import { resetCustomerBranding } from "@/lib/customer-branding"
import { resetCustomerStatus } from "@/lib/customer-status"

afterEach(() => {
  cleanup()
  // T1-3: the customer's status is module state shared by every screen; each test starts with an active customer.
  resetCustomerStatus()
  resetApiFetch()
  // T1-8: the customer's name is module state too; each test starts as a fresh page load.
  resetCustomerBranding()
})
