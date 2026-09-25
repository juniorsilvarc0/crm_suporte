"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDownIcon,
  DownloadIcon,
  MegaphoneIcon,
  TargetIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AvatarInitials } from "@/components/data-display/avatar-initials";
import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";
import {
  getLeadStatusLabel,
  getLeadStatusStyle,
} from "@/features/leads/schemas/status";
import {
  ariaSort,
  SortButton,
  type SortDirection,
} from "@/features/meta/components/sort-button";
import type { MetaCampaignLead, MetaCampaignReportRow } from "@/features/meta/report";
import { formatPhone } from "@/lib/formatters/phone";
import { cn } from "@/lib/utils";

type SortKey = "campaignName" | "contacts" | "attended" | "patients" | "coveragePercent";

// A coluna de agendamento fica fora da tela de propósito: o número existe no
// relatório e no CSV, mas a leitura por campanha usa contato, comparecimento e
// paciente — as três etapas que sustentam decisão de verba.
const numericColumns = [
  { key: "contacts", label: "Contatos" },
  { key: "attended", label: "Compareceram" },
  { key: "patients", label: "Pacientes" },
] as const;

const shortDateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Fortaleza",
});

function formatTouch(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : shortDateTime.format(date);
}

function compare(a: MetaCampaignReportRow, b: MetaCampaignReportRow, key: SortKey) {
  if (key === "campaignName") return a.campaignName.localeCompare(b.campaignName, "pt-BR");
  return a[key] - b[key];
}

export function CampaignReportTable({
  rows,
  exportHref,
}: {
  rows: MetaCampaignReportRow[];
  exportHref: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("contacts");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDirection(key === "campaignName" ? "asc" : "desc");
  }

  function toggleExpanded(campaignId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  }

  const sorted = useMemo(() => {
    const factor = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => compare(a, b, sortKey) * factor);
  }, [rows, sortKey, direction]);

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? "Nenhuma campanha"
            : `${rows.length} ${rows.length === 1 ? "campanha" : "campanhas"}`}
        </p>
        {/* Exportar mora aqui, junto do que ele exporta — não numa faixa própria
            no topo da página gastando altura. */}
        <Button variant="outline" size="sm" render={<a href={exportHref} />}>
          <DownloadIcon data-icon="inline-start" />
          <span className="hidden sm:inline">Exportar CSV</span>
          <span className="sm:hidden">CSV</span>
        </Button>
      </div>

      {rows.length === 0 ? (
        // Fora da tabela de propósito: TableCell aplica whitespace-nowrap, então
        // um estado vazio dentro de um colSpan não quebra linha e estica a tabela.
        <EmptyState />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 w-10 px-2" aria-label="Expandir" />
                  <TableHead
                    aria-sort={ariaSort(sortKey === "campaignName", direction)}
                    className="h-11 w-full px-4"
                  >
                    <SortButton
                      label="Campanha"
                      active={sortKey === "campaignName"}
                      direction={direction}
                      onClick={() => toggleSort("campaignName")}
                    />
                  </TableHead>
                  {numericColumns.map((column) => (
                    <TableHead
                      key={column.key}
                      aria-sort={ariaSort(sortKey === column.key, direction)}
                      className="h-11 px-4 text-right"
                    >
                      <SortButton
                        label={column.label}
                        align="end"
                        active={sortKey === column.key}
                        direction={direction}
                        onClick={() => toggleSort(column.key)}
                      />
                    </TableHead>
                  ))}
                  <TableHead
                    aria-sort={ariaSort(sortKey === "coveragePercent", direction)}
                    className="h-11 px-4 text-right"
                  >
                    <SortButton
                      label="Rastreados"
                      align="end"
                      active={sortKey === "coveragePercent"}
                      direction={direction}
                      onClick={() => toggleSort("coveragePercent")}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => {
                  const open = expanded.has(row.campaignId);
                  const panelId = `campanha-${row.campaignId}`;
                  return [
                    <TableRow
                      key={row.campaignId}
                      className={cn("cursor-pointer border-border/60", open && "bg-muted/40")}
                      onClick={() => toggleExpanded(row.campaignId)}
                    >
                      <TableCell className="px-2 py-3">
                        {/* Barra na cor de destaque marca a campanha aberta,
                            como a barra de status da tabela de crediário. */}
                        <div
                          className={cn(
                            "flex h-8 items-center border-l-2 pl-1.5",
                            open ? "border-primary" : "border-transparent"
                          )}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-expanded={open}
                            aria-controls={panelId}
                            aria-label={`${open ? "Recolher" : "Expandir"} ${row.campaignName}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleExpanded(row.campaignId);
                            }}
                            className="text-muted-foreground"
                          >
                            <ChevronDownIcon
                              className={cn(
                                "transition-transform duration-200 motion-reduce:transition-none",
                                open && "rotate-180"
                              )}
                            />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal px-4 py-3 align-top text-sm">
                        <span className="block font-medium">{row.campaignName}</span>
                        <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                          {row.campaignId}
                        </span>
                        {row.nameVariants.length ? (
                          <span className="mt-1.5 block text-xs text-muted-foreground">
                            Antes: {row.nameVariants.join(" · ")}
                          </span>
                        ) : null}
                      </TableCell>
                      {numericColumns.map((column) => (
                        <TableCell
                          key={column.key}
                          className="px-4 py-3 text-right align-top text-sm font-medium tabular-nums"
                        >
                          {row[column.key]}
                        </TableCell>
                      ))}
                      <TableCell className="px-4 py-3 text-right align-top text-sm">
                        <span className="tabular-nums">{row.coveragePercent}%</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                          {row.covered} de {row.contacts}
                        </span>
                      </TableCell>
                    </TableRow>,
                    open ? (
                      <TableRow
                        key={`${row.campaignId}-leads`}
                        className="border-border/60 bg-muted/20 hover:bg-muted/20"
                      >
                        <TableCell colSpan={numericColumns.length + 3} className="p-0">
                          <div id={panelId} className="px-4 py-3">
                            <CampaignLeads leads={row.leads} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null,
                  ];
                })}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y divide-border md:hidden">
            {sorted.map((row) => {
              const open = expanded.has(row.campaignId);
              const panelId = `campanha-mobile-${row.campaignId}`;
              return (
                <li key={row.campaignId}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(row.campaignId)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className="flex w-full items-start gap-3 px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{row.campaignName}</span>
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        {row.campaignId}
                      </span>
                      <span className="mt-3 grid grid-cols-3 gap-3">
                        {numericColumns.map((column) => (
                          <span key={column.key} className="block">
                            <span className="block text-xs text-muted-foreground">
                              {column.label}
                            </span>
                            <span className="mt-0.5 block text-sm font-medium tabular-nums">
                              {row[column.key]}
                            </span>
                          </span>
                        ))}
                      </span>
                      <span className="mt-3 block text-xs text-muted-foreground">
                        Cobertura{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {row.coveragePercent}%
                        </span>{" "}
                        · {row.covered} de {row.contacts} leads
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={cn(
                        "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                        open && "rotate-180"
                      )}
                      aria-hidden
                    />
                  </button>
                  {open ? (
                    <div id={panelId} className="bg-muted/20 px-4 py-3">
                      <CampaignLeads leads={row.leads} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// Lista de leads da campanha, no mesmo vocabulário visual da tela de Leads:
// identidade (nome + telefone), badge de status do funil, e ação de conversa.
function CampaignLeads({ leads }: { leads: MetaCampaignLead[] }) {
  if (leads.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        Nenhum contato desta campanha no período.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">
          {leads.length} {leads.length === 1 ? "lead" : "leads"} nesta campanha
        </p>
      </div>
      {/* Campanha grande não pode empurrar a tabela inteira para fora da tela:
          a lista rola dentro do próprio painel. */}
      <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto">
        {leads.map((lead) => {
          const style = getLeadStatusStyle(lead.status);
          const digits = (lead.phone ?? "").replace(/\D/g, "");
          return (
            <li
              key={lead.leadId}
              className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
            >
              <AvatarInitials name={lead.name} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-medium">
                    {lead.name ?? "Sem nome"}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-sm border px-1.5 py-0 text-[10px] font-medium",
                      style.badge
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
                    {getLeadStatusLabel(lead.status)}
                  </Badge>
                  {!lead.hasClickId ? (
                    <Badge
                      variant="outline"
                      className="rounded-sm border-border px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
                      title="O clique não veio identificado, então a Meta não recebe a conversão desta pessoa."
                    >
                      <TargetIcon className="size-2.5" aria-hidden />
                      Sem rastreio
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">{formatPhone(lead.phone)}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{formatTouch(lead.firstTouchAt)}</span>
                  {lead.adName ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{lead.adName}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-11 shrink-0 text-muted-foreground sm:size-8"
                aria-label={`Abrir conversa de ${lead.name ?? "lead"}`}
                render={
                  <Link href={`/app/chat?lead=${lead.leadId}&phone=${digits}`} />
                }
              >
                <WhatsAppIcon className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        aria-hidden
      >
        <MegaphoneIcon className="size-5" strokeWidth={1.75} />
      </span>
      <p className="mt-1 text-sm font-medium">Nenhuma campanha trouxe contato no período</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Ou não houve contato Meta no período, ou os filtros de ID estão restringindo
        demais. Só entra aqui o lead cuja primeira mensagem trouxe referral de anúncio.
      </p>
    </div>
  );
}
