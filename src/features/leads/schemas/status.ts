import type { LeadSource } from "@/lib/supabase/types";
import {
  getColorStyle,
  type ColorName,
  type ColorStyle,
} from "@/features/tags/schemas/colors";

// Etapas canônicas do funil do CRM (seed do board_columns).
// As colunas são dinâmicas no banco; estes mapas são fallback de rótulo/cor.
export const leadStatusLabel: Record<string, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  qualificado: "Qualificado",
  agendado: "Agendado",
  compareceu: "Compareceu",
  cliente: "Cliente",
  recorrente: "Recorrente",
  perdido: "Perdido",
};

export const leadStatusOrder: string[] = [
  "novo",
  "em_atendimento",
  "qualificado",
  "agendado",
  "compareceu",
  "cliente",
  "recorrente",
  "perdido",
];

export const leadStatusColor: Record<string, ColorName> = {
  novo: "violet",
  em_atendimento: "blue",
  qualificado: "cyan",
  agendado: "amber",
  compareceu: "teal",
  cliente: "emerald",
  recorrente: "fuchsia",
  perdido: "rose",
};

export const leadSourceLabel: Record<LeadSource, string> = {
  agencia: "Agência parceira",
  anuncio: "Anúncio / Tráfego pago",
  particular: "Particular",
  indicacao: "Indicação",
  whatsapp: "WhatsApp direto",
  importado: "Base importada",
  outro: "Outro",
};

// Categorias de serviço do agendamento. Genéricas por padrão (template CRM) —
// a coluna no banco continua sendo `tipo_ensaio`; ajuste os rótulos por cliente.
export const tipoEnsaioLabel: Record<string, string> = {
  reuniao: "Reunião",
  consulta: "Consulta",
  demonstracao: "Demonstração",
  proposta: "Proposta",
  onboarding: "Onboarding",
  suporte: "Suporte",
  outro: "Outro",
};

// Opções canônicas reaproveitadas pelos selects de agendamento e de lead.
export const tipoServicoOptions = [
  { value: "reuniao", label: "Reunião" },
  { value: "consulta", label: "Consulta" },
  { value: "demonstracao", label: "Demonstração" },
  { value: "proposta", label: "Proposta" },
  { value: "onboarding", label: "Onboarding" },
  { value: "suporte", label: "Suporte" },
  { value: "outro", label: "Outro" },
] as const;

function humanize(value: string) {
  if (!value) return "—";
  const text = value.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function getLeadStatusStyle(status: string): ColorStyle {
  return getColorStyle(leadStatusColor[status]);
}

export function getLeadStatusLabel(status: string): string {
  return leadStatusLabel[status] ?? humanize(status);
}

export function getLeadSourceLabel(source: string): string {
  return leadSourceLabel[source as LeadSource] ?? humanize(source);
}

export function getTipoEnsaioLabel(tipo: string): string {
  return tipoEnsaioLabel[tipo] ?? humanize(tipo);
}
