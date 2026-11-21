"use client"

// /invite#t=<token> (T0-6b, contract docs/2026-11-21-t0-6-invites-api-contract.md). Public: outside the app's auth
// providers (see components/providers.tsx), so no bearer token, refresh or redirect runs here.
//
// The token is read from the hash once, kept in a ref (memory only), and the hash is removed from the address bar
// and the history entry before anything is sent. It goes only in the bodies of the lookup and accept calls, and is
// never stored or logged. A refresh after that finds no token and says so.

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InviteSetupForm, type InviteCredentialsInput } from "@/components/invite/invite-setup-form"
import {
  INVALID_LINK_MESSAGE,
  InviteError,
  NO_TOKEN_MESSAGE,
  USED_LINK_SIGN_IN,
  type InviteLinkState,
  type InviteLookup,
  type SignInDestination,
  acceptInvite,
  formatInviteExpiry,
  lookupInvite,
  readHashToken,
  signInDestination,
} from "@/lib/invites"
import { handOffSignInEmail } from "@/lib/sign-in-handoff"

type PageState =
  | { kind: "loading" }
  | { kind: "no-token" }
  | { kind: "link"; state: InviteLinkState; message: string }
  // The lookup couldn't finish (429, network, server): the token is still in memory, so it can be tried again.
  | { kind: "lookup-failed"; message: string }
  | { kind: "form"; lookup: InviteLookup }
  | { kind: "done"; destination: SignInDestination; email: string | null }

// Takes the token out of the address bar and the current history entry; keeps Next's history state.
function clearHash() {
  if (!window.location.hash) return
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`)
}

export default function InvitePage() {
  const router = useRouter()
  const tokenRef = useRef<string | null>(null)
  // Read once: React runs effects twice in development, and the second run would find the hash already cleared.
  const readRef = useRef(false)
  const [state, setState] = useState<PageState>({ kind: "loading" })
  const [submitting, setSubmitting] = useState(false)
  const [serverFields, setServerFields] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const runLookup = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    setState({ kind: "loading" })
    try {
      setState({ kind: "form", lookup: await lookupInvite(token) })
    } catch (err) {
      if (err instanceof InviteError && err.linkState) {
        tokenRef.current = null
        setState({ kind: "link", state: err.linkState, message: err.message })
        return
      }
      setState({ kind: "lookup-failed", message: err instanceof Error ? err.message : "Something went wrong. Try again." })
    }
  }, [])

  useEffect(() => {
    if (readRef.current) return
    readRef.current = true
    const found = readHashToken(window.location.hash)
    clearHash()
    if (found.kind === "none") {
      setState({ kind: "no-token" })
      return
    }
    if (found.kind === "malformed") {
      setState({ kind: "link", state: "INVITE_INVALID", message: INVALID_LINK_MESSAGE })
      return
    }
    tokenRef.current = found.token
    void runLookup()
  }, [runLookup])

  const submit = async (credentials: InviteCredentialsInput) => {
    const token = tokenRef.current
    if (!token || state.kind !== "form") return
    setSubmitting(true)
    setServerFields({})
    setFormError(null)
    try {
      const result = await acceptInvite(token, credentials)
      tokenRef.current = null
      setState({ kind: "done", destination: signInDestination(result.signInWith, state.lookup.role), email: result.email })
    } catch (err) {
      if (err instanceof InviteError) {
        if (err.linkState) {
          tokenRef.current = null
          setState({ kind: "link", state: err.linkState, message: err.message })
        } else if (Object.keys(err.fields).length > 0) {
          setServerFields(err.fields)
        } else {
          setFormError(err.message)
        }
      } else {
        setFormError("Something went wrong. Try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const goSignIn = (destination: SignInDestination, email: string | null) => {
    if (destination.href === "/login") handOffSignInEmail(email)
    router.push(destination.href)
  }

  const signInButton = (destination: SignInDestination, email: string | null) => (
    <div className="space-y-2">
      <Button type="button" className="w-full" onClick={() => goSignIn(destination, email)}>
        {destination.label}
      </Button>
      {destination.hint && <p className="text-center text-sm text-muted-foreground">{destination.hint}</p>}
    </div>
  )

  let title = "Set up your sign-in"
  let description: string | null = null
  let body: React.ReactNode = null

  switch (state.kind) {
    case "loading":
      body = (
        <p role="status" className="text-sm text-muted-foreground">
          Checking your link…
        </p>
      )
      break
    case "no-token":
      body = (
        <p role="alert" className="text-sm">
          {NO_TOKEN_MESSAGE}
        </p>
      )
      break
    case "link":
      title = state.state === "INVITE_USED" ? "Link already used" : state.state === "INVITE_EXPIRED" ? "Link expired" : "Link not valid"
      body = (
        <div className="space-y-4">
          <p role="alert" className="text-sm">
            {state.message}
          </p>
          {state.state === "INVITE_USED" && signInButton(USED_LINK_SIGN_IN, null)}
        </div>
      )
      break
    case "lookup-failed":
      body = (
        <div className="space-y-4">
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
          <Button type="button" variant="outline" className="w-full" onClick={() => void runLookup()}>
            Try again
          </Button>
        </div>
      )
      break
    case "form":
      description = `Welcome, ${state.lookup.userName}. Set up your ${state.lookup.roleLabel} sign-in.`
      body = (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">This link works once and expires {formatInviteExpiry(state.lookup.expiresAt)}.</p>
          <InviteSetupForm lookup={state.lookup} submitting={submitting} serverFields={serverFields} formError={formError} onSubmit={(c) => void submit(c)} />
        </div>
      )
      break
    case "done":
      title = "You're all set"
      body = (
        <div className="space-y-4">
          <p role="status" className="text-sm">
            You&apos;re all set. Sign in with your new details.
          </p>
          {signInButton(state.destination, state.email)}
        </div>
      )
      break
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </main>
  )
}
