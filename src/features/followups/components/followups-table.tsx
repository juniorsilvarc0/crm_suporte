"use client";

import { useMemo, useState } from "react";
import { Clock3Icon, MessageSquareTextIcon, PhoneIcon } from "lucide-react";

import {
  ActiveFilters,
  DataToolbar,
  FilterButton,
  FilterField,
  ToolbarSearch,
} from "@/components/data-display/data-toolbar";
import { AvatarInitials } from "@/components/data-display/avatar-initials";
import { EmptyState } from "@/components/data-display/empty-state";
import { Badge } from "@/components/ui/badge";
import { FormSelect } from "@/components/forms/form-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FollowupRowActions } from "@/features/followups/components/followup-row-actions";
import { followupStatusLabel, getFollowupStepLabel } from "@/features/followups/schemas/status";
import type { Followup } from "@/features/followups/types";
import { getColorStyle } from "@/features/leads/schemas/colors";
import { formatDateTime } from "@/lib/formatters/date";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "pendente" | "enviado" | "cancelado";

function isOverdue(followup: Followup) {
  return followup.status === "pendente" && Boolean(followup.scheduled_for) && new Date(followup.scheduled_for!).getTime() < Date.now();
}

function FollowupStatus({ followup }: { followup: Followup }) {
  const overdue = isOverdue(followup);
  return (
    <Badge variant={followup.status === "enviado" ? "default" : overdue ? "destructive" : "secondary"}>
      {overdue ? "Atrasado" : followupStatusLabel[followup.status]}
    </Badge>
  );
}

// Sinaliza o desfecho da retomada: recuperado (lead voltou) tem prioridade
// sobre apenas respondeu. Nada aparece enquanto o lead não interagiu.
function RecoveryBadges({ followup }: { followup: Followup }) {
  if (followup.recovered) {
    return <Badge className={getColorStyle("emerald").badge}>Recuperado</Badge>;
  }
  if (followup.replied) {
    return <Badge variant="secondary">Respondeu</Badge>;
  }
  return null;
}

export function FollowupsTable({ followups }: { followups: Followup[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return followups.filter((followup) => {
      const searchable = `${followup.leads?.name ?? ""} ${followup.leads?.phone ?? ""}`.toLocaleLowerCase("pt-BR");
      return (!normalized || searchable.includes(normalized)) && (status === "all" || followup.status === status);
    });
  }, [followups, query, status]);

  const activeCount = status === "all" ? 0 : 1;

  return (
    <div>
      <DataToolbar>
        <ToolbarSearch aria-label="Buscar follow-up" placeholder="Buscar cliente ou telefone..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <FilterButton activeCount={activeCount}>
            <FilterField label="Status">
              <FormSelect value={status} onValueChange={(value) => setStatus(value as StatusFilter)} aria-label="Filtrar follow-ups por status" options={[{ value: "all", label: "Todos" }, { value: "pendente", label: "Pendentes" }, { value: "enviado", label: "Enviados" }, { value: "cancelado", label: "Cancelados" }]} />
            </FilterField>
          </FilterButton>
          <ActiveFilters count={activeCount + (query ? 1 : 0)} onClear={() => { setQuery(""); setStatus("all"); }} />
        </div>
      </DataToolbar>

      <div className="flex h-10 items-center text-xs text-muted-foreground" aria-live="polite">
        {filtered.length} de {followups.length} {followups.length === 1 ? "follow-up" : "follow-ups"}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>Nenhum follow-up encontrado.</EmptyState>
      ) : (
        <>
          {/* Linha = cartão, como na lista de leads (ver UI.md §3.3). */}
          <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-muted/20 px-2 pb-2 shadow-soft md:block">
            <Table variant="cards">
              <TableHeader><TableRow variant="cards-header"><TableHead>Lead</TableHead><TableHead>Retomada</TableHead><TableHead>Agendado para</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Enviado</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
              <TableBody>
                {filtered.map((followup) => (
                  <TableRow
                    key={followup.id}
                    variant="card"
                    className={cn(isOverdue(followup) && "[&>td]:bg-destructive/5")}
                  >
                    <TableCell><div className="flex items-center gap-2.5"><AvatarInitials name={followup.leads?.name} size="sm" /><div className="min-w-0"><div className="truncate font-medium">{followup.leads?.name ?? "Sem nome"}</div><div className="font-mono text-xs text-muted-foreground">{formatPhone(followup.leads?.phone ?? null)}</div></div></div></TableCell>
                    <TableCell>{followup.step ? <Badge variant="outline">{getFollowupStepLabel(followup.step)}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{followup.scheduled_for ? formatDateTime(followup.scheduled_for) : "—"}</TableCell>
                    <TableCell><div className="flex items-center gap-1.5"><FollowupStatus followup={followup} /><RecoveryBadges followup={followup} /></div></TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatDateTime(followup.sent_at)}</TableCell>
                    <TableCell className="py-1 text-right">{followup.status === "pendente" ? <FollowupRowActions followup={followup} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mesma linguagem da lista de leads: pilha de cartões de pessoa
              sobre um leito tingido, não linhas divididas. */}
          <div className="grid gap-2 rounded-xl border border-border/60 bg-muted/25 p-2 shadow-soft md:hidden">
            {filtered.map((followup) => (
              <article key={followup.id} className={cn("relative overflow-hidden rounded-xl border border-border/70 bg-card p-4 pl-5", isOverdue(followup) && "bg-destructive/5")}>
                {/* Barra de acento: atrasado > recuperado > padrão. */}
                <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", isOverdue(followup) ? "bg-destructive" : followup.recovered ? getColorStyle("emerald").bar : "bg-primary/40")} />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5"><AvatarInitials name={followup.leads?.name} size="md" /><div className="min-w-0"><h3 className="truncate font-medium">{followup.leads?.name ?? "Sem nome"}</h3><p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground"><PhoneIcon className="size-3.5" aria-hidden />{formatPhone(followup.leads?.phone ?? null)}</p></div></div>
                  <div className="flex items-center gap-1"><FollowupStatus followup={followup} /><RecoveryBadges followup={followup} />{followup.status === "pendente" ? <FollowupRowActions followup={followup} /> : null}</div>
                </div>
                {followup.step ? <p className="mt-2 text-xs text-muted-foreground">Retomada: {getFollowupStepLabel(followup.step)}</p> : null}
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Clock3Icon className="size-4" aria-hidden />{followup.scheduled_for ? formatDateTime(followup.scheduled_for) : "Sem data definida"}</p>
                {followup.status === "enviado" ? <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><MessageSquareTextIcon className="size-4" aria-hidden />Enviado em {formatDateTime(followup.sent_at)}</p> : null}
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
