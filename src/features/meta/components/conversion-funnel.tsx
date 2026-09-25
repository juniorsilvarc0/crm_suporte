import { TrendingDownIcon } from "lucide-react";

import {
  formatList,
  splitTrailingEmptyStages,
  type ConversionFunnel,
  type SpendSummary,
} from "@/features/meta/funnel";
import type { MetaInsightsFailure } from "@/features/meta/insights";
import { formatMoney } from "@/lib/formatters/money";
import { formatPercentage } from "@/lib/formatters/percentage";
import { cn } from "@/lib/utils";

const failureMessage: Record<MetaInsightsFailure, string> = {
  nao_configurado:
    "Não dá para mostrar o investimento: falta configurar o acesso à Meta no servidor.",
  erro_meta: "Não dá para mostrar o investimento agora: a Meta não respondeu.",
};

/**
 * Do primeiro contato ao paciente, etapa por etapa.
 *
 * ⚠️ **A perda é a informação, não o que sobrou.** A versão anterior mostrava
 * "3% da etapa anterior" numa linha fina ACIMA de cada etapa — parecia
 * pertencer à etapa de cima — e a barra de 1,5px de uma etapa com 3 de 144 leads
 * era invisível. Quem lia não descobria o que importa: que 140 pessoas pararam
 * ali. Agora a queda vem em número absoluto, com o percentual como apoio.
 *
 * ⚠️ **Etapas zeradas no fim viram uma linha só.** Três linhas idênticas dizendo
 * "0 · 0%" ocupavam um terço do cartão sem informar nada. Os nomes continuam na
 * tela — só não custam mais uma linha cada.
 *
 * ⚠️ **A palavra "coorte" saiu daqui.** É jargão de analytics; quem opera a
 * clínica lê "as pessoas que chegaram no período".
 */
export function ConversionFunnel({
  funnel,
  spend,
  insightsFailure,
}: {
  funnel: ConversionFunnel;
  spend: SpendSummary | null;
  insightsFailure: MetaInsightsFailure | null;
}) {
  const { reached, pending } = splitTrailingEmptyStages(funnel.stages);
  const notes = buildNotes(funnel, spend, insightsFailure);

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
      <header className="border-b border-border/60 p-4">
        <h2 className="text-sm font-semibold">Do primeiro contato ao paciente</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {funnel.contacts > 0
            ? `${funnel.contacts} ${funnel.contacts === 1 ? "pessoa falou" : "pessoas falaram"} com a clínica pelo anúncio no período. Veja até onde cada uma chegou.`
            : "Ninguém chegou pelo anúncio no período escolhido."}
        </p>
      </header>

      {funnel.contacts === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          Sem contatos vindos de anúncio neste período. Tente um intervalo maior.
        </p>
      ) : funnel.stages.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          Nenhuma etapa do funil está marcada como conversão. Marque as etapas em
          Funil para acompanhar o avanço por aqui.
        </p>
      ) : (
        <ol className="flex flex-col p-4">
          <StageRow label="Contato" leads={funnel.contacts} shareOfTop={100} />
          {reached.map((stage, index) => (
            <StageRow
              key={stage.key}
              label={stage.label}
              leads={stage.leads}
              shareOfTop={stage.shareOfTop}
              previousLeads={index === 0 ? funnel.contacts : reached[index - 1].leads}
            />
          ))}
          {pending.length > 0 ? (
            <li className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Ninguém chegou ainda</span>{" "}
                em {formatList(pending.map((stage) => stage.label))}.
              </p>
            </li>
          ) : null}
        </ol>
      )}

      {notes.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-border/60 bg-muted/30 p-4">
          {notes.map((note) => (
            <p key={note} className="text-[11px] leading-4 text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function buildNotes(
  funnel: ConversionFunnel,
  spend: SpendSummary | null,
  insightsFailure: MetaInsightsFailure | null
) {
  const notes: string[] = [];
  if (funnel.lost > 0) {
    notes.push(
      `${funnel.lost} ${funnel.lost === 1 ? "pessoa foi marcada" : "pessoas foram marcadas"} como perdida no funil.`
    );
  }
  if (spend && spend.unattributedAds > 0) {
    notes.push(
      `${formatMoney(spend.unattributedSpend)} foram gastos em ${spend.unattributedAds} ${spend.unattributedAds === 1 ? "anúncio que não trouxe" : "anúncios que não trouxeram"} ninguém no período. Esse valor não entra no custo por contato.`
    );
  }
  if (spend && spend.leadsWithoutSpend > 0) {
    notes.push(
      `${spend.leadsWithoutSpend} ${spend.leadsWithoutSpend === 1 ? "pessoa veio" : "pessoas vieram"} de um anúncio que não estava no ar neste período — clicaram antes.`
    );
  }
  if (spend && spend.metaMessagingStarted > 0) {
    notes.push(
      `A Meta contou ${spend.metaMessagingStarted} conversas iniciadas nos mesmos anúncios. A diferença para os ${funnel.contacts} do CRM é normal: as duas contam em janelas de tempo diferentes.`
    );
  }
  if (insightsFailure) notes.push(failureMessage[insightsFailure]);
  return notes;
}

function StageRow({
  label,
  leads,
  shareOfTop,
  previousLeads,
}: {
  label: string;
  leads: number;
  shareOfTop: number;
  previousLeads?: number;
}) {
  const dropped = previousLeads === undefined ? 0 : previousLeads - leads;
  const empty = leads === 0;
  // Piso de 1,5% para etapa não vazia: 3 em 144 dá 2% de largura, e sem piso o
  // bloco sumia justamente onde a pessoa procura confirmação de que existe algo.
  const width = empty ? 0 : Math.max(1.5, Math.min(100, shareOfTop));

  return (
    <li className="flex flex-col">
      {dropped > 0 ? (
        <p className="flex items-center gap-1.5 py-2.5 ps-0.5 text-[11px] text-muted-foreground">
          <TrendingDownIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="font-medium text-foreground">{dropped}</span>{" "}
            {dropped === 1 ? "não avançou" : "não avançaram"}
            <span className="text-muted-foreground/80">
              {" "}
              · seguiram {formatPercentage((leads / (previousLeads || 1)) * 100)}
            </span>
          </span>
        </p>
      ) : previousLeads !== undefined ? (
        <div aria-hidden className="h-3" />
      ) : null}

      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "min-w-0 truncate text-sm font-medium",
            empty && "text-muted-foreground"
          )}
        >
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
          <span
            className={cn(
              "text-lg font-semibold leading-none",
              empty && "text-muted-foreground"
            )}
          >
            {leads}
          </span>
          <span className="w-11 text-right text-xs text-muted-foreground">
            {formatPercentage(shareOfTop)}
          </span>
        </span>
      </div>

      {/* Decoração: o número e o percentual já estão no texto acima, então a
          barra sai da árvore de acessibilidade em vez de repetir a informação
          com um rótulo pior. */}
      <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", empty ? "bg-transparent" : "bg-primary")}
          style={{ width: `${width}%` }}
        />
      </div>
    </li>
  );
}
