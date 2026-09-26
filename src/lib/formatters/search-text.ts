// Espelho de `public.normalize_search_text` (migration _contatos), que gera as
// colunas `search_name`. A busca por tokens só acha o que o banco gravou se o
// termo digitado passar pela MESMA transformação, na mesma ordem:
//   translate (tabela fixa abaixo) → lower → [^a-z0-9]+ vira espaço → trim.
//
// É uma tabela fixa, e não NFD + remoção de diacrítico, porque é isso que o SQL
// faz: letra acentuada fora da tabela (ex.: "ÿ", "ø") vira espaço nos dois lados.
// Mudou a função no banco? Mude as duas strings aqui, caractere por caractere.
const TRANSLATE_FROM = "ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑáàãâäéèêëíìîïóòõôöúùûüçñ";
const TRANSLATE_TO = "AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn";

const TRANSLATE_MAP = new Map(
  Array.from(TRANSLATE_FROM, (char, index) => [char, TRANSLATE_TO[index]] as const),
);

const TRANSLATE_RE = new RegExp(`[${TRANSLATE_FROM}]`, "g");

// Teto do termo e dos tokens: cada token vira um `ilike` no search_name, então
// um texto longo colado na busca não pode virar uma consulta com dezenas deles.
const MAX_QUERY_LENGTH = 100;
const MAX_TOKENS = 5;
const MIN_TOKEN_LENGTH = 2;

export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(TRANSLATE_RE, (char) => TRANSLATE_MAP.get(char) ?? char)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Quebra o termo digitado em tokens já normalizados. Como só sobram [a-z0-9],
// o token entra no filtro sem escape: não há vírgula, parêntese, "%" nem "_".
//
// Ex.: "Padaria São  João" -> ["padaria", "sao", "joao"] · "a b" -> []
export function searchTokens(query: string | null | undefined): string[] {
  return normalizeSearchText((query ?? "").slice(0, MAX_QUERY_LENGTH))
    .split(" ")
    .filter((token) => token.length >= MIN_TOKEN_LENGTH)
    .slice(0, MAX_TOKENS);
}
