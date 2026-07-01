import { ConfirmProvider } from "@/components/player/ConfirmDialog";
import { ServiceWorkerRegister } from "@/components/player/ServiceWorkerRegister";

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950">
      <ServiceWorkerRegister />
      <ConfirmProvider>{children}</ConfirmProvider>
    </div>
  );
}
