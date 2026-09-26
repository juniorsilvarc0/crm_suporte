import { siteConfig } from "@/config/site";

// Protocolo do ticket: <ticketPrefix>-<tickets.number> (SUP-1024). O número é
// a identity do banco (começa em 1000) e está na URL do detalhe; o prefixo é
// só de exibição e mora em site.ts.

const PREFIX_PATTERN = siteConfig.ticketPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "#1024", "SUP-1024", "SUP 1024", "sup1024" ou "1024", e mais nada. Número sem
// zero à esquerda (o protocolo nunca é exibido assim). `\d` sem a flag `u` é só
// 0-9: dígito de outra escrita não passa.
const PROTOCOL_QUERY_RE = new RegExp(`^(?:#|${PREFIX_PATTERN}\\s*-?\\s*)?([1-9]\\d*)$`, "i");

export function formatProtocol(number: number): string {
  return `${siteConfig.ticketPrefix}-${number}`;
}

/**
 * O número do ticket quando a busca é um protocolo; `null` quando é texto
 * (título, empresa, contato). Número acima do inteiro seguro do JS também é
 * `null`: viraria outro número ao converter.
 */
export function parseProtocolQuery(query: string): number | null {
  const match = PROTOCOL_QUERY_RE.exec(query.trim());
  if (!match?.[1]) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}
