"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/contexts/auth-context";
import { Toaster } from "@/components/ui/toaster";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublicBoardRoute = pathname === "/board";

  if (isPublicBoardRoute) {
    return <>{children}</>;
  }

  return (
    <AuthProvider>
      {children}
      <Toaster />
    </AuthProvider>
  );
}
