"use client"

// O3: registers the POS service worker and activates a waiting update on the sign-in screen only. Renders nothing.

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { activateWaitingUpdate, registerPosServiceWorker, serviceWorkerSupported } from "@/lib/offline/sw-register"

export function ServiceWorker() {
  const pathname = usePathname()
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    let alive = true
    void registerPosServiceWorker().then((reg) => {
      if (alive) setRegistration(reg)
    })
    return () => {
      alive = false
    }
  }, [])

  // A new version took over (only ever asked for on the sign-in screen): reload once onto it. Not on the very first
  // install, when there was no worker before.
  useEffect(() => {
    if (!serviceWorkerSupported()) return
    const container = navigator.serviceWorker
    const hadController = Boolean(container.controller)
    let reloaded = false
    const onControllerChange = () => {
      if (!hadController || reloaded) return
      reloaded = true
      window.location.reload()
    }
    container.addEventListener("controllerchange", onControllerChange)
    return () => container.removeEventListener("controllerchange", onControllerChange)
  }, [])

  // A waiting update: now (on arriving at the sign-in screen) or as soon as one finishes installing.
  useEffect(() => {
    if (!registration) return
    void activateWaitingUpdate(registration, pathname)
    const onUpdateFound = () => {
      const installing = registration.installing
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed") void activateWaitingUpdate(registration, pathname)
      })
    }
    registration.addEventListener("updatefound", onUpdateFound)
    return () => registration.removeEventListener("updatefound", onUpdateFound)
  }, [registration, pathname])

  return null
}
