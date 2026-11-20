// T0-4b: the unsaved-changes warning: beforeunload, in-app links asked first, other clicks untouched.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

let reachedLink: string[]

function Harness({ dirty }: { dirty: boolean }) {
  const guard = useUnsavedChangesGuard(dirty)
  const follow = (name: string) => (event: React.MouseEvent) => {
    event.preventDefault() // jsdom doesn't navigate; record that the link's own handler (Next's Link) ran.
    reachedLink.push(name)
  }
  return (
    <div>
      <a href="/dashboard" onClick={follow("dashboard")}>
        <span>Dashboard</span>
      </a>
      <a href="https://example.com/help" onClick={follow("external")}>
        Help
      </a>
      <a href="/staff" target="_blank" onClick={follow("new-tab")}>
        Staff in a new tab
      </a>
      <button onClick={guard.allowLeave}>Allow leave</button>
      {guard.pendingHref && (
        <div role="dialog">
          Leave for {guard.pendingHref}?<button onClick={guard.leave}>Leave</button>
          <button onClick={guard.stay}>Stay</button>
        </div>
      )}
    </div>
  )
}

const beforeUnload = () => {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  push.mockReset()
  reachedLink = []
  window.history.replaceState(null, "", "/site-settings")
})

describe("useUnsavedChangesGuard", () => {
  it("does nothing without unsaved edits", () => {
    render(<Harness dirty={false} />)
    expect(beforeUnload()).toBe(false)
    fireEvent.click(screen.getByText("Dashboard"))
    expect(reachedLink).toEqual(["dashboard"])
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("asks the browser before a reload or closing the tab", () => {
    render(<Harness dirty />)
    expect(beforeUnload()).toBe(true)
  })

  it("stops an in-app link and asks; Stay stays, Leave goes there", () => {
    render(<Harness dirty />)
    fireEvent.click(screen.getByText("Dashboard"))
    expect(reachedLink).toEqual([])
    expect(screen.getByRole("dialog")).toHaveTextContent("Leave for /dashboard?")

    fireEvent.click(screen.getByText("Stay"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText("Dashboard"))
    fireEvent.click(screen.getByText("Leave"))
    expect(push).toHaveBeenCalledWith("/dashboard")
  })

  it("leaves other sites, new tabs and modifier clicks alone", () => {
    render(<Harness dirty />)
    fireEvent.click(screen.getByText("Help"))
    fireEvent.click(screen.getByText("Staff in a new tab"))
    fireEvent.click(screen.getByText("Dashboard"), { ctrlKey: true })
    expect(reachedLink).toEqual(["external", "new-tab", "dashboard"])
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("lets the page leave without asking after allowLeave (the re-sign-in)", () => {
    render(<Harness dirty />)
    act(() => {
      fireEvent.click(screen.getByText("Allow leave"))
    })
    expect(beforeUnload()).toBe(false)
    fireEvent.click(screen.getByText("Dashboard"))
    expect(reachedLink).toEqual(["dashboard"])
  })

  it("stops warning once the edits are saved or discarded", () => {
    const { rerender } = render(<Harness dirty />)
    rerender(<Harness dirty={false} />)
    expect(beforeUnload()).toBe(false)
  })
})
