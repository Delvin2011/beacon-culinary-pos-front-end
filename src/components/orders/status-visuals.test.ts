// T0-8 part 5: the kitchen's "kept here for" note comes from the same value the kitchen uses to drop done orders.
import { describe, expect, it } from "vitest"
import { DONE_RETENTION_MS, doneRetentionNotice } from "@/components/orders/status-visuals"

describe("doneRetentionNotice", () => {
  it("says today's text, from the kitchen's own retention", () => {
    expect(DONE_RETENTION_MS).toBe(10 * 60 * 1000)
    expect(doneRetentionNotice()).toBe("Done orders are kept here for 10 minutes.")
  })

  it("follows the retention it is given", () => {
    expect(doneRetentionNotice(15 * 60 * 1000)).toBe("Done orders are kept here for 15 minutes.")
    expect(doneRetentionNotice(60 * 1000)).toBe("Done orders are kept here for 1 minute.")
  })
})
