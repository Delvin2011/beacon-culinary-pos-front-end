import { Suspense } from "react"
import { DashboardView } from "@/components/dashboard/dashboard-view"

// The back-office landing page. The server's layout decides which sections show; ?range= is kept in the URL.
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardView />
    </Suspense>
  )
}
