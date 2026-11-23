// T0-8 part 5: the kitchen display still says "Done orders are kept here for 10 minutes.", now from DONE_RETENTION_MS.
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { KitchenQueueBoard } from "@/components/kitchen/kitchen-queue-board"
import { doneRetentionNotice } from "@/components/orders/status-visuals"

// The snapshot answers with no orders; the stream never opens.
const authFetch = vi.fn(async (path: string) =>
  path.endsWith("/stream") ? new Promise<Response>(() => {}) : new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
)
const auth = { authFetch }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

describe("kitchen display retention note", () => {
  it("is unchanged and comes from the retention constant", async () => {
    render(<KitchenQueueBoard />)
    expect(await screen.findByText(/Done orders are kept here for 10 minutes\./)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(doneRetentionNotice().replace(".", "\\.")))).toBeInTheDocument()
  })
})
