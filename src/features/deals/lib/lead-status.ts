// Qual etapa do funil representa o lead, dados todos os cards dele.
//
// Contexto: o funil renderiza `deals`. `leads.status` é uma PROJEÇÃO desse
// estado, e é ela que a lista de leads, os filtros e todo o dashboard leem.
// O arrastar do Kanban gravava só em `deals`, então a projeção congelou: 226
// de 318 leads divergiam do próprio card, e "Sem contato" no dashboard
// mostrava 273 enquanto a coluna "Novo" do funil tinha 66. Ver PROGRESS.md.
//
// Decisão isolada do Supabase para ser testável — mesmo padrão de
// lib/auth/route-guard.ts e de lib/attendance.ts, aqui ao lado.

import { toStageType, type StageType } from "@/features/board/schemas/stage";

export type DealForLeadStatus = { stage: string | null };

export type StageColumn = {
  key: string;
  position: number;
  stage_type: string | null;
};

// Ganho vence qualquer coisa; perdido só vale quando não sobrou nada aberto.
const RANK: Record<StageType, number> = { lost: 0, open: 1, won: 2 };

/**
 * Um lead pode ter N cards (cada agendamento vira um). A regra, nesta ordem:
 *
 * 1. Existe card ganho? Ele manda — rebaixar um lead que já comprou por causa
 *    de um card antigo desfaria a venda aos olhos do dashboard.
 * 2. Senão, o card aberto mais avançado (maior `position` do board).
 * 3. Só perdido = lead perdido.
 *
 * A ordem importa: `position` sozinha elegeria `perdido`, que é a última
 * coluna do board.
 *
 * Etapa que não existe em `board_columns` é ignorada. Devolve null quando não
 * sobrou nada em que se basear — aí o chamador não mexe no lead.
 */
export function projectLeadStatus(
  deals: DealForLeadStatus[],
  columns: StageColumn[]
): string | null {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  let best: { rank: number; position: number; key: string } | null = null;

  for (const deal of deals) {
    const column = deal.stage ? byKey.get(deal.stage) : undefined;
    if (!column) continue;

    const rank = RANK[toStageType(column.stage_type)];
    const wins =
      !best || rank > best.rank || (rank === best.rank && column.position > best.position);

    if (wins) best = { rank, position: column.position, key: column.key };
  }

  return best?.key ?? null;
}
