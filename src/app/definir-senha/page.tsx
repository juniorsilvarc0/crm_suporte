import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRoundIcon } from "lucide-react";

import { DefinirSenhaForm } from "@/features/auth/components/definir-senha-form";
import { LogoMark } from "@/components/ui/logo-mark";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Definir senha",
  description: "Primeiro acesso",
  robots: { index: false, follow: false },
};

export default async function DefinirSenhaPage() {
  const viewer = await getDashboardViewer();
  // Sem sessão válida → login. Sem exigência pendente → o app (nada a fazer aqui).
  if (!viewer) redirect("/api/auth/logout");
  if (!viewer.must_change_password) redirect("/app");

  return (
    <main className="grid min-h-dvh place-items-center bg-transparent px-5 py-10 text-foreground">
      <section className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-soft-lg sm:p-8 dark:shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-3">
          <LogoMark size={40} aria-label={siteConfig.name} className="shrink-0" />
          <div>
            <div className="font-display text-base font-semibold">{siteConfig.name}</div>
            <div className="text-xs text-muted-foreground">CRM inteligente</div>
          </div>
        </div>

        <div className="mt-8 space-y-2">
          <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRoundIcon className="size-5" />
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Defina sua senha</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Olá, {viewer.name.split(" ")[0]}. Este é o seu primeiro acesso — crie
            uma senha própria para continuar.
          </p>
        </div>

        <div className="mt-8">
          <DefinirSenhaForm />
        </div>
      </section>
    </main>
  );
}
