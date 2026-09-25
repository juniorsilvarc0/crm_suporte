// Em que balde do dashboard cada lead cai, dado o board configurado.
//
// Contexto: "Convertidas" e a taxa de conversão usavam `stage_type = 'won'`,
// e `won` só existe em `cliente`/`recorrente`. Nesta clínica o marco comercial
// é `compareceu` — etapa ABERTA. Agora cada coluna do funil tem
// `counts_as_conversion`, configurável em Configurar funil.
//
// Puro e sem Supabase para ser testável, no molde de deals/lib/lead-status.ts.

import { toStageType } from "@/features/board/schemas/stage";

/** Chave da etapa de entrada. Leads aqui nunca foram atendidos. */
export const ENTRY_STAGE = "novo";

export type ClassificationColumn = {
  key: string;
  stage_type: string | null;
  counts_as_conversion?: boolean | null;
};

export type LeadBucket = "converted" | "lost" | "noContact" | "inStage";

/**
 * Os baldes são uma PARTIÇÃO: todo lead cai em exatamente um, e a soma fecha
 * com o total. Por isso a ordem é decidida aqui e não em cada consumidor.
 *
 * Conversão vem primeiro porque pode marcar uma etapa aberta: sem a
 * precedência, um lead em "Compareceu" contaria em "Convertidas" E em
 * "Em etapa", e os percentuais passariam de 100%.
 *
 * Perdido vence "sem contato" e "em etapa" pelo mesmo motivo.
 */
export function classifyLead(
  status: string,
  columns: ClassificationColumn[]
): LeadBucket {
  const column = columns.find((c) => c.key === status);

  if (column?.counts_as_conversion) return "converted";
  if (toStageType(column?.stage_type) === "lost") return "lost";
  if (status === ENTRY_STAGE) return "noContact";
  return "inStage";
}

/** Rótulo das etapas que contam como conversão, para a UI explicar o número. */
export function conversionStageLabels(
  columns: (ClassificationColumn & { label?: string })[]
): string[] {
  return columns
    .filter((column) => column.counts_as_conversion)
    .map((column) => column.label ?? column.key);
}
