"use client"

import { FormEvent, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Image from "next/image"
import { useAuth } from "@/hooks/use-auth"
import { useLoginBlocks } from "@/hooks/use-login-blocks"
import { LoginBlockedError } from "@/contexts/auth-context"
import { isAdminRole, landingPathFor } from "@/lib/roles"
import { safeReturnTo } from "@/lib/return-to"
import loginImage from "../app/assets/images/beacon_login_image.png"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // /login?reauth=1&returnTo=/devices…: a fresh password sign-in to manage tills. returnTo is checked
  // against the allowlist; anything else is ignored.
  const reauth = searchParams.get("reauth") === "1"
  const returnTo = safeReturnTo(searchParams.get("returnTo"))
  // True once someone signs in on this page: with reauth=1 an existing session doesn't move on by itself.
  const [signedInHere, setSignedInHere] = useState(false)
  const [notManager, setNotManager] = useState(false)
  const { login, isLoading, error, clearError, isAuthenticated, user } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const blocks = useLoginBlocks<"self">()
  const blockState = blocks.get("self")
  const message = blockState?.message ?? error

  // Signed in (now or from an earlier visit): go back to returnTo (admins only) or to the user's landing page.
  // Until U2 the dashboard is the landing page for Admin and Head Chef only; everyone else goes to the screen they work on.
  useEffect(() => {
    if (!isAuthenticated) return
    if (reauth && !signedInHere) return
    if (returnTo) {
      if (isAdminRole(user?.role)) router.replace(returnTo)
      else setNotManager(true)
      return
    }
    router.push(landingPathFor(user?.role))
  }, [isAuthenticated, reauth, returnTo, signedInHere, user?.role, router])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (blockState?.active) return
    blocks.clear("self")
    setNotManager(false)

    try {
      await login({ email, password })
      // Replaces any current session; the effect above routes once it is stored.
      setSignedInHere(true)
    } catch (err) {
      // Other errors are stored in the auth context for rendering.
      if (err instanceof LoginBlockedError) {
        // The countdown shows the message; the context's copy would go stale when it ends.
        blocks.block("self", err.block)
        clearError()
      }
      setPassword("")
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form className="p-6 md:p-8" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center text-center">
                <h1 className="text-2xl font-bold">Welcome back</h1>
                <p className="text-balance text-muted-foreground">
                  Login to your Beacon Culinary Account
                </p>
              </div>

              {reauth && !notManager && (
                <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
                  Sign in again with your password to manage tills.
                </div>
              )}

              {notManager && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Only managers can register tills.{" "}
                  <a className="underline" href={landingPathFor(user?.role)}>
                    Continue
                  </a>
                </div>
              )}

              {message && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {message}
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(event) => {
                    if (error) {
                      clearError()
                    }
                    setEmail(event.target.value)
                  }}
                  required
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                  <a
                    href="#"
                    className="ml-auto text-sm underline-offset-2 hover:underline"
                  >
                    Forgot your password?
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    if (error) {
                      clearError()
                    }
                    setPassword(event.target.value)
                  }}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={isLoading || blockState?.active}>
                {isLoading ? "Logging in..." : "Login"}
              </Button>
            </div>
          </form>
          <div className="relative hidden bg-muted md:block">
            <Image
              src={loginImage}
              alt="Image"
              fill
              className="object-cover dark:brightness-[0.2] dark:grayscale"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


/*
On submit:
calls login from context
stores token centrally
redirects to /dashboard on success
Shows API error message in UI when login fails.
Removed nested anchor inside submit button.
Updated next/image usage to modern fill + object-cover.
Social buttons set to type button to avoid accidental form submit.
*/