import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"
import { resetApiFetch } from "@/lib/api-fetch"
import { resetCustomerStatus } from "@/lib/customer-status"

afterEach(() => {
  cleanup()
  // T1-3: the customer's status is module state shared by every screen; each test starts with an active customer.
  resetCustomerStatus()
  resetApiFetch()
})
