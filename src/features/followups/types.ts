import type { Database } from "@/lib/supabase/types";

export type Followup = Database["public"]["Tables"]["followups"]["Row"] & {
  leads?: {
    name: string | null;
    phone: string | null;
  } | null;
};
