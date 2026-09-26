import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { pushTakeoverToAgent } from "@/features/chat/lib/push-takeover";
import { mapTicketError } from "@/features/tickets/lib/map-ticket-error";
import { TICKET_STATUS_KEYS } from "@/features/tickets/lib/ticket-status";
import {
  TICKET_PATCH_FIELDS,
  ticketSummarySchema,
  type TicketCreateInput,
  type TicketPatchInput,
} from "@/features/tickets/schemas/ticket";
import type {
  ActiveTicketData,
  CreateTicketData,
  TakeOverTicketData,
  TicketChangeData,
  TicketError,
  TicketResult,
  TicketStatusKey,
  TransitionTicketData,
} from "@/features/tickets/types";
import type { Database, Json } from "@/lib/supabase/types";
import { UUID_RE } from "@/lib/validation/uuid";

// ESCRITA de tickets: a porta única para as RPCs da migration _tickets (a tela
// agora, a API v1 na Fase 5). Nunca escreve em tickets nem na trilha direto.
//
// - O `db` é injetado: a rota cria o client (service role) DEPOIS do guard, e o
//   teste passa um `rpc` falso.
// - O ator vem da sessão (auth.viewer.id) ou do token, nunca do corpo.
// - Opcional nulo vira chave AUSENTE (?? undefined): o JSON do supabase-js a
//   descarta e vale o default da RPC.
// - Todo jsonb volta conferido por zod; o resumo do ticket é .strict()
//   (ticketSummarySchema) e o envelope é remontado campo a campo, então o
//   conversation_external_id (telefone) nunca sai daqui.
// - O aviso à IA (pushTakeoverToAgent) mora AQUI: nenhuma rota esquece.
// - Falha vira TicketResult com o TicketError de map-ticket-error. O 500 é
//   logado aqui, com o code e a message do banco (nunca o DETAIL, que pode
//   trazer a linha inteira); a rota loga de novo com o nome dela.

type TicketDb = SupabaseClient<Database>;

type DatabaseError = { message: string; code?: string; details?: string; hint?: string };

type TicketFailure = { ok: false; error: TicketError };

// `token` é da API v1 (Fase 5). Onde a RPC não aceita token (ticket_take_over),
// a assinatura recebe só o userId.
export type TicketActor = { kind: "user"; userId: string } | { kind: "token"; tokenId: string };

// Os campos do PATCH, sem a versão (que vai à parte, como p_expected_version).
// Ausente = não mexa; null = tire o valor.
export type TicketPatch = Omit<TicketPatchInput, "version">;

const uuidSchema = z.string().regex(UUID_RE);
const statusSchema = z.enum(TICKET_STATUS_KEYS);
// chat_conversations.external_id é NOT NULL (endereço do canal).
const externalIdSchema = z.string().min(1);

// Envelopes do jsonb de cada RPC (formato conferido no banco local). z.object
// descarta chave desconhecida, e a saída é remontada à mão de qualquer jeito.
const createResultSchema = z.object({
  ticket: ticketSummarySchema,
  created: z.boolean(),
  linked_messages: z.number().int().min(0),
  conversation_changed: z.boolean(),
  conversation_external_id: externalIdSchema,
});

const changeResultSchema = z.object({
  ticket: ticketSummarySchema,
  changed: z.boolean(),
});

const transitionResultSchema = z.object({
  ticket: ticketSummarySchema,
  from: statusSchema,
  to: statusSchema,
  changed: z.boolean(),
});

const setActiveResultSchema = z.object({
  active_ticket_id: uuidSchema.nullable(),
  changed: z.boolean(),
});

const takeOverResultSchema = z.object({
  ticket: ticketSummarySchema,
  conversation_id: uuidSchema,
  conversation_status: z.literal("human"),
  conversation_changed: z.boolean(),
  conversation_external_id: externalIdSchema,
});

// Só o sinal do push, lido ANTES do envelope inteiro: a RPC já fez commit, e se
// o resto do jsonb vier fora do formato (500 para a tela) a conversa continua
// `human` no banco. Sem o aviso, o bot seguiria respondendo ao cliente.
const takeoverSignalSchema = z.object({
  conversation_changed: z.literal(true),
  conversation_external_id: externalIdSchema,
});

function actorArgs(actor: TicketActor) {
  return actor.kind === "user"
    ? { p_actor_user_id: actor.userId }
    : { p_actor_token_id: actor.tokenId };
}

function rpcFailure(context: string, error: DatabaseError): TicketFailure {
  const mapped = mapTicketError(error);
  if (mapped.status >= 500) console.error(context, error.code, error.message);
  return { ok: false, error: mapped };
}

// A RPC fez commit, mas o jsonb não confere: é bug de contrato. O log leva só
// os caminhos e o motivo (z.prettifyError não repete o valor), nunca o jsonb,
// que traz título e telefone.
function unexpectedResult(context: string, error: z.ZodError): TicketFailure {
  console.error(context, "retorno inesperado da RPC", z.prettifyError(error));
  // mapTicketError sem erro = o 500 `internal` do mapa (a mesma mensagem).
  return { ok: false, error: mapTicketError(null) };
}

// Conversa passou a `human` agora: pausa o bot daquele contato. Background e
// best-effort, como o PATCH da conversa (o helper faz um retry e nunca lança).
function signalTakeover(data: unknown) {
  const signal = takeoverSignalSchema.safeParse(data);
  if (signal.success) {
    void pushTakeoverToAgent(signal.data.conversation_external_id, true);
  }
}

// Só as chaves que ticket_update aceita, e só as presentes: ausente fica
// ausente (não mexa); null segue como null JSON (tire o valor).
function toPatchJson(patch: TicketPatch): { [key: string]: Json } {
  const json: { [key: string]: Json } = {};
  for (const field of TICKET_PATCH_FIELDS) {
    const value = patch[field];
    if (value !== undefined) json[field] = value;
  }
  return json;
}

/**
 * Abre o ticket na conversa (create_ticket). A idempotency_key é por ator: o
 * mesmo pedido repetido devolve o ticket já aberto com `created: false`. Com
 * `take_over`, a mesma transação assume o atendimento; se a conversa passou a
 * `human` agora, avisa a IA.
 */
export async function createTicket(
  db: TicketDb,
  actor: TicketActor,
  input: TicketCreateInput
): Promise<TicketResult<CreateTicketData>> {
  const context = "[ticket-service] createTicket";
  const { data, error } = await db.rpc("create_ticket", {
    ...actorArgs(actor),
    p_conversation_id: input.conversation_id,
    p_title: input.title,
    p_priority: input.priority,
    p_description: input.description ?? undefined,
    p_product_id: input.product_id ?? undefined,
    p_category_id: input.category_id ?? undefined,
    p_take_over: input.take_over,
    p_idempotency_key: input.idempotency_key,
  });
  if (error) return rpcFailure(context, error);

  signalTakeover(data);

  const parsed = createResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResult(context, parsed.error);

  const { ticket, created, linked_messages } = parsed.data;
  return { ok: true, data: { ticket, created, linked_messages } };
}

/**
 * Edita título, descrição, prioridade, fila, categoria ou empresa
 * (ticket_update). Só os campos presentes em `patch` vão ao banco. O mesmo
 * valor de novo é no-op (`changed: false`) antes de conferir a versão.
 */
export async function updateTicket(
  db: TicketDb,
  actor: TicketActor,
  ticketId: string,
  expectedVersion: number,
  patch: TicketPatch
): Promise<TicketResult<TicketChangeData>> {
  const context = "[ticket-service] updateTicket";
  const { data, error } = await db.rpc("ticket_update", {
    ...actorArgs(actor),
    p_ticket_id: ticketId,
    p_expected_version: expectedVersion,
    p_patch: toPatchJson(patch),
  });
  if (error) return rpcFailure(context, error);

  const parsed = changeResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResult(context, parsed.error);

  const { ticket, changed } = parsed.data;
  return { ok: true, data: { ticket, changed } };
}

/**
 * Move o ticket na matriz de ticket_status_transitions (ticket_transition). O
 * motivo é exigido pela RPC só ao cancelar (REASON_REQUIRED). O mesmo status de
 * novo é no-op (`changed: false`).
 */
export async function transitionTicket(
  db: TicketDb,
  actor: TicketActor,
  ticketId: string,
  to: TicketStatusKey,
  expectedVersion: number,
  reason?: string | null
): Promise<TicketResult<TransitionTicketData>> {
  const context = "[ticket-service] transitionTicket";
  const { data, error } = await db.rpc("ticket_transition", {
    ...actorArgs(actor),
    p_ticket_id: ticketId,
    p_to: to,
    p_expected_version: expectedVersion,
    p_reason: reason ?? undefined,
  });
  if (error) return rpcFailure(context, error);

  const parsed = transitionResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResult(context, parsed.error);

  const { ticket, from, to: target, changed } = parsed.data;
  return { ok: true, data: { ticket, from, to: target, changed } };
}

/**
 * Troca ou tira (null) o responsável (ticket_assign). O mesmo responsável de
 * novo é no-op (`changed: false`).
 */
export async function assignTicket(
  db: TicketDb,
  actor: TicketActor,
  ticketId: string,
  expectedVersion: number,
  assigneeId: string | null
): Promise<TicketResult<TicketChangeData>> {
  const context = "[ticket-service] assignTicket";
  const { data, error } = await db.rpc("ticket_assign", {
    ...actorArgs(actor),
    p_ticket_id: ticketId,
    p_expected_version: expectedVersion,
    // Ausente = o default null da RPC = sem responsável.
    p_assignee_id: assigneeId ?? undefined,
  });
  if (error) return rpcFailure(context, error);

  const parsed = changeResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResult(context, parsed.error);

  const { ticket, changed } = parsed.data;
  return { ok: true, data: { ticket, changed } };
}

/**
 * Põe o ticket em foco na conversa, ou tira o foco (null), via
 * ticket_set_active. É o foco que carimba as mensagens novas da conversa.
 */
export async function setActiveTicket(
  db: TicketDb,
  actor: TicketActor,
  conversationId: string,
  ticketId: string | null
): Promise<TicketResult<ActiveTicketData>> {
  const context = "[ticket-service] setActiveTicket";
  const { data, error } = await db.rpc("ticket_set_active", {
    ...actorArgs(actor),
    p_conversation_id: conversationId,
    // Ausente = o default null da RPC = conversa sem foco.
    p_ticket_id: ticketId ?? undefined,
  });
  if (error) return rpcFailure(context, error);

  const parsed = setActiveResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResult(context, parsed.error);

  const { active_ticket_id, changed } = parsed.data;
  return { ok: true, data: { active_ticket_id, changed } };
}

/**
 * "Assumir" pelo ticket (ticket_take_over): conversa `human`, ticket em foco,
 * responsável = o analista e novo|em_triagem → em_atendimento. Só usuário (a
 * RPC não aceita token). Tomar o ticket de outro analista exige `reassign`
 * (sem ele: ALREADY_ASSIGNED). Se a conversa passou a `human` agora, avisa a IA.
 */
export async function takeOverTicket(
  db: TicketDb,
  userId: string,
  ticketId: string,
  reassign: boolean
): Promise<TicketResult<TakeOverTicketData>> {
  const context = "[ticket-service] takeOverTicket";
  const { data, error } = await db.rpc("ticket_take_over", {
    p_ticket_id: ticketId,
    p_actor_user_id: userId,
    p_reassign: reassign,
  });
  if (error) return rpcFailure(context, error);

  signalTakeover(data);

  const parsed = takeOverResultSchema.safeParse(data);
  if (!parsed.success) return unexpectedResult(context, parsed.error);

  const { ticket, conversation_id, conversation_status } = parsed.data;
  return {
    ok: true,
    data: { ticket, conversation: { id: conversation_id, status: conversation_status } },
  };
}
