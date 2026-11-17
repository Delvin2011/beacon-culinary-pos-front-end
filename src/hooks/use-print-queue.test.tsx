// O2b: the print queue prints the receipt, then the kitchen ticket, moving on at `afterprint` or after the
// fallback timeout when `afterprint` never fires (kiosk printing).
import { act, render } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PRINT_FALLBACK_TIMEOUT_MS, usePrintQueue, type PrintJob } from "@/hooks/use-print-queue"

let printed: string[] = []

// Small steps, each in its own act(), so React applies the queue update between timers as a browser would.
async function tick(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(10, ms - elapsed))
    })
  }
}

let fireAfterprint = false

function Queue({ jobs }: { jobs: PrintJob[] }) {
  const { enqueue, portal } = usePrintQueue()
  useEffect(() => {
    enqueue(...jobs)
    // Once, like a finished sale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <>{portal}</>
}

const jobs: PrintJob[] = [
  { medium: "RECEIPT80", content: <p>receipt</p> },
  { medium: "RECEIPT80", content: <p>kitchen ticket</p> },
]

beforeEach(() => {
  vi.useFakeTimers()
  printed = []
  fireAfterprint = false
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number)
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
  vi.spyOn(window, "print").mockImplementation(() => {
    printed.push(document.querySelector(".print-portal")?.textContent ?? "")
    // A normal browser: print() blocks and `afterprint` fires before it returns.
    if (fireAfterprint) window.dispatchEvent(new Event("afterprint"))
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("usePrintQueue", () => {
  it("prints the receipt, then the kitchen ticket, when afterprint never fires (the timeout)", async () => {
    render(<Queue jobs={jobs} />)

    await tick(20)
    expect(printed).toEqual(["receipt"])

    // Not before the fallback timeout.
    await tick(PRINT_FALLBACK_TIMEOUT_MS - 100)
    expect(printed).toEqual(["receipt"])

    await tick(200)
    expect(printed).toEqual(["receipt", "kitchen ticket"])

    await tick(PRINT_FALLBACK_TIMEOUT_MS + 100)
    expect(printed).toEqual(["receipt", "kitchen ticket"])
    expect(document.querySelector(".print-portal")).toBeNull()
    expect(document.documentElement.classList.contains("printing")).toBe(false)
  })

  it("moves on at afterprint without waiting for the timeout", async () => {
    fireAfterprint = true
    render(<Queue jobs={jobs} />)

    await tick(50)
    expect(printed).toEqual(["receipt", "kitchen ticket"])
  })

  it("sets a margin-free 80 mm page while a receipt prints", async () => {
    let pageRule = ""
    vi.mocked(window.print).mockImplementation(() => {
      pageRule = Array.from(document.head.querySelectorAll("style")).map((s) => s.textContent).join("")
    })
    render(<Queue jobs={[jobs[0]]} />)
    await tick(20)
    expect(pageRule).toContain("@page { size: 80mm auto; margin: 0; }")
  })

  it("carries on when print() throws", async () => {
    let calls = 0
    vi.mocked(window.print).mockImplementation(() => {
      calls += 1
      throw new Error("no printer")
    })
    render(<Queue jobs={jobs} />)
    await tick(PRINT_FALLBACK_TIMEOUT_MS * 2 + 100)
    expect(calls).toBe(2)
  })
})
