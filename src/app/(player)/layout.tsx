import { ConfirmProvider } from "@/components/player/ConfirmDialog";

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950">
      <ConfirmProvider>{children}</ConfirmProvider>
    </div>
  );
}
