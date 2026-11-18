import { ShiftProvider } from "@/contexts/shift-context";
import { ConnectionProvider } from "@/contexts/connection-context";
import { AutoLock } from "@/components/pos/auto-lock";
import { OfflineHeartbeat } from "@/components/pos/offline-heartbeat";
import { OfflineProvider } from "@/contexts/offline-context";
import { OutboxProvider } from "@/contexts/outbox-context";
import { ServiceWorker } from "@/components/pos/service-worker";

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider>
      {/* O3: the POS shell offline (production builds only). Updates activate on the sign-in screen. */}
      <ServiceWorker />
      {/* O3: every POS screen, signed in or not, whatever offlineEnabled says. Needs only the till cookie. */}
      <OfflineHeartbeat />
      {/* O4: the offline sales waiting to send, on every POS screen (sign-in included: sync needs only the cookie). */}
      <OutboxProvider>
        <ShiftProvider>
          {/* O3: offline grant, snapshot and the deletion rules. Needs the session and the shift. */}
          <OfflineProvider>{children}</OfflineProvider>
          {/* Every POS screen with a signed-in session: /pos and /pos/shift-open. Inactive on sign-in (no session). */}
          <AutoLock />
        </ShiftProvider>
      </OutboxProvider>
    </ConnectionProvider>
  );
}
