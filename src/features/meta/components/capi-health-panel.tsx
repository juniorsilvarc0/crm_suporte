"use client";

import {
  CircleCheckIcon,
  CircleSlashIcon,
  ClockIcon,
  InboxIcon,
  MegaphoneIcon,
  SendIcon,
  TargetIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RetryConversionButton } from "@/features/meta/components/retry-conversion-button";
import { StatBand, StatCard } from "@/features/meta/components/stat-card";
import type { MetaOperationalHealth } from "@/features/meta/health";
import { cn } from "@/lib/utils";

export type DeadLetterRow = {
  id: string;
  event_name: string;
  attempt_count: number;
  last_error_category: string | null;
  updated_at: string;
};

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(new Date(value));
}

function age(value: string | null) {
  if (!value) return "Sem itens";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * Saúde da CAPI: como está a entrega das conversões de volta para a Meta.
 *
 * ⚠️ **Era um `Collapsible` e deixou de ser.** O colapso existia porque a tela
 * inteira era uma coluna só, e este bloco — que é operação, não decisão de
 * verba — empurrava a tabela de campanhas para baixo da dobra. Com a aba
 * própria, quem entra aqui já veio ver isto: um colapsável dentro de uma aba é
 * a mesma pergunta feita duas vezes, e esconderia justamente o conteúdo de quem
 * clicou para vê-lo.
 *
 * O que o colapso resolvia continua resolvido em outro lugar: quando há falha,
 * a aba ganha um ponto de alerta em `tracking-tabs.tsx`.
 */
export function CapiHealthPanel({
  health,
  deadLetters,
  coverage,
}: {
  health: MetaOperationalHealth;
  deadLetters: DeadLetterRow[];
  /**
   * Cobertura de click ID das pessoas que chegaram no período. Mora aqui, e não
   * na Visão geral, porque é qualidade do sinal que a clínica devolve para a
   * Meta — mesmo assunto do resto da aba. Sem click ID a conversão nem chega a
   * ser enfileirada.
   */
  coverage: { covered: number; contacts: number; percent: number };
}) {
  const critical = health.deadLetters24h > 0 || deadLetters.length > 0;
  const disabled = health.capiState === "disabled";

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3",
          critical && "bg-destructive/[0.04]"
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            critical ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
          )}
          aria-hidden
        >
          {critical ? (
            <TriangleAlertIcon className="size-4" strokeWidth={1.8} />
          ) : (
            <CircleCheckIcon className="size-4" strokeWidth={1.8} />
          )}
        </span>

        <p className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Entrega de conversões</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {disabled
              ? "CAPI desabilitada por gate · eventos retidos"
              : critical
                ? `${health.deadLetters24h} com falha permanente · backlog ${health.backlog}`
                : `Backlog ${health.backlog} · ${health.sent24h} enviados em 24 h · última entrega ${formatTimestamp(health.lastDeliveryAt)}`}
          </span>
        </p>
      </div>

      <div className="flex flex-col gap-4 border-t border-border p-4">
        {disabled ? (
          <Alert>
            <MegaphoneIcon />
            <AlertTitle>CAPI desabilitada por gate</AlertTitle>
            <AlertDescription>
              Estado neutro, não erro. Os eventos ficam retidos e são entregues quando
              o gate abrir.
            </AlertDescription>
          </Alert>
        ) : null}

        <StatBand columns={3}>
          <StatCard
            label="Backlog atual"
            value={health.backlog}
            icon={InboxIcon}
            tone="accent"
            hint="Aguardando, processando ou em nova tentativa."
          />
          <StatCard
            label="Enviados · 24 h"
            value={health.sent24h}
            icon={SendIcon}
            hint="Conversões reconhecidas pela Meta."
          />
          <StatCard
            label="Descartados · 24 h"
            value={health.discarded24h}
            icon={CircleSlashIcon}
            hint="Sem click ID elegível. Não é falha de entrega."
          />
          <StatCard
            label="Dead letters · 24 h"
            value={health.deadLetters24h}
            icon={TriangleAlertIcon}
            tone={health.deadLetters24h > 0 ? "critical" : "neutral"}
            hint={
              health.deadLetters24h > 0
                ? "Exigem diagnóstico antes de reenfileirar."
                : "Nenhuma falha permanente no período."
            }
          />
          <StatCard
            label="Item mais antigo"
            value={age(health.oldestPendingAt)}
            icon={ClockIcon}
            hint="Idade do evento ativo há mais tempo na fila."
          />
          {/* Veio da Visão geral: é qualidade do sinal que sai daqui, não
              decisão de verba. Sem click ID não existe conversão a entregar. */}
          <StatCard
            label="Contatos rastreados"
            value={`${coverage.percent}%`}
            icon={TargetIcon}
            hint={`${coverage.covered} de ${coverage.contacts} chegaram com identificação de clique. Sem ela, a Meta não aprende com a conversão.`}
          />
        </StatBand>

        <p className="text-[11px] leading-4 text-muted-foreground">
          Última drenagem do worker: {formatTimestamp(health.lastDrainAt)}.
        </p>

        {deadLetters.length ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                {deadLetters.length}{" "}
                {deadLetters.length === 1
                  ? "evento com falha permanente"
                  : "eventos com falha permanente"}
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 px-3 text-xs">Evento</TableHead>
                    <TableHead className="h-9 px-3 text-right text-xs">Tentativas</TableHead>
                    <TableHead className="h-9 px-3 text-xs">Categoria</TableHead>
                    <TableHead className="h-9 px-3 text-xs">Atualizado</TableHead>
                    <TableHead className="h-9 px-3 text-right text-xs">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deadLetters.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="px-3 py-2 text-sm font-medium">
                        {item.event_name}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                        {item.attempt_count}
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {item.last_error_category ?? "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-sm text-muted-foreground tabular-nums">
                        {formatTimestamp(item.updated_at)}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right">
                        <RetryConversionButton id={item.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border/70 px-4 py-3 text-center text-xs text-muted-foreground">
            Nenhuma conversão esgotou as tentativas. Quando isso acontecer, o evento
            aparece aqui com a categoria do erro e a opção de reenfileirar preservando
            o mesmo identificador.
          </p>
        )}
      </div>
    </div>
  );
}
