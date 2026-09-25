import { getMetaRuntimeConfig } from "@/features/meta/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type MetaOperationalHealth = {
  capiState: "enabled" | "disabled";
  backlog: number;
  sent24h: number;
  discarded24h: number;
  deadLetters24h: number;
  oldestPendingAt: string | null;
  lastDrainAt: string | null;
  lastDeliveryAt: string | null;
};

export async function getMetaOperationalHealth(): Promise<MetaOperationalHealth> {
  const supabase = createSupabaseAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [backlog, sent, discarded, deadLetters, oldest, lastDelivery, dispatch] =
    await Promise.all([
      supabase
        .from("meta_conversion_outbox")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "processing", "retry"]),
      supabase
        .from("meta_conversion_outbox")
        .select("id", { count: "exact", head: true })
        .eq("status", "sent")
        .gte("sent_at", since),
      supabase
        .from("meta_conversion_outbox")
        .select("id", { count: "exact", head: true })
        .eq("status", "skipped")
        .gte("created_at", since),
      supabase
        .from("meta_conversion_outbox")
        .select("id", { count: "exact", head: true })
        .eq("status", "dead_letter")
        .gte("updated_at", since),
      supabase
        .from("meta_conversion_outbox")
        .select("created_at")
        .in("status", ["pending", "processing", "retry"])
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("meta_conversion_outbox")
        .select("sent_at")
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "meta_dispatch_health")
        .maybeSingle(),
    ]);

  const failed = [backlog, sent, discarded, deadLetters, oldest, lastDelivery, dispatch].find(
    (result) => result.error
  );
  if (failed?.error) throw new Error("meta_health_query_failed");

  const dispatchValue = dispatch.data?.value;
  const lastDrainAt =
    dispatchValue && !Array.isArray(dispatchValue) && typeof dispatchValue === "object"
      ? dispatchValue.completedAt
      : null;

  return {
    capiState: getMetaRuntimeConfig().capiEnabled ? "enabled" : "disabled",
    backlog: backlog.count ?? 0,
    sent24h: sent.count ?? 0,
    discarded24h: discarded.count ?? 0,
    deadLetters24h: deadLetters.count ?? 0,
    oldestPendingAt: oldest.data?.created_at ?? null,
    lastDrainAt: typeof lastDrainAt === "string" ? lastDrainAt : null,
    lastDeliveryAt: lastDelivery.data?.sent_at ?? null,
  };
}

