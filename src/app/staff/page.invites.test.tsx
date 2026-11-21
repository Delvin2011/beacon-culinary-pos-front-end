// T0-6b: sign-in links on the staff screen. The status line per person, sending set-up and reset links, the one-time
// link dialog (copy, QR drawn locally, fallback link), revoke, REAUTH_REQUIRED then confirm and retry, every error
// code, and nothing for non-admins.
import type { ReactNode } from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import StaffPage from "@/app/staff/page"
import { formatInviteExpiry } from "@/lib/invites"
import { EXPIRES_AT, TOKEN, errorResponse, issued, jsonResponse, staffInvite } from "@/lib/invites.test-fixtures"
import type { StaffMember } from "@/lib/staff"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/staff" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }))

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
const adminUser = { email: "me@x.co", role: "ADMIN", name: "Me" }
const auth = { isAuthenticated: true, isLoading: false, user: adminUser as { email: string; role: string; name: string }, authFetch }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }))

const member = (overrides: Partial<StaffMember> & Pick<StaffMember, "id" | "name" | "role">): StaffMember => ({
  email: null,
  active: true,
  hasPassword: false,
  hasPin: false,
  invite: staffInvite("NONE"),
  ...overrides,
})

const me = member({ id: 1, name: "Me Myself", role: "ADMIN", email: "me@x.co", hasPassword: true, hasPin: true })
const ann = member({ id: 5, name: "Ann Lee", role: "ADMIN", email: "ann@x.co", hasPassword: true, hasPin: true })
const bob = member({ id: 2, name: "Bob Ray", role: "CASHIER", invite: staffInvite("PENDING") })
const thandi = member({ id: 3, name: "Thandi Mokoena", role: "HEAD_CHEF", email: "thandi@x.co", hasPassword: true, invite: staffInvite("EXPIRED") })
const kim = member({ id: 4, name: "Kim Dube", role: "KITCHEN", hasPin: true, invite: staffInvite("REVOKED") })
const zed = member({ id: 6, name: "Zed Moyo", role: "BARISTA", hasPin: true, invite: staffInvite("USED") })
const ina = member({ id: 7, name: "Ina Shaw", role: "CASHIER", active: false })

const roles = [
  { role: "ADMIN", label: "Admin", password: "REQUIRED", pin: "REQUIRED" },
  { role: "CASHIER", label: "Cashier", password: "NONE", pin: "REQUIRED" },
  { role: "HEAD_CHEF", label: "Head Chef", password: "REQUIRED", pin: "OPTIONAL" },
  { role: "KITCHEN", label: "Kitchen", password: "NONE", pin: "REQUIRED" },
  { role: "BARISTA", label: "Barista", password: "NONE", pin: "REQUIRED" },
]

let inviteResponse: () => Response
const globalFetch = vi.fn()

beforeEach(() => {
  push.mockReset()
  replace.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  auth.user = adminUser
  inviteResponse = () => jsonResponse(issued(), 201)
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    if (path === "/admin/staff/roles") return jsonResponse(roles)
    if (path === "/admin/staff") return jsonResponse([ann, bob, ina, kim, me, thandi, zed])
    if (/^\/admin\/staff\/\d+\/invite$/.test(path) && init?.method === "POST") return inviteResponse()
    if (path === "/admin/staff/2/invite/revoke") return jsonResponse({ ...bob, invite: staffInvite("REVOKED") })
    const one = path.match(/^\/admin\/staff\/(\d+)$/)
    if (one) {
      const found = [ann, bob, thandi, kim].find((m) => m.id === Number(one[1]))!
      return jsonResponse({ ...found, invite: staffInvite("PENDING") })
    }
    throw new Error(`Unexpected request ${path}`)
  })
  // The QR code and the dialog must make no request of their own.
  globalFetch.mockReset()
  vi.stubGlobal("fetch", globalFetch)
})

afterEach(() => {
  // The token is never stored.
  const stored = [localStorage, sessionStorage].flatMap((s) => Object.keys(s).flatMap((k) => [k, s.getItem(k) ?? ""]))
  expect(stored.join(" ")).not.toContain(TOKEN)
  expect(globalFetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement

async function renderPage() {
  const view = render(<StaffPage />)
  await screen.findByText("Bob Ray")
  return view
}

function openLinkDialog(name: string) {
  fireEvent.click(within(row(name)).getByRole("button", { name: "Sign-in link" }))
  return screen.getByRole("dialog")
}

function inviteCalls() {
  return authFetch.mock.calls.filter(([path, init]) => /\/invite$/.test(path) && init?.method === "POST")
}

describe("staff screen: sign-in links", () => {
  it("shows each person's link status", async () => {
    await renderPage()
    expect(within(row("Bob Ray")).getByText(`Link sent, expires ${formatInviteExpiry(EXPIRES_AT)}`)).toBeInTheDocument()
    expect(within(row("Thandi Mokoena")).getByText("Link expired")).toBeInTheDocument()
    expect(within(row("Kim Dube")).getByText("Link revoked")).toBeInTheDocument()
    for (const name of ["Ann Lee", "Zed Moyo"]) expect(within(row(name)).queryByText(/^Link /)).not.toBeInTheDocument()
  })

  it("offers Revoke link for pending or expired links, and no link for yourself or someone inactive", async () => {
    await renderPage()
    const revocable = ["Ann Lee", "Bob Ray", "Kim Dube", "Thandi Mokoena", "Zed Moyo"].filter(
      (name) => within(row(name)).queryByRole("button", { name: "Revoke link" }) !== null,
    )
    expect(revocable).toEqual(["Bob Ray", "Thandi Mokoena"])
    expect(within(row("Me Myself")).queryByRole("button", { name: "Sign-in link" })).not.toBeInTheDocument()
    expect(within(row("Ina Shaw")).queryByRole("button", { name: "Sign-in link" })).not.toBeInTheDocument()
  })

  it("sends a set-up link and shows it once, with a QR code drawn in the browser", async () => {
    await renderPage()
    const dialog = openLinkDialog("Bob Ray")
    expect(within(dialog).getByLabelText("Send set-up link")).toBeChecked()
    expect(within(dialog).queryByLabelText("Also reset the PIN")).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }))

    const shown = await screen.findByLabelText("Sign-in link")
    expect(shown).toHaveValue(`https://pos.example.com/invite#t=${TOKEN}`)
    expect(screen.getByText(`This link works once and expires at ${formatInviteExpiry(EXPIRES_AT)}. Send it privately to the person.`)).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "QR code of the sign-in link for Bob Ray" }).tagName.toLowerCase()).toBe("svg")
    expect(inviteCalls()).toHaveLength(1)
    expect(inviteCalls()[0][0]).toBe("/admin/staff/2/invite")
    expect(JSON.parse(String(inviteCalls()[0][1]?.body))).toEqual({ purpose: "STAFF_SETUP" })
    // The person is reloaded for the new status line.
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith("/admin/staff/2"))

    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByLabelText("Sign-in link")).not.toBeInTheDocument())
    expect(document.body.innerHTML).not.toContain(TOKEN)
    expect(screen.queryByRole("img", { name: /QR code/ })).not.toBeInTheDocument()
  })

  it("resets by link, with the PIN too only when asked and only where the PIN is optional", async () => {
    await renderPage()
    let dialog = openLinkDialog("Thandi Mokoena")
    expect(within(dialog).getByLabelText("Reset sign-in by link")).toBeChecked()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also reset the PIN" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }))
    await screen.findByLabelText("Sign-in link")
    expect(JSON.parse(String(inviteCalls()[0][1]?.body))).toEqual({ purpose: "RESET", credentials: "BOTH" })
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    dialog = openLinkDialog("Thandi Mokoena")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }))
    await screen.findByLabelText("Sign-in link")
    expect(JSON.parse(String(inviteCalls()[1][1]?.body))).toEqual({ purpose: "RESET" })
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    dialog = openLinkDialog("Kim Dube")
    expect(within(dialog).getByLabelText("Reset sign-in by link")).toBeChecked()
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("copies the link, and says so when the clipboard fails", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"))
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    await renderPage()
    fireEvent.click(within(openLinkDialog("Bob Ray")).getByRole("button", { name: "Create link" }))
    await screen.findByLabelText("Sign-in link")

    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(`https://pos.example.com/invite#t=${TOKEN}`)

    fireEvent.click(screen.getByRole("button", { name: "Copied" }))
    expect(await screen.findByText("Couldn't copy. Select the link and copy it.")).toBeInTheDocument()
  })

  it("builds the link from this app's address when the API sends link: null", async () => {
    inviteResponse = () => jsonResponse(issued({ link: null }), 201)
    await renderPage()
    fireEvent.click(within(openLinkDialog("Bob Ray")).getByRole("button", { name: "Create link" }))
    expect(await screen.findByLabelText("Sign-in link")).toHaveValue(`${window.location.origin}/invite#t=${TOKEN}`)
  })

  it("revokes a link and refreshes the person from the response", async () => {
    await renderPage()
    fireEvent.click(within(row("Bob Ray")).getByRole("button", { name: "Revoke link" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Revoke Bob Ray's link?")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke link" }))
    await waitFor(() => expect(within(row("Bob Ray")).getByText("Link revoked")).toBeInTheDocument())
    expect(within(row("Bob Ray")).queryByRole("button", { name: "Revoke link" })).not.toBeInTheDocument()
    expect(authFetch).toHaveBeenCalledWith("/admin/staff/2/invite/revoke", { method: "POST" })
  })

  it("REAUTH_REQUIRED: signs in again, then asks before sending", async () => {
    inviteResponse = () => errorResponse(403, "REAUTH_REQUIRED")
    const first = await renderPage()
    const dialog = openLinkDialog("Ann Lee")
    fireEvent.click(within(dialog).getByLabelText("Send set-up link"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fstaff"))
    expect(JSON.parse(sessionStorage.getItem("staff.invite.pending") ?? "null")).toEqual({
      kind: "send",
      staffId: 5,
      request: { purpose: "STAFF_SETUP", alsoResetPin: false },
    })
    first.unmount()

    // Back from the sign-in.
    inviteResponse = () => jsonResponse(issued({ purpose: "STAFF_SETUP" }), 201)
    await renderPage()
    const confirm = await screen.findByRole("dialog")
    expect(within(confirm).getByText("Send the link to Ann Lee now?")).toBeInTheDocument()
    expect(within(confirm).getByLabelText("Send set-up link")).toBeChecked()
    expect(sessionStorage.getItem("staff.invite.pending")).toBeNull()
    expect(inviteCalls()).toHaveLength(1)

    fireEvent.click(within(confirm).getByRole("button", { name: "Send link" }))
    await screen.findByLabelText("Sign-in link")
    expect(inviteCalls()).toHaveLength(2)
    expect(inviteCalls()[1][0]).toBe("/admin/staff/5/invite")
  })

  it.each([
    ["INVITE_SELF", 409, null, "Change your own password or PIN from your profile."],
    ["INVITE_USER_INACTIVE", 409, null, "This person is deactivated. Activate them first."],
    ["INVITE_DEMO_ACCOUNT", 409, null, "Demo accounts can't get a link."],
    ["INVITE_REQUEST_INVALID", 400, { fields: { email: "They have no email address." } }, "Email: They have no email address."],
  ])("shows %s in the dialog", async (code, status, details, message) => {
    inviteResponse = () => errorResponse(status, code, details)
    await renderPage()
    const dialog = openLinkDialog("Bob Ray")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message)
    expect(screen.queryByLabelText("Sign-in link")).not.toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it("shows nothing to a non-admin and loads no staff", async () => {
    auth.user = { email: "chef@x.co", role: "HEAD_CHEF", name: "Chef" }
    const { container } = render(<StaffPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"))
    expect(container).toBeEmptyDOMElement()
    expect(authFetch).not.toHaveBeenCalled()
  })
})
