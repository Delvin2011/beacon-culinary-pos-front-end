"use client"

import * as React from "react"
import {
  ChartNoAxesCombined,
  Fuel,
  Monitor,
  ShieldCheck,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { useAuth } from "@/hooks/use-auth"
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
        },
        {
          title: "Daily Planning",
          url: "/daily-planning",
        },
        {
          title: "Inventory",
          url: "/inventory",
        },
        {
          title: "Stock Requests",
          url: "/inventory/stock-requests",
        },
        {
          title: "Stock Takes",
          url: "/inventory/stock-takes",
        },
        {
          title: "Accounts",
          url: "/accounts",
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
          adminOnly: true,
        },
      ],
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuth()
  const isAdmin = !!user?.role?.toUpperCase().includes("ADMIN")
  const navMain = React.useMemo(
    () =>
      data.navMain.map((group) => ({
        ...group,
        items: group.items.filter((item) => !("adminOnly" in item && item.adminOnly) || isAdmin),
      })),
    [isAdmin],
  )

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