"use client"

import { useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { isAdminRole, landingPathFor } from "@/lib/roles"
import { reauthLoginPath, type ReturnToPath } from "@/lib/return-to"

// The device pages are ADMIN only. Signed out: password sign-in, then back here. Signed in without ADMIN: the
// user's own landing page. True once the page may render.
export function useDeviceAdminGuard(returnTo: ReturnToPath): boolean {
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuth()
  const isAdmin = isAdminRole(user?.role)

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace(reauthLoginPath(returnTo))
      return
    }
    if (!isAdmin) router.replace(landingPathFor(user?.role))
  }, [isAdmin, isAuthenticated, isLoading, returnTo, router, user?.role])

  return !isLoading && isAuthenticated && isAdmin
}

export function DevicePageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">Admin</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
