import {
  getLeadSourceLabel,
  getLeadStatusLabel,
  getTipoEnsaioLabel,
} from "@/features/leads/schemas/status";
import type { Lead } from "@/features/leads/types";
import { formatDateTime } from "@/lib/formatters/date";

// Ponto-e-vírgula: o Excel em pt-BR usa ";" como separador padrão (a vírgula é
// separador decimal). Combinado com o BOM (adicionado na rota) abre certinho.
const DELIMITER = ";";

type Column = { header: string; value: (lead: Lead) => string };

const COLUMNS: Column[] = [
  { header: "Nome", value: (l) => l.name ?? "" },
  { header: "Telefone", value: (l) => l.phone ?? "" },
  { header: "Email", value: (l) => l.email ?? "" },
  { header: "Instagram", value: (l) => l.instagram_user ?? "" },
  { header: "Origem", value: (l) => (l.source ? getLeadSourceLabel(l.source) : "") },
  { header: "Status", value: (l) => getLeadStatusLabel(l.status) },
  {
    header: "Tipo de serviço",
    value: (l) => (l.tipo_ensaio ? getTipoEnsaioLabel(l.tipo_ensaio) : ""),
  },
  { header: "Interesse", value: (l) => l.interesse ?? "" },
  {
    header: "Valor estimado",
    // Decimal com vírgula para o Excel pt-BR interpretar como número.
    value: (l) => (l.valor_estimado != null ? String(l.valor_estimado).replace(".", ",") : ""),
  },
  { header: "Recorrente", value: (l) => (l.is_recorrente ? "Sim" : "Não") },
  { header: "Agência", value: (l) => l.agencia_nome ?? "" },
  { header: "Modelo/criança", value: (l) => l.modelo_nome ?? "" },
  { header: "Tags", value: (l) => (l.tags ?? []).map((t) => t.name).join(", ") },
  { header: "Observações", value: (l) => l.notes ?? "" },
  { header: "Criado em", value: (l) => formatDateTime(l.created_at) },
  { header: "Última mensagem", value: (l) => formatDateTime(l.last_message_at) },
];

// Regra CSV (RFC 4180): campos com aspas, o separador, ou quebra de linha vão
// entre aspas, e aspas internas são duplicadas.
function escapeField(value: string): string {
  if (
    value.includes('"') ||
    value.includes(DELIMITER) ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function leadsToCsv(leads: Lead[]): string {
  const header = COLUMNS.map((column) => escapeField(column.header)).join(DELIMITER);
  const rows = leads.map((lead) =>
    COLUMNS.map((column) => escapeField(column.value(lead))).join(DELIMITER)
  );
  return [header, ...rows].join("\r\n");
}
