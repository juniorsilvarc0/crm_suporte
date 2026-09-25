// Mensagem de contato (vCard) compartilhada no WhatsApp.
//
// O provedor entrega o vCard já achatado em texto dentro de `content`. Formato
// observado nas 14 mensagens que existem em produção:
//
//   Lead Chagas
//   Phone: +55 69 99000-0009
//
//   Emerson Somma
//   X-Wa-Biz-Name: Emerson Santos Corporativo
//   X-Wa-Biz-Description: Sommaph
//   Phone: +55 11 99000-0006
//
//   1. Caixa Moriah
//      Phone: +55 11 99000-0008
//   2. Hospital Moriah - RH / Financeiro
//      X-Wa-Biz-Name: Hospital Moriah - RH / Financeiro
//      Phone: +55 11 99000-0003
//
// Ou seja: pode vir mais de um contato (numerado, com linhas indentadas), mais
// de um telefone por contato, telefone rotulado (`Phone (Nextel):`) e campos de
// conta comercial.
//
// A leitura acontece aqui, e não no normalizer, porque as 14 mensagens já estão
// gravadas nesse formato — corrigir na entrada só arrumaria as próximas.

export type ContactPhone = {
  /** Rótulo entre parênteses, quando o WhatsApp manda um. */
  label: string | null;
  number: string;
};

export type ContactCard = {
  name: string;
  /** Nome da conta comercial, quando diferente do nome do contato. */
  businessName: string | null;
  phones: ContactPhone[];
};

const NUMBERED = /^\s*\d+\.\s*(.*)$/;
const PHONE = /^\s*phone\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/i;
const BIZ_NAME = /^\s*x-wa-biz-name\s*:\s*(.+)$/i;
/** Demais campos `X-...` do vCard (descrição, etc.) não entram no card. */
const OTHER_VCARD_FIELD = /^\s*x-[\w-]+\s*:/i;

/** Rótulo de quando o vCard veio só com telefone. Não é nome de ninguém. */
export const FALLBACK_CONTACT_NAME = "Contato";
const FALLBACK_NAME = FALLBACK_CONTACT_NAME;

function newCard(name: string): ContactCard {
  return { name: name.trim() || FALLBACK_NAME, businessName: null, phones: [] };
}

/**
 * Lê o texto do vCard. Devolve lista vazia quando não há nada aproveitável —
 * aí a bolha mostra o texto cru em vez de um card sem conteúdo.
 */
export function parseContactMessage(content: string | null | undefined): ContactCard[] {
  if (!content?.trim()) return [];

  const cards: ContactCard[] = [];
  let current: ContactCard | null = null;

  const ensure = () => {
    if (!current) {
      current = newCard("");
      cards.push(current);
    }
    return current;
  };

  for (const raw of content.split("\n")) {
    if (!raw.trim()) continue;

    // Item numerado sempre abre um contato novo, mesmo indentado.
    const numbered = NUMBERED.exec(raw);
    if (numbered) {
      current = newCard(numbered[1]);
      cards.push(current);
      continue;
    }

    const phone = PHONE.exec(raw);
    if (phone) {
      const number = phone[2].trim();
      if (number) {
        ensure().phones.push({ label: phone[1]?.trim() || null, number });
      }
      continue;
    }

    const biz = BIZ_NAME.exec(raw);
    if (biz) {
      ensure().businessName = biz[1].trim() || null;
      continue;
    }

    if (OTHER_VCARD_FIELD.test(raw)) continue;

    // Sobrou linha solta: é o nome de um contato.
    current = newCard(raw);
    cards.push(current);
  }

  // Card sem telefone e sem nome real não ajuda ninguém.
  return cards.filter((card) => card.phones.length > 0 || card.name !== FALLBACK_NAME);
}
