import { NextResponse } from "next/server";

import { findLeadByPhone } from "@/features/leads/queries/webhook-mutations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Params = { params: Promise<{ phone: string }> };

// n8n polls this before sending automated messages.
// If status === 'human', n8n should not respond.
export async function GET(_req: Request, { params }: Params) {
  try {
    const { phone } = await params;
    const supabase = createSupabaseAdminClient();
    const decodedPhone = decodeURIComponent(phone);
    const lead = await findLeadByPhone(supabase, decodedPhone);

    if (!lead) {
      return NextResponse.json({ phone: decodedPhone, status: "bot", human_active: false });
    }

    const { data } = await supabase
      .from("chat_conversations")
      .select("status")
      .eq("lead_id", lead.id)
      .is("removed_at", null)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const status = data?.status ?? "bot";

    return NextResponse.json({
      phone: decodedPhone,
      status,
      human_active: status === "human",
    });
  } catch (err) {
    console.error("[GET /api/chat/status/[phone]]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
