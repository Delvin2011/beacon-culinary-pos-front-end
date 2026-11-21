import type { Metadata } from "next"

// The invite page (T0-6b). The token lives in the URL hash, which browsers never send anywhere; these keep the
// page out of search results and send no Referer from it.
export const metadata: Metadata = {
  title: "Set up your sign-in",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children
}
