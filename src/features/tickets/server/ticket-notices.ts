import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  noticeClaimResultSchema,
  noticeFinalizeResultSchema,
  type NoticeClaimResult,
  type NoticeFinalizeResult,
} from "@/lib/api/v1/notices";
import type { Database } from "@/lib/supabase/types";

// As RPCs dos avisos ao cliente (20261009150000). A regra mora no banco: a
// linha do passo é travada, então duas reivindicações simultâneas nunca saem
// as duas com `claimed: true`.

type Admin = SupabaseClient<Database>;

export type NoticeFailure =
  | "ticket_not_found"
  | "notice_not_found"
  | "invalid"
  | "claim_lost"
  | "already_finalized"
  | "unavailable";

export type NoticeOutcome<T> = { ok: true; data: T } | { ok: false; error: NoticeFailure; status?: string };

const finalizeRefusalSchema = z.strictObject({
  finalized: z.literal(false),
  reason: z.enum(["claim_lost", "already_finalized"]),
  status: z.enum(["claimed", "sent", "failed"]),
});

function rpcFailure(error: PostgrestError, notFound: NoticeFailure, label: string): NoticeFailure {
  if (error.code === "P0002") return notFound;
  if (error.code === "22023") return "invalid";
  console.error(`[notices] ${label}`, error.code, error.message);
  return "unavailable";
}

export async function claimTicketNotice(
  supabase: Admin,
  input: { ticketId: string; step: string; tokenId: string; leaseSeconds?: number }
): Promise<NoticeOutcome<NoticeClaimResult>> {
  const { data, error } = await supabase.rpc("ticket_notice_claim", {
    p_ticket_id: input.ticketId,
    p_step: input.step,
    p_token_id: input.tokenId,
    ...(input.leaseSeconds === undefined ? {} : { p_lease_seconds: input.leaseSeconds }),
  });
  if (error) return { ok: false, error: rpcFailure(error, "ticket_not_found", "claim") };

  const parsed = noticeClaimResultSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[notices] claim: resposta fora do formato");
    return { ok: false, error: "unavailable" };
  }
  return { ok: true, data: parsed.data };
}

export async function finalizeTicketNotice(
  supabase: Admin,
  input: { ticketId: string; step: string; claimToken: string; outcome: "sent" | "failed"; error?: string }
): Promise<NoticeOutcome<NoticeFinalizeResult>> {
  const { data, error } = await supabase.rpc("ticket_notice_finalize", {
    p_ticket_id: input.ticketId,
    p_step: input.step,
    p_claim_token: input.claimToken,
    p_outcome: input.outcome,
    ...(input.error ? { p_error: input.error } : {}),
  });
  if (error) return { ok: false, error: rpcFailure(error, "notice_not_found", "finalize") };

  const done = noticeFinalizeResultSchema.safeParse(data);
  if (done.success) return { ok: true, data: done.data };
  const refused = finalizeRefusalSchema.safeParse(data);
  if (refused.success) return { ok: false, error: refused.data.reason, status: refused.data.status };
  console.error("[notices] finalize: resposta fora do formato");
  return { ok: false, error: "unavailable" };
}
