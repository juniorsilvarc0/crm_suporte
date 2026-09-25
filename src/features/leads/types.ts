import type { Database } from "@/lib/supabase/types";
import type { Tag } from "@/features/tags/types";

export type { Tag };

// Lead enriquecido com as tags (embutidas via PostgREST em getLeads).
export type Lead = Database["public"]["Tables"]["leads"]["Row"] & {
  tags?: Tag[];
};
