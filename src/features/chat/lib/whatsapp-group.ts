// JID de grupo do WhatsApp (`120363000000000000@g.us`; os antigos têm o criador
// e a data: `5511999990000-1600000000@g.us`). Módulo sem dependências: a tela e
// o servidor conferem com a mesma regra.
export const GROUP_JID_RE = /^\d+(-\d+)?@g\.us$/;

export function isGroupJid(value: string | null | undefined): value is string {
  return typeof value === "string" && GROUP_JID_RE.test(value);
}
