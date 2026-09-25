import type { Database } from "@/lib/supabase/types";

export type IntegrationLog =
  Database["public"]["Tables"]["integration_logs"]["Row"];
