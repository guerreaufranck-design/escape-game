"use client";

import Link from "next/link";
import { Gamepad2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { APP_NAME } from "@/lib/constants";
import { LocaleSelector } from "@/components/player/LocaleSelector";

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  const { isInstallable, install } = useInstallPrompt();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <Gamepad2 className="size-5 text-emerald-500" />
          <span className="text-sm font-bold text-zinc-100">
            {title ?? APP_NAME}
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <LocaleSelector />
          {isInstallable && (
            <Button
              variant="outline"
              size="sm"
              onClick={install}
              className="gap-1.5"
            >
              <Download className="size-3.5" />
              Installer
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
