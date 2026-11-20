"use client"

// Warns before leaving a page with unsaved edits.
// - Reload, closing the tab, or typing another address: the browser's own "Leave site?" prompt (beforeunload).
// - Clicking a link inside the app (sidebar, breadcrumbs): the click is stopped before Next's router sees it and the
//   page asks first (pendingHref); leave() then goes there.
// Not covered: the browser's Back/Forward buttons, and navigation started in code (router.push). The App Router has no
// event to cancel those. The page's own code-driven navigation (the password re-sign-in) calls allowLeave() first.

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

export interface UnsavedChangesGuard {
  // The in-app link the user clicked while there were unsaved edits; ask before going.
  pendingHref: string | null
  stay: () => void
  leave: () => void
  // Leave without asking from now on (e.g. the re-sign-in, which keeps the edits).
  allowLeave: () => void
}

export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const bypass = useRef(false)

  useEffect(() => {
    if (!dirty) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return
      event.preventDefault()
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = ""
    }

    const onClick = (event: MouseEvent) => {
      if (bypass.current || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return // a new tab or window: nothing lost
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!(anchor instanceof HTMLAnchorElement)) return
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return
      const url = new URL(anchor.href, window.location.href)
      // Another site: the full page unload asks (beforeunload).
      if (url.origin !== window.location.origin) return
      // A link to this same page (e.g. an anchor): nothing is lost.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      event.preventDefault()
      event.stopPropagation()
      setPendingHref(`${url.pathname}${url.search}${url.hash}`)
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    // Capture on the document runs before React's own listeners on the root, so Next's <Link> never sees the click.
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [dirty])

  const stay = useCallback(() => setPendingHref(null), [])

  const leave = useCallback(() => {
    const href = pendingHref
    setPendingHref(null)
    bypass.current = true
    if (href) router.push(href)
  }, [pendingHref, router])

  const allowLeave = useCallback(() => {
    bypass.current = true
  }, [])

  return { pendingHref, stay, leave, allowLeave }
}
