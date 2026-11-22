// T0-8 part 3: /login takes its heading and image from src/lib/brand.ts; the image's alt text names the brand.
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { LoginForm } from "@/components/login-form"
import { BRAND } from "@/lib/brand"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
// Next imports the PNG as image data; the test runner as a plain path.
const srcOf = (src: string | { src: string }) => (typeof src === "string" ? src : src.src)
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string | { src: string } }) => <img alt={alt} src={typeof src === "string" ? src : src.src} />,
}))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal("fetch", vi.fn())
})

describe("login brand", () => {
  it("shows the brand's heading and image", () => {
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    )
    expect(screen.getByText(BRAND.loginHeading)).toBeInTheDocument()
    expect(screen.getByText("Login to your Beacon Culinary Account")).toBeInTheDocument()
    const image = screen.getByRole("img", { name: BRAND.loginImageAlt })
    expect(image).toHaveAttribute("alt", "Beacon Culinary")
    expect(image.getAttribute("src")).toBe(srcOf(BRAND.loginImage as unknown as string | { src: string }))
  })
})
