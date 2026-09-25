// Guarda anti-SSRF para URLs fornecidas pelo usuário (apiUrl da uazapi) ou vindas
// de payloads externos (URL de mídia no webhook). Sem isto, um valor malicioso
// poderia forçar o servidor a bater em serviços internos (metadata da cloud,
// bancos, etc.). Bloqueia esquema não-http(s), loopback e faixas privadas.
//
// Escopo: valida o HOST literal (IP ou hostname óbvio de rede interna). Não faz
// resolução de DNS — DNS-rebinding está fora do escopo deste app single-tenant.

// Converte várias grafias de IPv4 para os 4 octetos, ou null se não for IPv4
// reconhecível. Cobre grafias de OFUSCAÇÃO usadas p/ burlar filtros SSRF:
//   dotted (127.0.0.1), decimal inteiro (2130706433), hex (0x7f000001),
//   e IPv4 mapeado em IPv6 (::ffff:127.0.0.1 ou a forma hex ::ffff:7f00:1).
function toIpv4Octets(host: string): number[] | null {
  let h = host.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6: ::ffff:a.b.c.d  ou  ::ffff:hhhh:hhhh (forma normalizada)
  const mapped = h.match(/^::ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) {
      h = rest; // cai no parser dotted abaixo
    } else {
      const groups = rest.split(":");
      if (groups.length === 2 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
        const hi = parseInt(groups[0], 16);
        const lo = parseInt(groups[1], 16);
        return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
      }
      return null;
    }
  }

  // dotted quad
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const o = h.split(".").map(Number);
    return o.every((n) => n <= 255) ? o : null;
  }

  // decimal inteiro (ex.: 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    }
    return null;
  }

  // hex (0x7f000001)
  if (/^0x[0-9a-f]+$/.test(h)) {
    const n = parseInt(h, 16);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    }
  }

  return null;
}

function isPrivateIpv4Octets(o: number[]): boolean {
  const [a, b] = o;
  if (a === 127 || a === 10 || a === 0) return true; // loopback / privada A / this-host
  if (a === 192 && b === 168) return true; // privada C
  if (a === 169 && b === 254) return true; // link-local / metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // privada B
  return false;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // tira colchetes de IPv6

  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) {
    return true;
  }
  // loopback / unique-local / link-local IPv6
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;

  // IPv4 em qualquer grafia (inclui IPv4-mapped IPv6 e formas ofuscadas)
  const octets = toIpv4Octets(h);
  if (octets) return isPrivateIpv4Octets(octets);

  return false;
}

/**
 * Valida e normaliza uma URL externa. Lança `Error` se for insegura.
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
    throw new Error("URL inválida.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("A URL deve usar http ou https.");
  }

  const isProd = process.env.NODE_ENV === "production";

  if (isProd && url.protocol !== "https:") {
    throw new Error("Em produção a URL deve usar HTTPS.");
  }

  if (isPrivateHost(url.hostname)) {
    // Em dev, liberamos localhost/loopback para facilitar testes locais.
    if (isProd || !(url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      throw new Error("A URL aponta para um host de rede interna (bloqueado).");
    }
  }

  return url;
}

/** Base URL normalizada (sem barra final) a partir de um apiUrl validado. */
export function safeBaseUrl(rawUrl: string): string {
  const url = assertSafeUrl(rawUrl);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
