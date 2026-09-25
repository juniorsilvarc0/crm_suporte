import type { ChatConversation } from "@/features/chat/types";

/**
 * Modelo da tela de informações do contato.
 *
 * A referência visual (WhatsApp) mostra dados de **perfil comercial** — horário,
 * categoria, descrição, site, endereço. Nada disso existe neste banco: medido em
 * 2026-08-08, `chat_conversations.metadata` só carrega `avatar_key`. O que existe
 * e vale a tela é o **lead**: 391 das 424 conversas (92%) casam com um por
 * telefone normalizado. Por isso o formato é o do iOS e o conteúdo é o do CRM.
 */

/** Lead correspondente à conversa, resolvido pelo telefone normalizado. */
export type ContactLead = {
  id: string;
  status: string;
  source: string | null;
  email: string | null;
  notes: string | null;
  valor_estimado: number | null;
  created_at: string;
};

/** Próximo agendamento futuro do lead, quando existe. */
export type ContactAppointment = {
  id: string;
  scheduled_at: string;
  status: string;
  tipo_ensaio: string | null;
};

export type ContactInfo = {
  lead: ContactLead | null;
  nextAppointment: ContactAppointment | null;
};

/**
 * Nome que a interface mostra.
 *
 * A queda para o telefone não é defensiva: 41 das 424 conversas chegam sem
 * `contact_name` porque a pessoa não tem nome de perfil no WhatsApp.
 */
export function contactDisplayName(
  conversation: Pick<ChatConversation, "contact_name" | "contact_phone">,
  fallback = "Contato"
): string {
  return conversation.contact_name || conversation.contact_phone || fallback;
}

/**
 * `href` de `tel:` em E.164, ou `null` quando o número não dá para discar.
 *
 * O telefone chega do WhatsApp já com DDI (`5511990000002`) e do cadastro manual
 * sem ele (`11990000002`). Discar o segundo sem `+55` cai no lugar errado quando
 * o aparelho está com outro país configurado — daí a completação explícita.
 *
 * O corte em 10 dígitos existe porque abaixo disso não é telefone brasileiro
 * discável, e um `tel:` inválido abre o discador com lixo em vez de não abrir.
 */
export function contactTelHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  // 10 e 11 dígitos = número nacional sem DDI (fixo e celular).
  if (digits.length <= 11) return `tel:+55${digits}`;
  return `tel:+${digits}`;
}

/**
 * Se o rascunho das notas difere do que está gravado.
 *
 * Compara aparado dos dois lados: espaço no fim não é alteração, e `null` no
 * banco e campo vazio na tela são o mesmo estado — sem isso o botão de salvar
 * nasceria habilitado em todo lead sem notas.
 */
export function notesAreDirty(draft: string, saved: string | null | undefined): boolean {
  return draft.trim() !== (saved ?? "").trim();
}

/**
 * O que vai para o `PATCH` do lead: texto aparado, ou `null` para limpar.
 *
 * `notes` é `nullableText` na rota (`/api/leads/[id]`), que já converte string
 * vazia em `null`. Mandar `null` explícito deixa a intenção legível no fio.
 */
export function notesPatchValue(draft: string): string | null {
  const trimmed = draft.trim();
  return trimmed === "" ? null : trimmed;
}
