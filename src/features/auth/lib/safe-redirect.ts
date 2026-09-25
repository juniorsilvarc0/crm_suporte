/**
 * Destino depois do login, sempre dentro do próprio app.
 *
 * O `?redirect=` vem da URL, e qualquer um monta um link com ele: aceitar
 * endereço externo transformaria a tela de login num trampolim para phishing
 * ("entre aqui" → cai numa cópia do login que pede a senha de novo). A regra
 * compara a ORIGEM depois de resolver a URL contra a do app — um teste de
 * prefixo (`startsWith("/")`) deixaria passar `//outro.site`, `/\outro.site` e
 * as variações com tab ou quebra de linha, que o parser normaliza.
 */
export function safeRedirectPath(
  raw: string | null,
  origin: string,
  fallback = "/app"
): string {
  if (!raw) return fallback;

  let target: URL;
  try {
    target = new URL(raw, origin);
  } catch {
    return fallback;
  }

  if (target.origin !== origin) return fallback;
  return `${target.pathname}${target.search}${target.hash}`;
}
