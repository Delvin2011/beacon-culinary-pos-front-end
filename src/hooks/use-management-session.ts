"use client";

import { useContext } from "react";
import { ManagementSessionContext } from "@/contexts/management-session-context";

export function useManagementSession() {
  const context = useContext(ManagementSessionContext);

  if (!context) {
    throw new Error("useManagementSession must be used within a ManagementSessionProvider.");
  }

  return context;
}
