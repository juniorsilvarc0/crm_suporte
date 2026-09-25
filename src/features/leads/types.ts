import type { Database } from "@/lib/supabase/types";

export type Tag = Database["public"]["Tables"]["tags"]["Row"];

// Lead enriquecido com as tags (embutidas via PostgREST em getLeads).
export type Lead = Database["public"]["Tables"]["leads"]["Row"] & {
  tags?: Tag[];
};
