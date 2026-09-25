/**
 * Utilitários compartilhados de rede para a Graph API da Meta.
 *
 * Nasceu como cópia privada dentro de `outbox.ts`. Virou módulo quando o
 * relatório de investimento (`insights.ts`) passou a precisar do mesmo timeout:
 * chamada à Meta sem prazo trava o render inteiro da página de rastreamento,
 * que é `force-dynamic` e não tem cache para servir enquanto espera.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
