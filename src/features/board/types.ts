import type { Database } from "@/lib/supabase/types";

export type BoardColumn = Database["public"]["Tables"]["board_columns"]["Row"];
