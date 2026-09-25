import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { CheckIcon, ShieldCheckIcon } from "lucide-react";

import { LoginForm } from "@/features/auth/components/login-form";
import { BrandSignature } from "@/components/ui/brand-signature";
import { LogoMark } from "@/components/ui/logo-mark";
import { Spinner } from "@/components/kibo-ui/spinner";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Acesso ao painel",
  robots: { index: false, follow: false },
};

const highlights = [
  "Chamados do WhatsApp num só lugar",
  "Triagem por IA integrada via API",
  "Fila por produto e prazo de SLA",
  "Clientes, contratos e histórico",
];

export default function LoginPage() {
  return (
    <main className="min-h-dvh bg-transparent text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-[76rem] items-center justify-center p-4 sm:p-6 lg:p-10">
        <section className="grid w-full overflow-hidden rounded-3xl border border-border/50 bg-card shadow-soft-lg lg:grid-cols-[1.32fr_1fr] dark:shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          {/*
            A imagem preenche o painel e aparece NÍTIDA. A coluna carrega a
            proporção original da imagem (1224×998), então o `object-cover` não
            tem o que cortar — e o escurecimento é um degradê horizontal forte
            só na faixa onde o texto pousa, transparente no resto, para a
            imagem continuar legível à direita.

            ⚠️ O véu vai até 85% porque é ATÉ LÁ que o texto pousa: o bloco tem
            largura fixa (22rem + padding), então quanto mais estreito o painel,
            maior a FRAÇÃO dele que o texto ocupa. A 1024px o texto alcança ~73%
            da largura — com o degrade antigo (fim em 72%) as últimas palavras
            caíam sobre a foto crua, medido em 1,00:1. Encurtar estes stops
            devolve o problema.
          */}
          <div className="relative hidden overflow-hidden bg-[oklch(0.19_0.05_243)] lg:block lg:aspect-[1224/998]">
            <Image
              src="/brand/login-bg.png"
              alt=""
              fill
              sizes="(min-width: 1024px) 55vw, 0px"
              className="object-cover object-center"
              priority
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-r from-[oklch(0.16_0.045_243)]/88 from-10% via-[oklch(0.16_0.045_243)]/62 via-75% to-transparent to-85%"
            />

            <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-12">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-white/95 shadow-lg">
                  <LogoMark size={28} aria-label="" />
                </span>
                <span className="font-display text-xl font-semibold uppercase tracking-[0.22em] text-white">
                  {siteConfig.name}
                </span>
              </div>

              <div className="max-w-[22rem] space-y-4">
                <BrandSignature
                  tone="on-photo"
                  className="text-[1.65rem] leading-tight text-balance"
                />
                <p className="text-sm leading-6 text-white/85">
                  Centralize os chamados de suporte, o atendimento no WhatsApp e a operação
                  da equipe em uma única plataforma, integrada à sua IA de triagem.
                </p>

                <ul className="grid gap-2.5 pt-1 text-sm text-white/90">
                  {highlights.map((item) => (
                    <li key={item} className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[oklch(0.72_0.11_190)]/20 text-[oklch(0.85_0.1_190)] ring-1 ring-[oklch(0.8_0.1_190)]/40"
                      >
                        <CheckIcon className="size-3" strokeWidth={2.5} />
                      </span>
                      <span className="text-balance">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Formulário — centrado no eixo vertical, com respiro generoso. */}
          <div className="flex items-center justify-center p-6 sm:p-10 lg:p-10 xl:p-12">
            <div className="w-full max-w-sm">
              {/* No celular o painel da imagem não aparece; a marca vem aqui. */}
              <div className="mb-10 flex items-center gap-3 lg:hidden">
                <LogoMark size={38} aria-label="" className="shrink-0" />
                <div className="min-w-0">
                  <div className="font-display text-base font-semibold uppercase tracking-[0.14em]">
                    {siteConfig.name}
                  </div>
                  <BrandSignature tone="muted" className="text-xs" />
                </div>
              </div>

              {/* O título saiu da tela a pedido, mas a página continua precisando
                  de um: leitor de tela e busca leem a estrutura, não o visual. */}
              <h1 className="sr-only">Entrar na {siteConfig.name}</h1>

              {/* Sem título e sem sobrelinha, esta frase é o único texto antes
                  dos campos: ela ganha o corpo que sustenta o topo da coluna. */}
              <p className="font-display text-[1.35rem] font-medium leading-snug text-foreground">
                Use suas credenciais para acessar.
              </p>

              <div className="mt-7">
                <Suspense
                  fallback={
                    <div className="flex h-44 items-center justify-center">
                      <Spinner variant="ring" className="size-6 text-muted-foreground" />
                    </div>
                  }
                >
                  <LoginForm />
                </Suspense>
              </div>

              <div className="mt-8 flex flex-col items-center gap-2.5 border-t border-border/60 pt-5">
                <Link
                  href="/politica-de-privacidade"
                  className="rounded-sm text-xs text-muted-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Política de Privacidade
                </Link>
                <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <ShieldCheckIcon className="size-3.5 text-primary" strokeWidth={2} aria-hidden />
                  Plataforma segura
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
