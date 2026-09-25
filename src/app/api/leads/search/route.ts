import { NextResponse } from "next/server";

import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";

function sanitize(value: string) {
  return value.replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim();
}

// Busca incremental de clientes para o combobox do financeiro.
// Retorna no máximo 20 registros — nunca a tabela inteira.
export async function GET(request: Request) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, items: [] }, { status: 401 });
  }
  if (!hasSupabaseServerEnv()) {
    return NextResponse.json({ ok: true, items: [] });
  }

  const term = sanitize(new URL(request.url).searchParams.get("q") ?? "");

  try {
    const supabase = createSupabaseServerClient();
    let query = supabase
      .from("leads")
      .select("id, name, phone")
      .is("archived_at", null)
      .not("name", "is", null)
      .limit(20);

    if (term) {
      query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`).order("name", { ascending: true });
    } else {
      // Sem termo: mostra os clientes mais recentes como ponto de partida.
      query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;
    if (error) {
      console.error("leads/search", error.message);
      return NextResponse.json({ ok: true, items: [] });
    }

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (err) {
    console.error("leads/search threw", err);
    return NextResponse.json({ ok: true, items: [] });
  }
}
