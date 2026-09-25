import type { Database } from "@/lib/supabase/types";

// Etiqueta: vocabulário único, usado nas conversas do chat (e, por ora, nos
// contatos herdados).
export type Tag = Database["public"]["Tables"]["tags"]["Row"];
