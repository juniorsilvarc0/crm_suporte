import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";

import { LogoMark } from "@/components/ui/logo-mark";
import { siteConfig } from "@/config/site";
import {
  isPolicyDraft,
  POLICY_PLACEHOLDER,
  PRIVACY_POLICY,
  type PolicyBlock,
} from "@/features/legal/privacy-policy";

const PRODUCT = `${siteConfig.brand} ${siteConfig.name}`;
// Enquanto houver trecho a preencher, a página se declara rascunho e não é
// indexada: texto jurídico incompleto não pode passar pela política vigente.
const DRAFT = isPolicyDraft();

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Como o ${PRODUCT} trata dados pessoais.`,
  ...(DRAFT ? { robots: { index: false, follow: false } } : {}),
};

/** O texto, com cada trecho a preencher destacado (só existe no rascunho). */
function PolicyText({ text }: { text: string }) {
  const parts = text.split(POLICY_PLACEHOLDER);
  // split com grupo de captura: posições ímpares são o conteúdo de um [[ ]].
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">
        [{part}]
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    )
  );
}

function Block({ block }: { block: PolicyBlock }) {
  if (block.kind === "p") {
    return (
      <p className="text-base leading-7 text-muted-foreground">
        <PolicyText text={block.text} />
      </p>
    );
  }
  return (
    <ul className="grid list-disc gap-2 pl-5 text-base leading-7 text-muted-foreground marker:text-border">
      {block.items.map((item) => (
        <li key={item}>
          <PolicyText text={item} />
        </li>
      ))}
    </ul>
  );
}

export default function PoliticaDePrivacidadePage() {
  return (
    <main className="min-h-dvh bg-transparent text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
          <Link
            href="/login"
            className="inline-flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <LogoMark size={40} aria-label="" className="shrink-0" />
            <span className="text-sm font-semibold">{PRODUCT}</span>
          </Link>

          <h1 className="mt-9 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Política de Privacidade
          </h1>
          <p className="mt-6 text-base leading-7 text-muted-foreground">
            Como o {PRODUCT} trata os dados pessoais de quem fala com o nosso suporte e da nossa equipe: quais dados,
            para quê, com quem, por quanto tempo e como exercer os seus direitos.
          </p>

          {DRAFT ? (
            <p
              role="note"
              className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6 text-amber-800 dark:text-amber-300"
            >
              <strong className="font-semibold">Rascunho em revisão jurídica.</strong> Esta ainda não é a política
              vigente: os trechos destacados serão preenchidos antes da publicação.
            </p>
          ) : null}

          <nav aria-label="Nesta página" className="mt-8">
            <ol className="grid gap-1.5 text-sm">
              {PRIVACY_POLICY.sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="rounded-sm text-muted-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {index + 1}. {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-3xl gap-12 px-4 py-12 sm:px-6">
        {PRIVACY_POLICY.sections.map((section, index) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-titulo`} className="grid scroll-mt-6 gap-4">
            <h2 id={`${section.id}-titulo`} className="text-xl font-semibold tracking-tight">
              {index + 1}. {section.title}
            </h2>
            {section.blocks.map((block, blockIndex) => (
              <Block key={blockIndex} block={block} />
            ))}
          </section>
        ))}
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-12 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            {PRODUCT} · {DRAFT ? "rascunho em revisão" : "última atualização: "}
            {DRAFT ? null : <PolicyText text={PRIVACY_POLICY.updatedAt} />}
          </p>
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
