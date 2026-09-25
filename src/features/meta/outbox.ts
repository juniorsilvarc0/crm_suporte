import { randomUUID } from "node:crypto";
import { getMetaRuntimeConfig, validateMetaDispatchConfig } from "@/features/meta/config";
import { fetchWithTimeout } from "@/features/meta/graph";
import {
  metaCapiResponseSchema,
  metaGraphAdSchema,
  metaGraphBatchSchema,
} from "@/features/meta/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

const RETRY_DELAYS_SECONDS = [30, 120, 600, 1_800, 7_200, 21_600, 43_200, 86_400];
const TRANSIENT_META_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80_004]);

type ClaimedEvent = {
  id: string;
  event_id: string;
  event_name: "LeadSubmitted" | "QualifiedLead";
  event_time: string;
  attempt_count: number;
  created_at: string;
  lease_token: string;
  ctwa_clid: string;
  whatsapp_business_id: string;
};

type DeliveryOutcome = {
  status: "sent" | "retry" | "dead_letter";
  httpStatus: number | null;
  category: string | null;
  code: string | null;
  message: string | null;
  summary: Json | null;
};

export function retryAt(
  attemptCount: number,
  now = Date.now(),
  random = Math.random
): string {
  const base = RETRY_DELAYS_SECONDS[Math.min(Math.max(attemptCount - 1, 0), 7)];
  const jitter = 0.8 + random() * 0.4;
  return new Date(now + base * jitter * 1000).toISOString();
}

function errorDetails(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "number" ? String(record.code) : null,
    type: typeof record.type === "string" ? record.type : null,
    isTransient: record.is_transient === true,
  };
}

export function classifyCapiResponse(
  httpStatus: number,
  payload: unknown,
  expectedEvents: number
): Omit<DeliveryOutcome, "message"> {
  const details = errorDetails(payload);
  const numericCode = details?.code ? Number(details.code) : null;
  const transient =
    httpStatus === 408 ||
    httpStatus === 425 ||
    httpStatus === 429 ||
    httpStatus >= 500 ||
    details?.isTransient === true ||
    (numericCode !== null && TRANSIENT_META_CODES.has(numericCode));
  const summary: Json = details
    ? { error_code: details.code, error_type: details.type, is_transient: details.isTransient }
    : {};

  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      status: transient ? "retry" : "dead_letter",
      httpStatus,
      category: transient ? "meta_transient" : "meta_permanent",
      code: details?.code ?? null,
      summary,
    };
  }

  const parsed = metaCapiResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      status: "retry",
      httpStatus,
      category: "partial_response",
      code: null,
      summary: { invalid_response: true },
    };
  }

  const received = parsed.data.events_received;
  if (received !== undefined && received < expectedEvents) {
    return {
      status: "retry",
      httpStatus,
      category: "partial_response",
      code: null,
      summary: { events_received: received, expected_events: expectedEvents },
    };
  }

  return {
    status: "sent",
    httpStatus,
    category: null,
    code: null,
    summary: {
      events_received: received ?? null,
      fbtrace_id: parsed.data.fbtrace_id ?? null,
    },
  };
}

// Um evento por request. A Meta não deduplica eventos de business messaging, então
// repetir um lote depois de um reconhecimento parcial contaria a conversão duas
// vezes. Com um único evento não existe resposta parcial: ou o request inteiro
// falha e pode ser repetido com segurança, ou o evento foi aceito.
function capiPayload(event: ClaimedEvent, testEventCode?: string, wabaId?: string) {
  return {
    data: [
      {
        event_name: event.event_name,
        event_time: Math.floor(new Date(event.event_time).getTime() / 1000),
        event_id: event.event_id,
        action_source: "business_messaging" as const,
        messaging_channel: "whatsapp" as const,
        user_data: {
          ctwa_clid: event.ctwa_clid,
          // A WABA do próprio toque manda. A env é só fallback: se estiver
          // errada, ela não pode reescrever a origem real de todo evento.
          whatsapp_business_account_id: event.whatsapp_business_id || wabaId,
        },
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

export function buildCapiPayloadForTest(
  event: ClaimedEvent,
  testEventCode?: string,
  wabaId?: string
) {
  return capiPayload(event, testEventCode, wabaId);
}

async function enrichPendingAssets() {
  const config = getMetaRuntimeConfig();
  if (!config.enrichmentEnabled || !config.accessToken) return { processed: 0 };

  const supabase = createSupabaseAdminClient();
  const { data: assets, error } = await supabase
    .from("meta_ad_assets")
    .select("source_id, attempt_count")
    .in("enrichment_status", ["pending", "retry"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at")
    .limit(50);
  if (error) throw new Error("asset_enrichment_lookup_failed");
  if (!assets?.length) return { processed: 0 };

  const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/`);
  url.searchParams.set("ids", assets.map((asset) => asset.source_id).join(","));
  url.searchParams.set("fields", "id,name,account_id,campaign{id,name},adset{id,name}");

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
  } catch {
    for (const asset of assets) {
      await supabase.rpc("apply_meta_ad_asset_enrichment", {
        p_source_id: asset.source_id,
        p_ad_id: null,
        p_ad_name: null,
        p_adset_id: null,
        p_adset_name: null,
        p_campaign_id: null,
        p_campaign_name: null,
        p_account_id: null,
        p_status: asset.attempt_count + 1 >= 8 ? "error" : "retry",
        p_last_error: "graph_transport_error",
      });
    }
    return { processed: assets.length };
  }

  const json: unknown = await response.json().catch(() => null);
  const batch = metaGraphBatchSchema.safeParse(json);
  const graphRetryable =
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500;

  for (const asset of assets) {
    const candidate = batch.success ? batch.data[asset.source_id] : undefined;
    const ad = metaGraphAdSchema.safeParse(candidate);
    const successful = response.ok && ad.success;
    const partial = successful && (!ad.data.campaign?.id || !ad.data.adset?.id);
    const retryableWithinLimit = graphRetryable && asset.attempt_count + 1 < 8;
    const { error: updateError } = await supabase.rpc(
      "apply_meta_ad_asset_enrichment",
      {
        p_source_id: asset.source_id,
        p_ad_id: successful ? ad.data.id : null,
        p_ad_name: successful ? ad.data.name ?? null : null,
        p_adset_id: successful ? ad.data.adset?.id ?? null : null,
        p_adset_name: successful ? ad.data.adset?.name ?? null : null,
        p_campaign_id: successful ? ad.data.campaign?.id ?? null : null,
        p_campaign_name: successful ? ad.data.campaign?.name ?? null : null,
        p_account_id: successful ? ad.data.account_id ?? null : null,
        p_status: successful
          ? partial
            ? "partial"
            : "enriched"
          : retryableWithinLimit
            ? "retry"
            : "error",
        p_last_error: successful ? null : response.ok ? "graph_asset_not_found" : `graph_http_${response.status}`,
      }
    );
    if (updateError) throw new Error("asset_enrichment_persistence_failed");
  }

  return { processed: assets.length };
}

async function finishEvent(event: ClaimedEvent, outcome: DeliveryOutcome) {
  const supabase = createSupabaseAdminClient();
  const exhausted = event.attempt_count >= 8;
  const finalStatus = outcome.status === "retry" && exhausted ? "dead_letter" : outcome.status;
  const { data, error } = await supabase.rpc("finish_meta_conversion_outbox_item", {
    p_id: event.id,
    p_lease_token: event.lease_token,
    p_status: finalStatus,
    p_next_attempt_at: finalStatus === "retry" ? retryAt(event.attempt_count) : null,
    p_http_status: outcome.httpStatus,
    p_error_category: exhausted && outcome.status === "retry" ? "retry_exhausted" : outcome.category,
    p_error_code: outcome.code,
    p_error_message: outcome.message,
    p_response_summary: outcome.summary,
  });
  if (error) throw new Error("outbox_finish_failed");
  return data ? 0 : 1;
}

async function deliverOne(event: ClaimedEvent, url: string, accessToken: string) {
  const config = getMetaRuntimeConfig();

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(capiPayload(event, config.testEventCode, config.wabaId)),
    });
  } catch {
    return finishEvent(event, {
      status: "retry",
      httpStatus: null,
      category: "transport",
      code: null,
      message: "Meta request failed or timed out.",
      summary: { transport_error: true },
    });
  }

  const json: unknown = await response.json().catch(() => null);
  const classified = classifyCapiResponse(response.status, json, 1);
  return finishEvent(event, {
    ...classified,
    message:
      classified.status === "sent"
        ? null
        : classified.category === "partial_response"
          ? "Meta did not acknowledge the event."
          : "Meta rejected the event.",
  });
}

async function deliverClaimed(events: ClaimedEvent[]) {
  const config = getMetaRuntimeConfig();
  if (!config.accessToken || !config.datasetId) throw new Error("capi_config_missing");

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(config.datasetId)}/events`;
  let staleLeases = 0;

  // Sequencial de propósito: uma falha de um evento não pode arrastar os outros,
  // e o volume esperado (~300 contatos por semana) não justifica paralelismo.
  for (const event of events) {
    staleLeases += await deliverOne(event, url, config.accessToken);
  }

  return staleLeases;
}

async function writeDispatchHealth(value: Record<string, Json | undefined>) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("app_settings").upsert({
    key: "meta_dispatch_health",
    value,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("meta_dispatch_health_write_failed");
}

export async function dispatchMetaWork() {
  const startedAt = new Date().toISOString();
  const config = getMetaRuntimeConfig();
  const missing = validateMetaDispatchConfig(config);
  if (missing.length) throw new Error(`meta_dispatch_config_missing:${missing.join(",")}`);

  const enrichment = await enrichPendingAssets();
  const supabase = createSupabaseAdminClient();
  const { data: redacted, error: redactionError } = await supabase.rpc(
    "redact_expired_meta_attributions",
    {}
  );
  if (redactionError) throw new Error("meta_redaction_failed");

  if (!config.capiEnabled) {
    const result = {
      mode: "disabled" as const,
      claimed: 0,
      enriched: enrichment.processed,
      redacted: redacted ?? 0,
      staleLeases: 0,
    };
    await writeDispatchHealth({ ...result, startedAt, completedAt: new Date().toISOString() });
    return result;
  }

  const owner = `meta-dispatcher:${randomUUID()}`;
  const { data, error } = await supabase.rpc("claim_meta_conversion_outbox", {
    p_owner: owner,
    // Menor que os 50 anteriores porque agora é um request por evento. Com
    // timeout de 10s cada, o pior caso da rodada fica em 100s — dentro do lease
    // de 5 minutos. A 30s por ciclo isso dá ~1200 eventos/hora de vazão.
    p_limit: 10,
  });
  if (error) throw new Error("outbox_claim_failed");
  const events = (data ?? []) as ClaimedEvent[];
  const staleLeases = events.length ? await deliverClaimed(events) : 0;
  const result = {
    mode: "enabled" as const,
    claimed: events.length,
    enriched: enrichment.processed,
    redacted: redacted ?? 0,
    staleLeases,
  };
  await writeDispatchHealth({ ...result, startedAt, completedAt: new Date().toISOString() });
  return result;
}
