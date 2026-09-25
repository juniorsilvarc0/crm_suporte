import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { LogoMark } from "@/components/ui/logo-mark";
import { siteConfig } from "@/config/site";

const CONTACT_EMAIL = "privacidade@spincode.com.br";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Política de privacidade do ${siteConfig.name} — em revisão.`,
  robots: { index: false, follow: false },
};

/**
 * Aviso provisório.
 *
 * A política anterior foi escrita para o CRM de clínica de origem (a clínica
 * como controladora, dados de saúde, anúncios da Meta) e deixou de ser
 * verdadeira com a poda da Fase 1. Publicar texto jurídico falso é pior que
 * não ter texto: a política definitiva do CRM de suporte precisa de revisão
 * jurídica e é pré-requisito do deploy (Fase 10 de docs/PLANO-IMPLANTACAO.md).
 * O texto antigo está na tag local `legado-clinica`.
 */
export default function PoliticaDePrivacidadePage() {
  return (
    <main className="min-h-dvh bg-transparent text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:py-16">
          <Link
            href="/login"
            className="inline-flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <LogoMark size={40} aria-label={siteConfig.name} className="shrink-0" />
            <span className="text-sm font-semibold">{siteConfig.name}</span>
          </Link>

          <h1 className="mt-9 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Política de Privacidade
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
            Esta política está em revisão. O {siteConfig.name} está em implantação
            e a versão definitiva — quem trata os dados, quais dados, para quê, por
            quanto tempo e como exercer seus direitos — será publicada aqui antes
            de o sistema entrar em operação.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          Dúvidas sobre dados pessoais podem ser enviadas para:
        </p>
        <a
          className="mt-3 inline-flex items-center gap-1.5 rounded-sm text-base font-medium underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
          href={`mailto:${CONTACT_EMAIL}`}
        >
          {CONTACT_EMAIL}
          <ArrowUpRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </a>
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-12 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{siteConfig.name} · política em revisão</p>
          <Link
            className="rounded-sm underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
            href="/login"
          >
            Acessar o painel
          </Link>
        </div>
      </footer>
    </main>
  );
}
