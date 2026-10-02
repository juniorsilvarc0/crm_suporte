import { BlockList, isIP } from "node:net";

// Guarda anti-SSRF para URLs fornecidas pelo usuário (apiUrl da uazapi, URL do
// agente) ou vindas de payloads externos (URL de mídia no webhook). Sem isto, um
// valor malicioso poderia forçar o servidor a bater em serviços internos
// (metadata da cloud, bancos, etc.). Bloqueia esquema não-http(s), loopback,
// faixas privadas e reservadas, e nomes que só existem em rede interna.
//
// Escopo: valida o HOST literal. Quem entrega o host já normalizado é o
// `new URL` (IPv4 em decimal, hex, octal ou forma curta vira a.b.c.d; IPv6 vira
// a forma canônica). Não faz resolução de DNS: um nome público que aponte para
// um endereço interno passa por aqui. DNS-rebinding está fora do escopo deste
// app single-tenant.

// Para onde o servidor nunca deve ir. As regras de IPv4 valem também para o
// IPv4 mapeado em IPv6 (`::ffff:a.b.c.d`): o BlockList faz essa tradução.
const INTERNAL = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "esta rede"
  ["10.0.0.0", 8], // privada
  ["100.64.0.0", 10], // CGNAT: rede interna de operadora e de provedor de nuvem
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, inclui o metadata da cloud (169.254.169.254)
  ["172.16.0.0", 12], // privada
  ["192.0.0.0", 24], // atribuições de protocolo da IETF
  ["192.168.0.0", 16], // privada
  ["198.18.0.0", 15], // teste de desempenho entre redes
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservada, inclui o broadcast
] as const) {
  INTERNAL.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96], // não especificado (::), loopback (::1) e IPv4-compatível (::a.b.c.d)
  ["::ffff:0:0:0", 96], // IPv4-traduzido
  ["64:ff9b::", 96], // NAT64: embute um IPv4
  ["64:ff9b:1::", 48], // NAT64 de uso local
  ["2001::", 32], // Teredo: embute um IPv4
  ["2002::", 16], // 6to4: embute um IPv4
  ["fc00::", 7], // unique-local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (obsoleta)
  ["ff00::", 8], // multicast
] as const) {
  INTERNAL.addSubnet(network, prefix, "ipv6");
}

// Nomes que só resolvem dentro de uma rede: nenhum é delegado na internet.
// `.internal` cobre `host.docker.internal` e o metadata de nuvem por nome.
const INTERNAL_NAMES = ["localhost", "local", "internal", "home.arpa"];

/** O host sem os colchetes do IPv6 e sem o ponto final (`localhost.` é `localhost`). */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

function isInternalHost(host: string, isProd: boolean): boolean {
  if (!host) return true;

  const family = isIP(host);
  if (family === 4) return INTERNAL.check(host, "ipv4");
  if (family === 6) return INTERNAL.check(host, "ipv6");

  if (INTERNAL_NAMES.some((name) => host === name || host.endsWith(`.${name}`))) return true;

  // Nome de um rótulo só (`db`, `gateway`, `rest`): só resolve numa rede
  // interna, como a do Docker. Fora de produção fica liberado (um mock local).
  return isProd && !host.includes(".");
}

/** A URL não passou na guarda: nenhum pedido chegou a sair para ela. */
export class UnsafeUrlError extends Error {}

/**
 * Valida e normaliza uma URL externa. Lança `UnsafeUrlError` se for insegura.
 * Retorna a `URL` já parseada (sem barra final no pathname preservada).
 *
 * Em produção exige HTTPS. Em dev permite HTTP e `localhost` (para testar contra
 * uma instância local/túnel), mas nunca faixas privadas em produção.
 */
export function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new UnsafeUrlError("URL inválida.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("A URL deve usar http ou https.");
  }

  const isProd = process.env.NODE_ENV === "production";

  if (isProd && url.protocol !== "https:") {
    throw new UnsafeUrlError("Em produção a URL deve usar HTTPS.");
  }

  const host = normalizeHost(url.hostname);
  // Em dev, liberamos localhost/loopback para facilitar testes locais.
  const devLoopback = !isProd && (host === "localhost" || host === "127.0.0.1");
  if (!devLoopback && isInternalHost(host, isProd)) {
    throw new UnsafeUrlError("A URL aponta para um host de rede interna (bloqueado).");
  }

  return url;
}

/** Base URL normalizada (sem barra final) a partir de um apiUrl validado. */
export function safeBaseUrl(rawUrl: string): string {
  const url = assertSafeUrl(rawUrl);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
