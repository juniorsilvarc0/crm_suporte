import type { BoardColumn } from "@/features/board/types";
import { leadStatusColor, leadStatusLabel, leadStatusOrder } from "@/features/leads/schemas/status";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

const fallbackProbability: Record<string, number> = {
  novo: 10,
  em_atendimento: 25,
  qualificado: 40,
  agendado: 60,
  compareceu: 80,
  cliente: 100,
  recorrente: 100,
  perdido: 0,
};

// Fallback em memória (as 8 etapas canônicas) caso o Supabase/tabela não exista —
// garante que o board sempre renderiza algo coerente.
export const fallbackBoardColumns: BoardColumn[] = leadStatusOrder.map((key, i) => ({
  id: `fallback-${key}`,
  key,
  label: leadStatusLabel[key] ?? key,
  color: leadStatusColor[key] ?? "slate",
  position: i,
  probability: fallbackProbability[key] ?? null,
  stage_type:
    key === "cliente" || key === "recorrente"
      ? "won"
      : key === "perdido"
        ? "lost"
        : "open",
  // Espelha o backfill da migration: sem configuração, conversão = ganho.
  counts_as_conversion: key === "cliente" || key === "recorrente",
  // O fallback representa o funil nativo de leads; sem banco, não há id real.
  pipeline_id: "fallback-pipeline",
  is_default: key === "novo",
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
}));

export async function getBoardColumns(): Promise<BoardColumn[]> {
  if (!hasSupabaseServerEnv()) {
    return fallbackBoardColumns;
  }

  try {
    const supabase = createSupabaseServerClient();
    // ⚠️ Só as etapas do funil NATIVO de leads.
    //
    // Desde os funis personalizáveis, `board_columns` guarda as etapas de TODOS
    // os funis. Sem este filtro, criar um funil de processos faria as colunas
    // dele aparecerem no kanban de leads — e a `key` só é única por funil, então
    // duas colunas "novo" colidiriam na leitura.
    const { data, error } = await supabase
      .from("board_columns")
      .select("*, pipelines!inner(kind)")
      .eq("pipelines.kind", "leads")
      .order("position", { ascending: true });

    if (error) {
      console.error("getBoardColumns failed", error.message);
      return fallbackBoardColumns;
    }

    // O `pipelines` embutido serve só ao filtro; a linha devolvida é a coluna.
    const columns = (data ?? []).map(({ pipelines: _pipeline, ...column }) => column as BoardColumn);
    return columns.length > 0 ? columns : fallbackBoardColumns;
  } catch (error) {
    console.error("getBoardColumns threw", error);
    return fallbackBoardColumns;
  }
}
