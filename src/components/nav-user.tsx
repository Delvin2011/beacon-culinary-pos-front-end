"use client"

import { useRouter } from "next/navigation"
import { Bell, ChevronsUpDown, LogOut } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/use-auth"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

// "HEAD_CHEF" / "ROLE_HEAD_CHEF" → "Head chef".
function roleLabel(role?: string): string | null {
  const words = (role ?? "").replace(/^ROLE_/i, "").replaceAll("_", " ").trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null
}

// "Thandiwe Mokoena" → "TM"; "headchef@canteen.local" → "HE".
function initials(name: string): string {
  const source = name.includes("@") ? name.split("@")[0] : name
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)
  return letters.toUpperCase() || "?"
}

// The signed-in user, from the session: name (or role when the server sends no name) and email.
export function NavUser() {
  const router = useRouter()
  const { user, logout } = useAuth()
  const { isMobile } = useSidebar()

  const email = user?.email ?? ""
  const role = roleLabel(user?.role)
  const title = user?.name?.trim() || role || email || "Signed in"
  const subtitle = email && email !== title ? email : role && role !== title ? role : null

  const identity = (
    <>
      <Avatar className="h-8 w-8 rounded-lg">
        <AvatarFallback className="rounded-lg">{initials(user?.name?.trim() || email || title)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">{title}</span>
        {subtitle && <span className="truncate text-xs">{subtitle}</span>}
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {identity}
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">{identity}</div>
              {role && role !== title && role !== subtitle && (
                <div className="px-1 pb-1.5 text-xs text-muted-foreground">{role}</div>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Notifications: not built yet. */}
            <DropdownMenuItem>
              <Bell />
              Notifications
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                logout()
                router.replace("/login")
              }}
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
