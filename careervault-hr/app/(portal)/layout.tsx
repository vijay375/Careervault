import { HrShell } from "@/components/hr-shell";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <HrShell>{children}</HrShell>;
}
