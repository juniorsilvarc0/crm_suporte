import {
  leadSourceLabel,
  leadStatusLabel,
} from "@/features/leads/schemas/status";
import type { LeadSource, LeadStatus } from "@/lib/supabase/types";
import { getDayQueryRange } from "@/lib/formatters/date";

export type LeadSearchColumn =
  | "lead"
  | "contexto"
  | "origem"
  | "status"
  | "entrada";

export const leadSearchColumns: { value: LeadSearchColumn; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "contexto", label: "Contexto" },
  { value: "origem", label: "Origem" },
  { value: "status", label: "Status" },
  { value: "entrada", label: "Entrada" },
];

const SEARCH_COLUMNS = new Set<LeadSearchColumn>(
  leadSearchColumns.map((column) => column.value),
);

export function parseLeadSearchColumn(value: string | undefined): LeadSearchColumn {
  return value && SEARCH_COLUMNS.has(value as LeadSearchColumn)
    ? (value as LeadSearchColumn)
    : "lead";
}

export function sanitizeLeadSearch(value: string): string {
  return value
    .replace(/[%,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function normalizeLeadSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

export function matchingLeadSources(term: string): LeadSource[] {
  const normalized = normalizeLeadSearch(term);
  return (Object.entries(leadSourceLabel) as [LeadSource, string][])
    .filter(([value, label]) =>
      normalizeLeadSearch(`${value} ${label}`).includes(normalized),
    )
    .map(([value]) => value);
}

export function matchingLeadStatuses(term: string): LeadStatus[] {
  const normalized = normalizeLeadSearch(term);
  const known = (Object.entries(leadStatusLabel) as [LeadStatus, string][])
    .filter(([value, label]) =>
      normalizeLeadSearch(`${value} ${label}`).includes(normalized),
    )
    .map(([value]) => value);
  if (known.length > 0) return known;

  const inferred = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return inferred ? [inferred] : [];
}

export function parseLeadEntryDate(
  value: string,
): { from: string; to: string } | null {
  const match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const from = new Date(Date.UTC(year, month - 1, day));
  if (
    from.getUTCFullYear() !== year ||
    from.getUTCMonth() !== month - 1 ||
    from.getUTCDate() !== day
  ) {
    return null;
  }

  const dateKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const range = getDayQueryRange(dateKey);
  return { from: range.startIso, to: range.endIso };
}
