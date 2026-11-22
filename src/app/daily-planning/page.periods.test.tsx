// T0-8 part 1: Daily Planning tells "still loading", "loaded but nothing to plan" and "failed" apart. With no
// plannable periods it says why and where to set them up (ADMIN) or to ask a manager (others); a failed first load
// offers Try again instead of a placeholder that never ends.
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DailyPlanningPage from "@/app/daily-planning/page"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/daily-planning" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }))

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
const admin = { name: "Ayanda", role: "ADMIN" }
const headChef = { name: "Thandi", role: "HEAD_CHEF" }
// One object, as the real auth context keeps it between renders.
const auth = { isAuthenticated: true, isLoading: false, user: admin as { name: string; role: string }, authFetch }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const SET_MEALS = { id: 2, name: "Midday", startTime: "12:00:00", endTime: "14:30:00", allDay: false, accepts: "SET_MEALS", plannable: true }
const ALL_DAY = { id: 3, name: "All Day", startTime: null, endTime: null, allDay: true, accepts: "LIGHT_MEALS", plannable: false }
const COFFEE = { id: 4, name: "Coffee Bar", startTime: null, endTime: null, allDay: true, accepts: "LIGHT_MEALS", plannable: false }

let periodsAnswer: () => Promise<Response>

beforeEach(() => {
  auth.user = admin
  periodsAnswer = async () => json([SET_MEALS])
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => {
    if (path === "/meal-periods") return periodsAnswer()
    if (path.startsWith("/admin/daily-planning/")) return json({ options: [], componentStock: [] })
    return json([])
  })
})

const NO_PERIODS = "No meal periods are set up yet."
const ASK = "Ask a manager to set up meal periods."

describe("Daily Planning meal periods", () => {
  it("shows the loading placeholder until the periods answer", async () => {
    let release!: (res: Response) => void
    periodsAnswer = () => new Promise((resolve) => (release = resolve))
    render(<DailyPlanningPage />)
    expect(await screen.findByText("Loading periods…")).toBeInTheDocument()
    release(json([SET_MEALS]))
    expect(await screen.findByRole("button", { name: /Midday/ })).toBeInTheDocument()
    expect(screen.queryByText("Loading periods…")).not.toBeInTheDocument()
  })

  it("no periods, as ADMIN: says so and links to Meal periods", async () => {
    periodsAnswer = async () => json([])
    render(<DailyPlanningPage />)
    expect(await screen.findByText(NO_PERIODS)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Admin → Meal periods" })).toHaveAttribute("href", "/meal-periods")
    expect(screen.queryByText("Loading periods…")).not.toBeInTheDocument()
    expect(screen.queryByText(ASK)).not.toBeInTheDocument()
  })

  it("no periods, as Head Chef: asks a manager, no link", async () => {
    auth.user = headChef
    periodsAnswer = async () => json([])
    render(<DailyPlanningPage />)
    expect(await screen.findByText(NO_PERIODS)).toBeInTheDocument()
    expect(screen.getByText(ASK)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Admin → Meal periods" })).not.toBeInTheDocument()
  })

  it("only an unplannable period: says which one and why", async () => {
    periodsAnswer = async () => json([ALL_DAY])
    render(<DailyPlanningPage />)
    expect(await screen.findByText("Only All Day is set up. Add a meal period for set meals to plan them.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Admin → Meal periods" })).toBeInTheDocument()
  })

  it("two unplannable periods, as Head Chef", async () => {
    auth.user = headChef
    periodsAnswer = async () => json([ALL_DAY, COFFEE])
    render(<DailyPlanningPage />)
    expect(await screen.findByText("Only All Day and Coffee Bar are set up. Add a meal period for set meals to plan them.")).toBeInTheDocument()
    expect(screen.getByText(ASK)).toBeInTheDocument()
  })

  it.each([
    ["a server error", async () => json({ error: "Boom" }, 500)],
    ["a network failure", async () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("%s: shows an error with Try again, which loads the periods", async (_, failure) => {
    periodsAnswer = failure
    render(<DailyPlanningPage />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load meal periods.")
    expect(screen.queryByText("Loading periods…")).not.toBeInTheDocument()

    periodsAnswer = async () => json([SET_MEALS])
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("button", { name: /Midday/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })

  it("normal: the period tabs, and none of the new messages", async () => {
    render(<DailyPlanningPage />)
    expect(await screen.findByRole("button", { name: /Midday/ })).toBeInTheDocument()
    expect(screen.queryByText(NO_PERIODS)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Only /)).not.toBeInTheDocument()
    expect(screen.queryByText("Couldn't load meal periods.")).not.toBeInTheDocument()
    expect(screen.queryByText("Loading periods…")).not.toBeInTheDocument()
  })
})
