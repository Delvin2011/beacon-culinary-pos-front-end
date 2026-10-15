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
import { canManageInventory, canManageMenu, canManageStockTakes, isAdminRole } from "@/lib/roles"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

const data = {
  user: {
    name: "Admin",
    email: "admin@beaconculinary.com",
    avatar: "",
  },
  teams: [
    {
      name: "Beacon Culinary",
      logo: Fuel,
      plan: "Canteen",
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
      ],
    },
    {
      title: "Reports",
      url: "/reports",
      icon: FileBarChart,
      isActive: true,
      access: "admin" as const,
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
  const { user } = useAuth()
  const role = user?.role
  const navMain = React.useMemo(() => {
    // Each tag maps to a role helper in lib/roles. Untagged: everyone.
    const allowed = (entry: object) => {
      const access = "access" in entry ? entry.access : undefined
      if (access === "admin") return isAdminRole(role)
      if (access === "inventory") return canManageInventory(role)
      if (access === "stockTakes") return canManageStockTakes(role)
      if (access === "menu") return canManageMenu(role)
      return true
    }
    return data.navMain
      .filter(allowed)
      .map((group) => ({ ...group, items: group.items.filter(allowed) }))
      .filter((group) => group.items.length > 0)
  }, [role])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}