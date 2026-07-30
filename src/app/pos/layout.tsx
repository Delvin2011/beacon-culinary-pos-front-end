import { ShiftProvider } from "@/contexts/shift-context";

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <ShiftProvider>{children}</ShiftProvider>;
}
