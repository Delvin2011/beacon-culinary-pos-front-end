"use client";

import { type ReactNode, useEffect } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/contexts/auth-context";
import { Toaster } from "@/components/ui/toaster";
import { CustomerStatusGate } from "@/components/customer/customer-status-gate";
import { useCustomerBranding } from "@/hooks/use-customer-branding";
import { loadCustomerBranding } from "@/lib/customer-branding";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { name } = useCustomerBranding();
  // T1-8: the customer's name, fetched once per page load; the tab shows it on every route.
  useEffect(() => {
    void loadCustomerBranding();
  }, []);
  useEffect(() => {
    document.title = name;
  }, [name, pathname]);
  // Public pages outside the app's auth: the order board, and the invite page (T0-6b: no auth client, no bearer
  // token and no refresh may run where an invite token is handled).
  const isPublicRoute = pathname === "/board" || pathname === "/invite";

  // T1-3: every screen, public ones included, shows a suspended customer, an unknown address and (away from the POS)
  // an unavailable one.
  if (isPublicRoute) {
    return <CustomerStatusGate>{children}</CustomerStatusGate>;
  }

  return (
    <CustomerStatusGate>
      <AuthProvider>
        {children}
        <Toaster />
      </AuthProvider>
    </CustomerStatusGate>
  );
}
