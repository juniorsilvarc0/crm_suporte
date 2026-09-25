import { NextResponse } from "next/server";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    if (!(await getDashboardViewer())) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search") ?? "";

    const supabase = createSupabaseAdminClient();
    let query = supabase
      .from("chat_conversations")
      .select("*, contact:contacts(name, phone)")
      .is("removed_at", null)
      // Precisa casar com `compareByLastMessage`; divergência aqui reordena a
      // lista no primeiro evento de Realtime.
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (status === "archived") {
      query = query.not("archived_at", "is", null);
    } else {
      query = query.is("archived_at", null);
    }

    if (status && status !== "all" && status !== "archived") {
      query = query.eq("status", status);
    }

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`contact_name.ilike.${term},contact_phone.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const conversations = (data ?? []).map(({ contact, ...conversation }) => ({
      ...conversation,
      contact_name: contact?.name ?? conversation.contact_name,
      contact_phone: contact?.phone ?? conversation.contact_phone,
    }));

    return NextResponse.json({ conversations });
  } catch (err) {
    console.error("[GET /api/chat/conversations]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
