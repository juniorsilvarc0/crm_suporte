import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

// Client de LEITURA server-side. Usa a SERVICE ROLE key (nunca exposta ao
// browser) porque as tabelas de dados têm RLS ligada (ver migration
// rls_tabelas_core) — a service key ignora RLS. É server-only: todos os sites
// que o importam são queries/rotas de servidor, nunca client components.
export function hasSupabaseServerEnv() {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function createSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server env vars are missing.");
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
