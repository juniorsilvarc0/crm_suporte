import { afterEach, describe, expect, it, vi } from "vitest";

import { assertSafeUrl, safeBaseUrl, UnsafeUrlError } from "@/lib/security/ssrf-guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Nota: em ambiente de teste NODE_ENV !== 'production', então http e localhost
// são liberados (facilita testes locais); faixas privadas seguem bloqueadas.

describe("assertSafeUrl", () => {
  // Quem envia distingue "a URL foi recusada, nada saiu" de qualquer outra falha
  // pelo tipo do erro (senders/uazapi.ts).
  it.each([
    ["URL malformada", "não é url", "URL inválida."],
    ["esquema que não é http(s)", "ftp://exemplo.com", "A URL deve usar http ou https."],
    ["host de rede interna", "https://10.0.0.5", "A URL aponta para um host de rede interna (bloqueado)."],
  ])("%s lança UnsafeUrlError, com a mensagem de sempre", (_label, url, message) => {
    const attempt = () => assertSafeUrl(url);

    expect(attempt).toThrow(UnsafeUrlError);
    expect(attempt).toThrow(message);
  });

  it("http em produção lança UnsafeUrlError", () => {
    vi.stubEnv("NODE_ENV", "production");
    const attempt = () => assertSafeUrl("http://free.uazapi.com");

    expect(attempt).toThrow(UnsafeUrlError);
    expect(attempt).toThrow("Em produção a URL deve usar HTTPS.");
  });

  it("aceita https público", () => {
    expect(() => assertSafeUrl("https://free.uazapi.com")).not.toThrow();
    expect(assertSafeUrl("https://free.uazapi.com").hostname).toBe("free.uazapi.com");
  });

  it("rejeita esquema não-http(s)", () => {
    expect(() => assertSafeUrl("ftp://exemplo.com")).toThrow();
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow();
  });

  it("rejeita URL malformada", () => {
    expect(() => assertSafeUrl("não é url")).toThrow();
    expect(() => assertSafeUrl("")).toThrow();
  });

  it("bloqueia faixas privadas IPv4", () => {
    expect(() => assertSafeUrl("https://10.0.0.5")).toThrow();
    expect(() => assertSafeUrl("https://192.168.1.1")).toThrow();
    expect(() => assertSafeUrl("https://172.16.0.9")).toThrow();
    expect(() => assertSafeUrl("https://172.31.255.1")).toThrow();
  });

  it("permite 172.15/172.32 (fora da faixa privada B)", () => {
    expect(() => assertSafeUrl("https://172.15.0.1")).not.toThrow();
    expect(() => assertSafeUrl("https://172.32.0.1")).not.toThrow();
  });

  it("bloqueia link-local / metadata (169.254.169.254)", () => {
    expect(() => assertSafeUrl("https://169.254.169.254")).toThrow();
  });

  it("bloqueia hostnames internos", () => {
    expect(() => assertSafeUrl("https://algo.local")).toThrow();
    expect(() => assertSafeUrl("https://servico.localhost")).toThrow();
  });

  it("bloqueia loopback IPv6", () => {
    expect(() => assertSafeUrl("https://[::1]")).toThrow();
  });

  it("bloqueia IPv4 mapeado em IPv6 (::ffff:) para host interno", () => {
    // new URL normaliza p/ a forma hex (::ffff:a9fe:a9fe / ::ffff:7f00:1)
    expect(() => assertSafeUrl("https://[::ffff:169.254.169.254]")).toThrow();
    expect(() => assertSafeUrl("https://[::ffff:127.0.0.1]")).toThrow();
    expect(() => assertSafeUrl("https://[::ffff:10.0.0.1]")).toThrow();
  });

  it("bloqueia IPv4 ofuscado (decimal e hex) apontando p/ rede privada", () => {
    // new URL normaliza host numérico p/ IPv4 dotted; a faixa privada é
    // bloqueada mesmo em dev (só localhost/127.0.0.1 é liberado de propósito).
    expect(() => assertSafeUrl("https://167772161")).toThrow(); // 10.0.0.1 decimal
    expect(() => assertSafeUrl("https://0x0a000001")).toThrow(); // 10.0.0.1 hex
  });

  it("bloqueia metadata da cloud em decimal", () => {
    // 169.254.169.254 = 2852039166
    expect(() => assertSafeUrl("https://2852039166")).toThrow();
  });

  it("permite localhost em dev (NODE_ENV != production)", () => {
    expect(() => assertSafeUrl("http://localhost:3000")).not.toThrow();
    expect(() => assertSafeUrl("http://127.0.0.1:8080")).not.toThrow();
  });
});

// A tabela da guarda. Cada linha é uma URL e o que acontece com ela, fora de
// produção (como o teste roda) e em produção. A guarda está no caminho do
// WhatsApp (URL da instância e mídia) e do relay: host público não pode mudar de
// resultado, e host interno não pode passar por uma grafia diferente.
describe("assertSafeUrl: a tabela de hosts", () => {
  const INTERNAL = "A URL aponta para um host de rede interna (bloqueado).";
  const inProduction = () => vi.stubEnv("NODE_ENV", "production");

  describe("host público passa, em dev e em produção", () => {
    it.each([
      // Os que o app usa de verdade: a instância da uazapi e os arquivos do WhatsApp.
      ["instância da uazapi", "https://free.uazapi.com"],
      ["instância com caminho e porta", "https://x.uazapi.com:8443/api/"],
      ["mídia do WhatsApp", "https://mmg.whatsapp.net/v/t62/arquivo.enc?oh=1"],
      ["foto de perfil do WhatsApp", "https://pps.whatsapp.net/v/t61/foto.jpg"],
      ["agente em porta própria", "https://n8n.exemplo.com:5678/webhook/abc"],
      ["nome com ponto final (FQDN)", "https://agente.exemplo.com./hook"],
      // Nomes que começam como um prefixo de IPv6 interno, e não são IPv6.
      ["nome que começa por fc", "https://fcm.googleapis.com/x"],
      ["nome que começa por fc (.com.br)", "https://fcbots.com.br/hook"],
      ["nome que começa por fd", "https://fd-agente.exemplo.com/hook"],
      ["nome que começa por fe80", "https://fe80.exemplo.com/hook"],
      // Nomes que CONTÊM uma palavra reservada, sem terminar nela.
      ["`local` no meio do nome", "https://local.exemplo.com"],
      ["`localhost` no meio do nome", "https://localhost.exemplo.com"],
      ["`internal` no meio do nome", "https://internal.exemplo.com"],
      ["nome que termina em letras parecidas", "https://exemplolocal.com"],
      ["sufixo que só termina igual a um reservado", "https://agente.minhalocal"],
      ["sufixo que só termina igual a `internal`", "https://agente.xinternal"],
      ["nome internacional (punycode)", "https://xn--exmplo-cua.com.br"],
      // IP público, e os vizinhos de fora de cada faixa bloqueada.
      ["IPv4 público", "https://8.8.8.8"],
      ["vizinho de `esta rede`", "https://1.1.1.1"],
      ["abaixo da privada A", "https://9.255.255.255"],
      ["acima da privada A", "https://11.0.0.1"],
      ["abaixo do loopback", "https://126.255.255.255"],
      ["acima do loopback", "https://128.0.0.1"],
      ["acima do link-local", "https://169.255.0.1"],
      ["abaixo da privada C", "https://192.167.255.255"],
      ["acima da privada C", "https://192.169.0.1"],
      ["abaixo da privada B", "https://172.15.255.255"],
      ["acima da privada B", "https://172.32.0.1"],
      ["abaixo do CGNAT", "https://100.63.255.255"],
      ["acima do CGNAT", "https://100.128.0.1"],
      ["abaixo de 198.18/15", "https://198.17.255.255"],
      ["acima de 198.18/15", "https://198.20.0.1"],
      ["vizinho de 192.0.0/24", "https://192.0.1.1"],
      ["último antes do multicast", "https://223.255.255.255"],
      ["vizinho do link-local", "https://169.253.255.255"],
      ["IPv6 público", "https://[2606:4700:4700::1111]"],
      ["IPv6 público em 2001 (não é Teredo)", "https://[2001:4860:4860::8888]"],
      ["IPv4 público mapeado em IPv6", "https://[::ffff:8.8.8.8]"],
      ["outro IPv6 público", "https://[2a00:1450:4001::200e]"],
      ["vizinho de baixo do unique-local", "https://[fbff::1]"],
      ["vizinho de baixo do link-local", "https://[fe7f::1]"],
      ["vizinho do Teredo", "https://[2001:1::1]"],
      ["vizinho do 6to4", "https://[2003::1]"],
      ["vizinho do NAT64", "https://[64:ff9c::1]"],
      ["vizinho do NAT64 de uso local", "https://[64:ff9b:2::1]"],
      ["vizinho do IPv4-traduzido", "https://[::fffe:0:7f00:1]"],
      ["vizinho do IPv4-traduzido, do outro lado", "https://[::ffff:1:7f00:1]"],
      ["vizinho do IPv4-compatível", "https://[::1:7f00:1]"],
      ["vizinho do NAT64, do outro lado", "https://[64:ff9b::1:7f00:1]"],
    ])("%s", (_label, url) => {
      expect(() => assertSafeUrl(url)).not.toThrow();
      inProduction();
      expect(() => assertSafeUrl(url)).not.toThrow();
    });
  });

  describe("host interno é recusado, em dev e em produção", () => {
    it.each([
      // IPv4, faixa a faixa.
      ["privada A", "https://10.0.0.5"],
      ["privada B, começo", "https://172.16.0.9"],
      ["privada B, fim", "https://172.31.255.1"],
      ["privada C", "https://192.168.1.1"],
      ["metadata da cloud", "https://169.254.169.254/latest/meta-data"],
      ["esta rede", "https://0.0.0.0"],
      ["esta rede, outro endereço", "https://0.1.2.3"],
      ["esta rede, metade de cima", "https://0.200.0.1"],
      ["privada A, metade de cima", "https://10.200.0.1"],
      ["privada C, metade de cima", "https://192.168.200.1"],
      ["atribuições da IETF, metade de cima", "https://192.0.0.200"],
      ["loopback que não é 127.0.0.1", "https://127.0.0.2"],
      ["loopback, metade de cima", "https://127.200.0.1"],
      ["CGNAT, começo", "https://100.64.0.1"],
      ["CGNAT, metadata de nuvem", "https://100.100.100.200"],
      ["CGNAT, fim", "https://100.127.255.255"],
      ["atribuições da IETF", "https://192.0.0.8"],
      ["teste de desempenho, começo", "https://198.18.0.1"],
      ["teste de desempenho, fim", "https://198.19.255.255"],
      ["multicast", "https://224.0.0.1"],
      ["multicast, fim", "https://239.255.255.250"],
      ["reservada", "https://240.0.0.1"],
      ["broadcast", "https://255.255.255.255"],
      // IPv4 em grafias que o `new URL` normaliza.
      ["decimal", "https://167772161"],
      ["hex", "https://0x0a000001"],
      ["octal", "https://012.0.0.1"],
      ["forma curta", "https://10.1"],
      ["com ponto final", "https://10.0.0.5./x"],
      ["metadata em decimal", "https://2852039166"],
      // IPv6.
      ["loopback", "https://[::1]"],
      ["não especificado", "https://[::]"],
      ["IPv4 mapeado, loopback", "https://[::ffff:127.0.0.1]"],
      ["IPv4 mapeado, privada", "https://[::ffff:10.0.0.1]"],
      ["IPv4 mapeado, metadata", "https://[::ffff:169.254.169.254]"],
      ["IPv4 mapeado, CGNAT", "https://[::ffff:100.64.0.1]"],
      ["IPv4-compatível", "https://[::7f00:1]"],
      ["IPv4-compatível, metade de cima", "https://[::c0a8:101]"],
      ["IPv4-traduzido", "https://[::ffff:0:7f00:1]"],
      ["IPv4-traduzido, metade de cima", "https://[::ffff:0:c0a8:101]"],
      ["NAT64", "https://[64:ff9b::7f00:1]"],
      ["NAT64, metade de cima", "https://[64:ff9b::c0a8:101]"],
      ["NAT64 de uso local", "https://[64:ff9b:1::1]"],
      ["NAT64 de uso local, metade de cima", "https://[64:ff9b:1:8000::1]"],
      ["6to4", "https://[2002:7f00:1::1]"],
      ["6to4, metade de cima", "https://[2002:c0a8:101::1]"],
      ["Teredo", "https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]"],
      ["Teredo, metade de cima", "https://[2001:0:8000::1]"],
      ["unique-local fc", "https://[fc00::1]"],
      ["unique-local fd", "https://[fd12:3456:789a::1]"],
      ["link-local, começo", "https://[fe80::1]"],
      ["link-local, meio", "https://[fe90::1]"],
      ["link-local, fim", "https://[febf::1]"],
      ["site-local", "https://[fec0::1]"],
      ["site-local, fim", "https://[feff::1]"],
      ["multicast IPv6", "https://[ff02::1]"],
      ["multicast IPv6, fim", "https://[ffff::1]"],
      ["IPv6 em maiúsculas", "https://[FE80::1]"],
      // Nomes que só existem em rede interna.
      ["sufixo .local", "https://algo.local"],
      ["sufixo .local com ponto final", "https://algo.local./x"],
      ["sufixo .localhost", "https://servico.localhost"],
      ["host do Docker", "https://host.docker.internal:8443/hook"],
      ["metadata de nuvem por nome", "https://metadata.google.internal/x"],
      ["nome interno de nuvem", "https://ip-10-0-0-1.ec2.internal"],
      ["sufixo .home.arpa", "https://roteador.home.arpa"],
      ["em maiúsculas", "https://HOST.DOCKER.INTERNAL"],
      ["o nome `local` sozinho", "https://local"],
      ["o nome `internal` sozinho", "https://internal:8443/x"],
      ["`home.arpa` sozinho", "https://home.arpa"],
      ["host que é só pontos", "https://.../x"],
      // O host é o que vem DEPOIS do `@`: o que parece o host público é só o usuário.
      ["host público no lugar do usuário", "https://free.uazapi.com@10.0.0.1/x"],
      ["barra invertida antes do @", "https://10.0.0.1\\@free.uazapi.com/x"],
      // Grafias que o `new URL` traz para ASCII antes de a guarda olhar.
      ["dígitos de largura total", "https://１０.0.0.1/x"],
      ["ponto ideográfico", "https://10。0。0。1/x"],
      ["letras circuladas", "https://algo.ⓛⓞⓒⓐⓛ/x"],
      ["percent-encoding no host", "https://%31%30.0.0.1/x"],
    ])("%s", (_label, url) => {
      expect(() => assertSafeUrl(url)).toThrow(INTERNAL);
      expect(() => assertSafeUrl(url)).toThrow(UnsafeUrlError);
      inProduction();
      expect(() => assertSafeUrl(url)).toThrow(INTERNAL);
    });
  });

  describe("só em produção é recusado", () => {
    it.each([
      ["localhost", "https://localhost:3000"],
      ["localhost com ponto final", "https://localhost.:3000"],
      ["loopback", "https://127.0.0.1:8080"],
      ["loopback em forma curta", "https://127.1"],
      // Um rótulo só: resolve na rede do Docker, nunca na internet.
      ["serviço do Docker", "https://gateway"],
      ["serviço do Docker com porta", "https://db:5432"],
      ["serviço do Docker com caminho", "https://kong:8443/hook"],
      ["outra réplica do app", "https://crmsup-web-2:3000"],
      ["um rótulo com ponto final", "https://rest./x"],
    ])("%s", (_label, url) => {
      expect(() => assertSafeUrl(url)).not.toThrow();
      inProduction();
      expect(() => assertSafeUrl(url)).toThrow(INTERNAL);
    });

    it("http público passa em dev e, em produção, é recusado por não ser HTTPS", () => {
      expect(() => assertSafeUrl("http://agente.exemplo.com/hook")).not.toThrow();
      inProduction();
      expect(() => assertSafeUrl("http://agente.exemplo.com/hook")).toThrow("Em produção a URL deve usar HTTPS.");
    });
  });

  it("`development` é dev: só `production` aperta as regras", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(() => assertSafeUrl("http://localhost:3217/hook")).not.toThrow();
    expect(() => assertSafeUrl("http://127.0.0.1:3981/hook")).not.toThrow();
    expect(() => assertSafeUrl("http://mock:8080/hook")).not.toThrow();
    expect(() => assertSafeUrl("http://agente.exemplo.com/hook")).not.toThrow();
    // O que é rede interna em qualquer ambiente continua recusado.
    expect(() => assertSafeUrl("http://10.0.0.5/hook")).toThrow(INTERNAL);
    expect(() => assertSafeUrl("http://host.docker.internal/hook")).toThrow(INTERNAL);
  });

  it("`localhost` em letras circuladas é localhost: recusado em produção", () => {
    expect(assertSafeUrl("https://ⓛocalhost:3000").hostname).toBe("localhost");
    inProduction();
    expect(() => assertSafeUrl("https://ⓛocalhost:3000")).toThrow(INTERNAL);
  });

  it("zona de IPv6 não é URL válida", () => {
    expect(() => assertSafeUrl("https://[fe80::1%25eth0]/x")).toThrow("URL inválida.");
    expect(() => assertSafeUrl("https://[fe80::1%eth0]/x")).toThrow("URL inválida.");
  });

  it("um `@` depois do `#` é fragmento: o host continua sendo o público", () => {
    const url = assertSafeUrl("https://free.uazapi.com#@10.0.0.1");

    expect(url.hostname).toBe("free.uazapi.com");
    expect(url.hash).toBe("#@10.0.0.1");
  });

  it("a URL devolvida é a que foi recebida, sem trocar o host", () => {
    expect(assertSafeUrl("https://Agente.Exemplo.com./hook?x=1").href).toBe("https://agente.exemplo.com./hook?x=1");
    expect(assertSafeUrl("  https://free.uazapi.com/api  ").href).toBe("https://free.uazapi.com/api");
  });
});

describe("safeBaseUrl", () => {
  it("normaliza removendo barra final", () => {
    expect(safeBaseUrl("https://x.uazapi.com/")).toBe("https://x.uazapi.com");
    expect(safeBaseUrl("https://x.uazapi.com///")).toBe("https://x.uazapi.com");
  });

  it("preserva subpath sem barra final", () => {
    expect(safeBaseUrl("https://x.uazapi.com/api/")).toBe("https://x.uazapi.com/api");
  });

  // A base é concatenada com o caminho de cada chamada (`${base}/send/text`):
  // nada no caminho, na query ou no fragmento pode trocar o host.
  it.each([
    ["caminho que começa com duas barras", "https://x.uazapi.com//10.0.0.1", "https://x.uazapi.com//10.0.0.1"],
    ["barra invertida no caminho", "https://x.uazapi.com/\\10.0.0.1", "https://x.uazapi.com//10.0.0.1"],
    ["@ no caminho", "https://x.uazapi.com/..@10.0.0.1", "https://x.uazapi.com/..@10.0.0.1"],
    ["query e fragmento ficam de fora", "https://x.uazapi.com/api?x=//10.0.0.1#@10.0.0.1", "https://x.uazapi.com/api"],
  ])("%s: o host da base segue o público", (_label, input, base) => {
    expect(safeBaseUrl(input)).toBe(base);
    expect(new URL(`${safeBaseUrl(input)}/send/text`).hostname).toBe("x.uazapi.com");
  });

  it("recusa a base que a guarda recusa", () => {
    expect(() => safeBaseUrl("https://10.0.0.5/api")).toThrow(UnsafeUrlError);
    expect(() => safeBaseUrl("https://host.docker.internal")).toThrow(UnsafeUrlError);
  });
});
