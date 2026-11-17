import { ShiftProvider } from "@/contexts/shift-context";
import { ConnectionProvider } from "@/contexts/connection-context";
import { AutoLock } from "@/components/pos/auto-lock";

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider>
      <ShiftProvider>
        {children}
        {/* Every POS screen with a signed-in session: /pos and /pos/shift-open. Inactive on sign-in (no session). */}
        <AutoLock />
      </ShiftProvider>
    </ConnectionProvider>
  );
}
