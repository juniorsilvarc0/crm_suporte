"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlertIcon, XIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { TicketAttachments } from "@/features/tickets/components/ticket-attachments";
import { TicketDetailHeader } from "@/features/tickets/components/ticket-detail-header";
import {
  TicketAssignDialog,
  TicketDetailSidebar,
} from "@/features/tickets/components/ticket-detail-sidebar";
import { TicketTimeline } from "@/features/tickets/components/ticket-timeline";
import { useNow } from "@/features/tickets/hooks/use-now";
import { useTicketMutation } from "@/features/tickets/hooks/use-ticket-mutation";
import type {
  TicketAttachment,
  TicketCatalog,
  TicketDetail,
  TicketTeamMember,
  TicketTimelinePage,
} from "@/features/tickets/types";

// Aviso não tem token semântico: a paleta de domínio, como o tom `warn` do
// selo de SLA.
const WARN = getColorStyle("amber");

export type TicketDetailViewProps = {
  ticket: TicketDetail;
  /** `null` = a leitura dos anexos falhou (a seção diz; o resto abre). */
  attachments: TicketAttachment[] | null;
  /** A 1ª página da timeline, como veio do servidor; `null` = falhou. */
  timeline: TicketTimelinePage | null;
  catalog: TicketCatalog;
  /** A equipe (ativos e inativos); `null` = a leitura falhou. */
  team: TicketTeamMember[] | null;
  viewerId: string;
  /** O instante da leitura (ISO): começa o relógio do selo de SLA. */
  fetchedAt: string;
};

/**
 * Detalhe do ticket, /app/tickets/[number] (spec 4b): cabeçalho com as ações,
 * e a grade — Descrição e timeline à esquerda, a lateral de fatos e os anexos
 * à direita.
 *
 * Sem Realtime de tickets: cada ação faz `router.refresh()`, e voltar para a
 * aba também (`visibilitychange`). Versão velha (409 `version_conflict`) vira
 * o alerta no topo e um toast, enquanto a releitura traz o ticket como está agora.
 */
export function TicketDetailView({
  ticket,
  attachments,
  timeline,
  catalog,
  team,
  viewerId,
  fetchedAt,
}: TicketDetailViewProps) {
  const router = useRouter();
  const now = useNow(fetchedAt);
  const mutation = useTicketMutation({ status: ticket.status, statuses: catalog.statuses });
  const [assignOpen, setAssignOpen] = useState(false);

  // A trilha e as notas assinam com o nome de quem já saiu da equipe ativa.
  const people = useMemo(() => (team ?? []).map(({ id, name }) => ({ id, name })), [team]);
  const status = catalog.statuses?.find((item) => item.key === ticket.status) ?? {
    key: ticket.status,
  };

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [router]);

  return (
    <div className="space-y-6 lg:space-y-8">
      {mutation.conflict ? (
        <Alert className={WARN.panel}>
          <TriangleAlertIcon aria-hidden className={WARN.text} />
          <AlertTitle>Este ticket mudou em outro lugar.</AlertTitle>
          <AlertDescription>
            {mutation.refreshing
              ? "Carregando a versão atual…"
              : "A tela já mostra a versão atual. Confira e, se ainda fizer sentido, repita a ação."}
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={mutation.dismissConflict}
              aria-label="Fechar o aviso"
              className="size-11 sm:size-7"
            >
              <XIcon />
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <TicketDetailHeader
        ticket={ticket}
        status={status}
        statuses={catalog.statuses}
        transitions={catalog.transitions}
        viewerId={viewerId}
        now={now}
        mutation={mutation}
        onAssign={() => setAssignOpen(true)}
      />

      <div className="grid gap-6 lg:grid-cols-3 lg:gap-8">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Section title="Descrição">
            <div className="rounded-xl border border-border/60 bg-card p-4 text-sm shadow-soft">
              {ticket.description ? (
                <p className="whitespace-pre-wrap break-words">{ticket.description}</p>
              ) : (
                <p className="text-muted-foreground">Sem descrição.</p>
              )}
            </div>
          </Section>
          <Section title="Linha do tempo">
            <TicketTimeline
              ticketId={ticket.id}
              conversationId={ticket.conversation_id}
              viewerId={viewerId}
              users={people}
              initial={timeline}
              catalog={catalog}
            />
          </Section>
        </div>

        <div className="min-w-0 space-y-6">
          <Section title="Detalhes">
            <TicketDetailSidebar
              ticket={ticket}
              catalog={catalog}
              mutation={mutation}
              onAssign={() => setAssignOpen(true)}
            />
          </Section>
          <Section title="Anexos">
            <TicketAttachments ticketId={ticket.id} attachments={attachments} />
          </Section>
        </div>
      </div>

      {ticket.is_terminal ? null : (
        <TicketAssignDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          ticket={ticket}
          team={team}
          viewerId={viewerId}
          mutation={mutation}
        />
      )}
    </div>
  );
}

// 2º uso do título de seção da ficha (customer-detail.tsx): duplicado de
// propósito (AGENTS §0.2.2).
function Section({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <h2
        id={titleId}
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
