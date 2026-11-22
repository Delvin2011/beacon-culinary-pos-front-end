"use client"

import * as React from "react"
import {
  ChartNoAxesCombined,
  FileBarChart,
  Fuel,
  Monitor,
  ShieldCheck,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { useAuth } from "@/hooks/use-auth"
import { BRAND } from "@/lib/brand"
import { fetchOpenExceptionCount } from "@/lib/sale-exceptions"
import { canManageInventory, canManageMenu, canManageStockTakes, canViewDashboard, canViewReports, isAdminRole, isBaristaRole } from "@/lib/roles"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

const data = {
  teams: [
    {
      name: BRAND.name,
      logo: Fuel,
      plan: BRAND.planLabel,
    },
  ],
  navMain: [
    {
      title: "Overview",
      url: "/dashboard",
      icon: ChartNoAxesCombined,
      isActive: true,
      items: [
        {
          title: "Dashboard",
          url: "/dashboard",
          access: "dashboard" as const,
        },
      ],
    },
    {
      title: "Admin",
      url: "#",
      icon: ShieldCheck,
      isActive: true,
      items: [
        {
          title: "Catalog Management",
          url: "/catalog",
          access: "menu" as const,
        },
        {
          title: "Daily Planning",
          url: "/daily-planning",
          access: "menu" as const,
        },
        {
          title: "Inventory",
          url: "/inventory",
          access: "inventory" as const,
        },
        {
          title: "Stock Requests",
          url: "/inventory/stock-requests",
          access: "inventory" as const,
        },
        {
          title: "Stock Takes",
          url: "/inventory/stock-takes",
          access: "stockTakes" as const,
        },
        {
          title: "Accounts",
          url: "/accounts",
          access: "admin" as const,
        },
        {
          title: "Staff",
          url: "/staff",
          access: "admin" as const,
        },
        {
          title: "Registered tills",
          url: "/devices",
          access: "admin" as const,
        },
        {
          title: "Sale exceptions",
          url: "/sale-exceptions",
          access: "admin" as const,
        },
        {
          title: "Site settings",
          url: "/site-settings",
          access: "admin" as const,
        },
        {
          title: "Meal periods",
          url: "/meal-periods",
          access: "admin" as const,
        },
        {
          title: "Stock locations",
          url: "/stock-locations",
          access: "admin" as const,
        },
      ],
    },
    {
      title: "Reports",
      url: "/reports",
      icon: FileBarChart,
      isActive: true,
      access: "reports" as const,
      items: [
        {
          title: "All Reports",
          url: "/reports",
        },
      ],
    },
    {
      title: "POS Terminal",
      url: "/pos/login",
      icon: Monitor,
      isActive: false,
      items: [
        {
          title: "Cashier Login",
          url: "/pos/login",
        },
        {
          title: "POS Activity",
          url: "/pos-activity",
          access: "admin" as const,
        },
      ],
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, authFetch } = useAuth()
  const role = user?.role
  // O4: open REVIEW sale exceptions (GET /admin/sale-exceptions?size=1, totalItems), for admins, every minute.
  const [openExceptions, setOpenExceptions] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!isAdminRole(role)) return
    let active = true
    const load = () =>
      void fetchOpenExceptionCount(authFetch).then((count) => {
        if (active) setOpenExceptions(count)
      })
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [role, authFetch])
  const navMain = React.useMemo(() => {
    // A Barista only works the bar display: no back-office menus at all.
    if (isBaristaRole(role)) return []
    // Each tag maps to a role helper in lib/roles. Untagged: everyone.
    const allowed = (entry: object) => {
      const access = "access" in entry ? entry.access : undefined
      if (access === "admin") return isAdminRole(role)
      if (access === "inventory") return canManageInventory(role)
      if (access === "stockTakes") return canManageStockTakes(role)
      if (access === "menu") return canManageMenu(role)
      if (access === "reports") return canViewReports(role)
      if (access === "dashboard") return canViewDashboard(role)
      return true
    }
    return data.navMain
      .filter(allowed)
      .map((group) => ({
        ...group,
        items: group.items.filter(allowed).map((item) => (item.url === "/sale-exceptions" ? { ...item, badge: openExceptions } : item)),
      }))
      .filter((group) => group.items.length > 0)
  }, [role, openExceptions])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
