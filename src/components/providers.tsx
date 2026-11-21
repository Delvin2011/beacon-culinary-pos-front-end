"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/contexts/auth-context";
import { Toaster } from "@/components/ui/toaster";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Public pages outside the app's auth: the order board, and the invite page (T0-6b: no auth client, no bearer
  // token and no refresh may run where an invite token is handled).
  const isPublicRoute = pathname === "/board" || pathname === "/invite";

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <AuthProvider>
      {children}
      <Toaster />
    </AuthProvider>
  );
}
