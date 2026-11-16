import { ShiftProvider } from "@/contexts/shift-context";
import { ConnectionProvider } from "@/contexts/connection-context";

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider>
      <ShiftProvider>{children}</ShiftProvider>
    </ConnectionProvider>
  );
}
