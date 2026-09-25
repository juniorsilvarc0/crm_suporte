import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeEvolutionWebhook } from "@/features/chat/lib/normalizers/evolution";
import { upsertLeadFromInbound } from "@/features/chat/lib/upsert-lead";
import { upsertMessage } from "@/features/chat/lib/upsert-message";
import { resolveLeadIdentity } from "@/features/leads/queries/resolve-lead-identity";
import { getRelayUrl } from "@/features/settings/lib/get-relay-url";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;

    // Relay para o agente/automação (fire-and-forget). URL configurável na UI
    // (Configurações), com fallback para N8N_WEBHOOK_URL.
    const relayUrl = await getRelayUrl();
    if (relayUrl) {
      fetch(relayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => console.warn("[webhook/evolution] relay failed:", err));
    }

    // Lookup integration by instance name
    const instanceName = (payload.instance as string | undefined) ?? "";

    const supabase = createSupabaseAdminClient();
    const { data: integration } = await supabase
      .from("chat_integrations")
      .select("id, config")
      .eq("provider", "evolution")
      .eq("is_active", true)
      .filter("config->>instance", "eq", instanceName)
      .single();

    if (!integration) {
      // Still relay succeeded; just no chat integration registered for this instance
      return NextResponse.json({ ok: true, reason: "no_integration" });
    }

    const normalized = normalizeEvolutionWebhook(
      payload as Parameters<typeof normalizeEvolutionWebhook>[0]
    );
    if (!normalized) {
      return NextResponse.json({ ok: true, reason: "skipped" });
    }

    const identity =
      normalized.direction === "inbound"
        ? await upsertLeadFromInbound(supabase, {
            phone: normalized.contact_phone,
            name: normalized.contact_name,
          })
        : await resolveLeadIdentity(supabase, {
            phone: normalized.contact_phone,
            name: normalized.contact_name,
            source: "whatsapp",
            createInitialDeal: false,
            lastInteractionAt: null,
            reactivate: false,
          });

    await upsertMessage(integration.id, identity.leadId, normalized);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook/evolution]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
