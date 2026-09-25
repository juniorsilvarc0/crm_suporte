import type { Lead } from "@/features/leads/types";
import type { Database } from "@/lib/supabase/types";

export type DealRow = Database["public"]["Tables"]["deals"]["Row"];

// Deal (card do funil) enriquecido com o lead/contato dono — para o board.
// N deals por lead: cada agendamento é um card próprio.
export type Deal = DealRow & {
  lead: Lead | null;
};
