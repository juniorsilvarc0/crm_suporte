// Termo de busca dentro da conversa.

/**
 * Escapa os curingas do `LIKE`/`ILIKE`.
 *
 * Sem isto, buscar `100%` casa com qualquer coisa começada em `100`, e `_` casa
 * com qualquer caractere — o operador digita um termo comum e recebe a conversa
 * inteira, sem entender por quê.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type SearchSlice =
  | { text: string; match: false }
  | { text: string; match: true };

/**
 * Fatia o texto marcando onde o termo aparece, para a prévia do resultado
 * destacar sem `dangerouslySetInnerHTML` — o conteúdo vem do WhatsApp.
 *
 * Comparação sem acento e sem caixa: quem digita "consulta" precisa achar
 * "CONSULTA" e "Consultá".
 */
export function highlightSlices(text: string, term: string): SearchSlice[] {
  const needle = fold(term.trim());
  if (!needle || !text) return [{ text, match: false }];

  const haystack = fold(text);
  const slices: SearchSlice[] = [];
  let cursor = 0;

  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) slices.push({ text: text.slice(cursor, at), match: false });
    slices.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }

  if (cursor < text.length) slices.push({ text: text.slice(cursor), match: false });
  return slices.length > 0 ? slices : [{ text, match: false }];
}

/**
 * Minúsculas e sem acento, **preservando o comprimento** — os índices precisam
 * valer no texto original. Por isso `NFD` + remoção de diacrítico não serve:
 * ela muda o tamanho da string e desalinha o recorte.
 */
function fold(value: string): string {
  return value.toLowerCase().replace(/[áàâãäåéèêëíìîïóòôõöúùûüçñ]/g, (char) => ACCENTS[char] ?? char);
}

const ACCENTS: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a", å: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ç: "c", ñ: "n",
};
