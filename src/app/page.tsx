"use client"

// "/" has no page of its own: signed in, go to the same landing page sign-in uses; otherwise to /login.
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { landingPathFor } from "@/lib/roles"

export default function Home() {
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuth()

  useEffect(() => {
    if (isLoading) return
    router.replace(isAuthenticated ? landingPathFor(user?.role) : "/login")
  }, [isAuthenticated, isLoading, user?.role, router])

  return null
}
