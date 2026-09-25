"use client";

import { useMemo, useState } from "react";
import { Clock3Icon } from "lucide-react";

import { ActiveFilters, DataToolbar, FilterButton, FilterField, ToolbarSearch } from "@/components/data-display/data-toolbar";
import { EmptyState } from "@/components/data-display/empty-state";
import { FormSelect } from "@/components/forms/form-select";
import { Status, StatusIndicator, StatusLabel } from "@/components/kibo-ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { integrationStatusLabel } from "@/features/integrations/schemas/status";
import type { IntegrationLog } from "@/features/integrations/types";
import { formatDateTime } from "@/lib/formatters/date";

const statusVariant: Record<string, "online" | "offline" | "maintenance"> = { ok: "online", error: "offline" };
const providerLabels: Record<string, string> = { meta: "WhatsApp Meta", evolution: "Evolution API", uazapi: "UAZAPI", n8n: "n8n" };

function technicalLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function providerLabel(value: string) {
  return providerLabels[value.toLowerCase()] ?? technicalLabel(value);
}

function LogStatus({ status }: { status: string | null }) {
  const value = status ?? "";
  return <Status status={statusVariant[value] ?? "maintenance"}><StatusIndicator /><StatusLabel>{integrationStatusLabel[(value as "ok" | "error") || "ok"] ?? (value || "—")}</StatusLabel></Status>;
}

export function IntegrationLogsTable({ logs }: { logs: IntegrationLog[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const providers = useMemo(() => Array.from(new Set(logs.map((log) => log.provider))).sort(), [logs]);
  const [provider, setProvider] = useState("all");
  const filtered = useMemo(() => { const normalized = query.trim().toLocaleLowerCase("pt-BR"); return logs.filter((log) => (!normalized || `${log.provider} ${log.action}`.toLocaleLowerCase("pt-BR").includes(normalized)) && (status === "all" || log.status === status) && (provider === "all" || log.provider === provider)); }, [logs, provider, query, status]);
  const activeCount = [status, provider].filter((value) => value !== "all").length;

  return <div>
    <DataToolbar><ToolbarSearch aria-label="Buscar registro de integração" placeholder="Buscar integração ou ação..." value={query} onChange={(event) => setQuery(event.target.value)} /><div className="flex flex-wrap gap-2 sm:ml-auto"><FilterButton activeCount={activeCount}><FilterField label="Status"><FormSelect value={status} onValueChange={setStatus} aria-label="Filtrar registros por status" options={[{ value: "all", label: "Todos" }, { value: "ok", label: "Sucesso" }, { value: "error", label: "Erro" }]} /></FilterField><FilterField label="Integração"><FormSelect value={provider} onValueChange={setProvider} aria-label="Filtrar por integração" options={[{ value: "all", label: "Todas" }, ...providers.map((value) => ({ value, label: providerLabel(value) }))]} /></FilterField></FilterButton><ActiveFilters count={activeCount + (query ? 1 : 0)} onClear={() => { setQuery(""); setStatus("all"); setProvider("all"); }} /></div></DataToolbar>
    <div className="flex h-10 items-center text-xs text-muted-foreground" aria-live="polite">{filtered.length} de {logs.length} registros</div>
    {filtered.length === 0 ? <EmptyState>Nenhum registro de integração encontrado.</EmptyState> : <><div className="hidden overflow-hidden rounded-xl border border-border/60 bg-muted/20 px-2 pb-2 shadow-soft md:block"><Table variant="cards"><TableHeader><TableRow variant="cards-header"><TableHead>Integração</TableHead><TableHead>Ação</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Registro</TableHead></TableRow></TableHeader><TableBody>{filtered.map((log) => <TableRow key={log.id} variant="card"><TableCell>{providerLabel(log.provider)}</TableCell><TableCell>{technicalLabel(log.action)}</TableCell><TableCell><LogStatus status={log.status} /></TableCell><TableCell className="text-right font-mono text-xs">{formatDateTime(log.created_at)}</TableCell></TableRow>)}</TableBody></Table></div><div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft md:hidden">{filtered.map((log) => <article key={log.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{providerLabel(log.provider)}</h3><p className="mt-1 text-sm text-muted-foreground">{technicalLabel(log.action)}</p></div><LogStatus status={log.status} /></div><p className="mt-3 flex items-center gap-1.5 font-mono text-xs text-muted-foreground"><Clock3Icon className="size-3.5" aria-hidden />{formatDateTime(log.created_at)}</p></article>)}</div></>}
  </div>;
}
