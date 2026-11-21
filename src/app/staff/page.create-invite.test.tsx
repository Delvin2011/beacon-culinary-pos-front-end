// T0-6b: creating staff with "Send them a link" (setup INVITE, the default) or "Set password/PIN now" (SET_NOW).
// With a link: no credential fields, email still required where the role uses a password, the issuedInvite shown once
// in the link dialog and never kept in the list; creating an ADMIN that way may need REAUTH_REQUIRED, then a confirm.
import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import StaffPage from "@/app/staff/page"
import { TOKEN, errorResponse, issued, jsonResponse, staffInvite } from "@/lib/invites.test-fixtures"
import type { StaffMember } from "@/lib/staff"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/staff" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
vi.mock("@/components/ui/select", async () => (await import("@/components/inventory/line-item-sheet.test-fixtures")).selectMock)
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }))

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
const auth = { isAuthenticated: true, isLoading: false, user: { email: "me@x.co", role: "ADMIN", name: "Me" }, authFetch }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))


const me: StaffMember = { id: 1, name: "Me Myself", role: "ADMIN", email: "me@x.co", active: true, hasPassword: true, hasPin: true, invite: staffInvite("NONE") }
const roles = [
  { role: "ADMIN", label: "Admin", password: "REQUIRED", pin: "REQUIRED" },
  { role: "CASHIER", label: "Cashier", password: "NONE", pin: "REQUIRED" },
  { role: "HEAD_CHEF", label: "Head Chef", password: "REQUIRED", pin: "OPTIONAL" },
]

let createResponse: (body: Record<string, unknown>) => Response
const created = (body: Record<string, unknown>, withInvite: boolean) =>
  jsonResponse(
    {
      id: 9,
      name: body.name,
      role: body.role,
      email: body.email ?? null,
      active: true,
      hasPassword: !!body.password,
      hasPin: !!body.pin,
      invite: staffInvite(withInvite ? "PENDING" : "NONE"),
      ...(withInvite ? { issuedInvite: issued() } : {}),
    },
    201,
  )

beforeEach(() => {
  push.mockReset()
  sessionStorage.clear()
  createResponse = (body) => created(body, body.setup === "INVITE")
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    if (path === "/admin/staff/roles") return jsonResponse(roles)
    if (path === "/admin/staff" && init?.method === "POST") return createResponse(JSON.parse(String(init.body)))
    if (path === "/admin/staff") return jsonResponse([me])
    throw new Error(`Unexpected request ${path}`)
  })
})

afterEach(() => {
  expect(JSON.stringify(sessionStorage)).not.toContain(TOKEN)
})

async function openCreate() {
  render(<StaffPage />)
  await screen.findByText("Me Myself")
  fireEvent.click(screen.getByRole("button", { name: "+ Add Staff" }))
  return screen.getByRole("dialog")
}

function fill(dialog: HTMLElement, name: string, role: string, email?: string) {
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: name } })
  fireEvent.change(within(dialog).getByTestId("mock-select"), { target: { value: role } })
  if (email !== undefined) fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: email } })
}

function createBody() {
  const call = authFetch.mock.calls.find(([path, init]) => path === "/admin/staff" && init?.method === "POST")
  return call ? JSON.parse(String(call[1]?.body)) : null
}

describe("create staff: send them a link", () => {
  it("is the default, hides the password and PIN, and shows the link once", async () => {
    const dialog = await openCreate()
    expect(within(dialog).getByLabelText("Send them a link")).toBeChecked()
    fill(dialog, "Thandi Mokoena", "HEAD_CHEF", "Thandi@X.co")
    expect(within(dialog).queryByLabelText(/^Password/)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/^PIN/)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and send link" }))

    expect(await screen.findByLabelText("Sign-in link")).toHaveValue(`https://pos.example.com/invite#t=${TOKEN}`)
    expect(createBody()).toEqual({ name: "Thandi Mokoena", role: "HEAD_CHEF", email: "thandi@x.co", setup: "INVITE" })
    // The list row shows the new person with their status, not the token.
    const row = screen.getByText("Thandi Mokoena", { selector: "span" }).closest("tr") as HTMLElement
    expect(within(row).getByText(/^Link sent, expires/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByLabelText("Sign-in link")).not.toBeInTheDocument())
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })

  it("still requires an email for a role that uses a password", async () => {
    const dialog = await openCreate()
    fill(dialog, "Thandi Mokoena", "HEAD_CHEF")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and send link" }))
    expect(await within(dialog).findByText("Email is required.")).toBeInTheDocument()
    expect(createBody()).toBeNull()
  })

  it("needs no email for a PIN-only role", async () => {
    const dialog = await openCreate()
    fill(dialog, "Sipho Nkosi", "CASHIER")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and send link" }))
    await screen.findByLabelText("Sign-in link")
    expect(createBody()).toEqual({ name: "Sipho Nkosi", role: "CASHIER", setup: "INVITE" })
  })

  it("'Set password/PIN now' works as before, with setup SET_NOW", async () => {
    const dialog = await openCreate()
    fireEvent.click(within(dialog).getByLabelText("Set password/PIN now"))
    fill(dialog, "Sipho Nkosi", "CASHIER")
    fireEvent.change(within(dialog).getByLabelText("PIN"), { target: { value: "135790" } })
    fireEvent.change(within(dialog).getByLabelText("Confirm PIN"), { target: { value: "135790" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }))
    await waitFor(() => expect(createBody()).toEqual({ name: "Sipho Nkosi", role: "CASHIER", pin: "135790", setup: "SET_NOW" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.queryByLabelText("Sign-in link")).not.toBeInTheDocument()
  })

  it("shows the server's field errors", async () => {
    createResponse = () => jsonResponse({ email: "Already in use." }, 400)
    const dialog = await openCreate()
    fill(dialog, "Thandi Mokoena", "HEAD_CHEF", "thandi@x.co")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and send link" }))
    expect(await within(dialog).findByText("Already in use.")).toBeInTheDocument()
  })

  it("REAUTH_REQUIRED for a new admin: keeps the form without credentials, signs in again, then asks before creating", async () => {
    createResponse = () => errorResponse(403, "REAUTH_REQUIRED")
    const dialog = await openCreate()
    fill(dialog, "Lerato Dlamini", "ADMIN", "lerato@x.co")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and send link" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fstaff"))
    expect(JSON.parse(sessionStorage.getItem("staff.invite.pending") ?? "null")).toEqual({
      kind: "create",
      form: { name: "Lerato Dlamini", role: "ADMIN", email: "lerato@x.co" },
    })
  })

  it("back from the sign-in: the form is restored and nothing is created until confirmed", async () => {
    sessionStorage.setItem("staff.invite.pending", JSON.stringify({ kind: "create", form: { name: "Lerato Dlamini", role: "ADMIN", email: "lerato@x.co" } }))
    render(<StaffPage />)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Signed in again. Check the details, then create Lerato Dlamini and send the link.")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Lerato Dlamini")
    expect(within(dialog).getByLabelText("Email")).toHaveValue("lerato@x.co")
    expect(sessionStorage.getItem("staff.invite.pending")).toBeNull()
    expect(createBody()).toBeNull()

    fireEvent.click(within(dialog).getByRole("button", { name: "Create and send link" }))
    await screen.findByLabelText("Sign-in link")
    expect(createBody()).toEqual({ name: "Lerato Dlamini", role: "ADMIN", email: "lerato@x.co", setup: "INVITE" })
  })
})
