// @vitest-environment node
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PING_ONLY_KEYS,
  relayFieldsSchema,
  RELAY_MEDIA_URL_TTL_SECONDS,
  RELAY_VERSION,
} from "@/features/integrations/server/relay-envelope";
import {
  RELAY_EVENT,
  RELAY_RETRY_DELAY_MS,
  RELAY_TIMEOUT_MS,
  RELAY_USER_AGENT,
} from "@/features/integrations/server/relay-message";
import { PING_EVENT, pingBody } from "@/features/integrations/server/relay-ping";
import { RELAY_SIGNING_SECRET_NAME } from "@/features/settings/types";
import { signEvent } from "@/lib/security/hmac";

// docs/CONTRATO-RELAY.md é o que o integrador lê. Este teste falha se o
// documento e o código se afastarem: campo sem descrição, exemplo fora do
// schema, vetor de assinatura que não confere, ou um trecho de conferência que
// não aceita o que o CRM assina.

// O documento fica fora de `src`: numa cópia do projeto sem a pasta `docs` (a
// imagem do Docker a deixa de fora), o erro tem de dizer isso, e não ENOENT.
const DOC_PATH = path.join(process.cwd(), "docs/CONTRATO-RELAY.md");
function readDoc(): string {
  try {
    // Fim de linha do Windows não muda o que o documento diz.
    return readFileSync(DOC_PATH, "utf8").replace(/\r\n/g, "\n");
  } catch {
    throw new Error("docs/CONTRATO-RELAY.md não foi encontrado: este teste precisa do repositório inteiro.");
  }
}
const doc = readDoc();

/** As chaves da raiz do evento `messages` no OpenAPI da uazapi, sem o `token`. */
const UAZAPI_ROOT_KEYS = ["BaseUrl", "EventType", "chat", "chatSource", "instanceName", "message", "owner"];

function example(): Record<string, unknown> {
  const match = /<!-- exemplo:envelope -->\n```json\n([\s\S]*?)\n```/.exec(doc);
  if (!match) throw new Error("exemplo do envelope não encontrado no documento");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

type Verifier = (key: string, headers: Record<string, string>, rawBody: string | Buffer) => boolean;
type Signer = (key: string, timestamp: string, rawBody: string | Buffer) => string;

/** As duas funções do trecho de Node.js do documento, como o integrador as copiaria. */
function nodeSnippet(): { assinar: Signer; assinaturaValida: Verifier } {
  const match = /```js\n([\s\S]*?)\n```/.exec(doc);
  if (!match) throw new Error("trecho de Node.js não encontrado no documento");
  const code = match[1].replace(/^import .*$/m, "");
  // O texto executado é o do próprio repositório, sem os `import` (injetados abaixo).
  const build = new Function("createHmac", "timingSafeEqual", `${code}\nreturn { assinar, assinaturaValida };`);
  return build(createHmac, timingSafeEqual) as { assinar: Signer; assinaturaValida: Verifier };
}

describe("docs/CONTRATO-RELAY.md", () => {
  const crmKeys = Object.keys(relayFieldsSchema.shape);

  it.each(crmKeys)("descreve o campo `%s`", (key) => {
    expect(doc).toContain(`| \`${key}\` |`);
  });

  it.each(["User-Agent", "X-CRM-Event", "X-CRM-Event-Id", "X-CRM-Timestamp", "X-CRM-Signature"])(
    "descreve o cabeçalho `%s`",
    (header) => {
      expect(doc).toContain(`| \`${header}\` |`);
    }
  );

  it("diz o evento, a versão, os prazos, a validade da mídia, quem envia e o nome da chave que o código usa", () => {
    expect(doc).toContain(`| \`X-CRM-Event\` | \`${RELAY_EVENT}\` na mensagem do cliente. No teste de conexão, \`${PING_EVENT}\``);
    expect(doc).toContain(`Hoje \`${RELAY_VERSION}\``);
    // A frase inteira: o documento tem outros prazos em negrito (os 5 minutos da assinatura).
    expect(doc).toContain(`O agente tem **${RELAY_TIMEOUT_MS / 1000} segundos** para responder`);
    expect(doc).toContain(`Ele vale por **${RELAY_MEDIA_URL_TTL_SECONDS / 60} minutos**`);
    expect(doc).toContain(`uma vez, ${RELAY_RETRY_DELAY_MS / 1000} segundo depois`);
    expect(doc).toContain(`| \`User-Agent\` | \`${RELAY_USER_AGENT}\`. |`);
    expect(doc).toContain(`\`${RELAY_SIGNING_SECRET_NAME}\``);
  });

  it("o exemplo do envelope vale no schema do contrato, campo a campo", () => {
    const body = example();

    const crm = Object.fromEntries(crmKeys.map((key) => [key, body[key]]));
    expect(relayFieldsSchema.safeParse(crm).error?.issues ?? []).toEqual([]);
  });

  it("o exemplo não leva o token da instância, e a raiz é a da uazapi mais os campos do CRM", () => {
    const body = example();

    expect(body).not.toHaveProperty("token");
    const others = Object.keys(body).filter((key) => !crmKeys.includes(key));
    expect(others.filter((key) => !UAZAPI_ROOT_KEYS.includes(key))).toEqual([]);
    expect(others).toEqual(expect.arrayContaining(["EventType", "message"]));
    // Como no envio: os campos do CRM vêm depois de tudo o que é do provedor.
    expect(Object.keys(body).slice(-crmKeys.length)).toEqual(crmKeys);
  });

  it("a chave de assinatura é gerada pelo CRM: o documento não manda mais digitá-la no cofre", () => {
    expect(doc).toContain("**Gerar chave**");
    expect(doc).toContain("64 caracteres hexadecimais");
    expect(doc).toContain("são 64 caracteres, e não 32 bytes a decodificar do hexadecimal");
    // A troca tem uma janela: o documento não promete o que o CRM não faz.
    expect(doc).toContain("não dá para configurar o agente antes");
    expect(doc).not.toContain("aceitar a nova e a anterior");
    expect(doc).toContain("**uma única vez**");
    expect(doc).not.toContain("Adicionar variável");
    expect(doc).not.toContain("openssl rand");
  });

  describe("o teste de conexão", () => {
    function pingExample(): Record<string, unknown> {
      const match = /<!-- exemplo:ping -->\n```json\n([\s\S]*?)\n```/.exec(doc);
      if (!match) throw new Error("exemplo do ping não encontrado no documento");
      return JSON.parse(match[1]) as Record<string, unknown>;
    }

    it("o exemplo tem os campos, a ordem e os valores fixos do que o CRM envia", () => {
      const sent = JSON.parse(pingBody("7c1d0c5e-2f4b-4a6d-9e8f-0a1b2c3d4e5f", new Date("2026-10-01T12:00:00.000Z")));

      expect(pingExample()).toEqual(sent);
      expect(Object.keys(pingExample())).toEqual(Object.keys(sent));
      expect(pingExample()).toMatchObject({ event: PING_EVENT, relay_version: RELAY_VERSION });
    });

    it("o exemplo não leva nenhum campo da mensagem do cliente, e a mensagem não leva o campo `event`", () => {
      const ping = pingExample();

      for (const key of [...crmKeys.filter((key) => key !== "relay_version"), "message", "chat", "EventType"]) {
        expect(ping, key).not.toHaveProperty(key);
      }
      // É por `event` que o agente separa o teste da mensagem: ele não pode existir na mensagem.
      expect(example()).not.toHaveProperty("event");
      expect(crmKeys).not.toContain("event");
    });

    it("diz que as chaves do teste nunca chegam na mensagem, e são as que o código reserva", () => {
      const sentence = doc.split("\n").find((line) => line.includes("Uma chave de raiz do provedor")) ?? "";

      expect(sentence).toContain("não é repassada");

      for (const key of PING_ONLY_KEYS) expect(sentence, key).toContain(`\`${key}\``);
      expect(doc).toContain(`**Reconhece o teste pelo corpo: \`event\` igual a \`${PING_EVENT}\`.**`);
      expect(doc).toContain("nunca tem o campo `event`");
    });

    it.each(Object.keys(JSON.parse(pingBody("x"))))("descreve o campo `%s` do corpo do teste", (key) => {
      const section = doc.slice(doc.indexOf("## 10. Teste de conexão"));

      expect(section).toContain(`| \`${key}\` |`);
    });

    it("diz por onde o teste vai: o mesmo caminho do repasse, assinado, com o mesmo prazo e sem seguir redirecionamento", () => {
      // A frase inteira: trocar "a mesma assinatura" por "sem assinatura" tem de falhar aqui.
      expect(doc).toContain(
        `O botão **Testar conexão** envia um evento \`${PING_EVENT}\` ao endereço salvo, pelo mesmo caminho do repasse: ` +
          `os mesmos cabeçalhos, a mesma assinatura, o mesmo prazo de ${RELAY_TIMEOUT_MS / 1000} segundos, e sem seguir redirecionamento.`
      );
      expect(doc).toContain("| `X-CRM-Event-Id` | Um identificador novo a cada teste. Repete o `event_id` do corpo. |");
      expect(doc).toContain("Ele testa o endereço **salvo**.");
    });

    it("diz o evento do cabeçalho, o que o agente faz e onde o teste fica registrado", () => {
      expect(doc).toContain(`## 10. Teste de conexão (\`${PING_EVENT}\`)`);
      expect(doc).toContain(`| \`X-CRM-Event\` | \`${PING_EVENT}\`. |`);
      expect(doc).toContain("Repete o `event_id` do corpo.");
      expect(doc).toContain("**Responde `2xx` e não faz mais nada.**");
      expect(doc).toContain(`ação \`${PING_EVENT}\``);
      expect(doc).toContain("O teste que chegou a sair também fica no registro do CRM");
      expect(doc).toContain("um agente que responde `2xx` a qualquer pedido passa no teste");
    });
  });

  it("o vetor de assinatura do documento é o que o CRM calcula", () => {
    const signature = signEvent("segredo-de-exemplo", "1790000000", '{"relay_version":1}');

    expect(doc).toContain("| Chave | `segredo-de-exemplo` |");
    expect(doc).toContain("| `X-CRM-Timestamp` | `1790000000` |");
    expect(doc).toContain('| Corpo | `{"relay_version":1}` |');
    expect(doc).toContain(`| \`X-CRM-Signature\` | \`${signature}\` |`);
  });

  describe("o trecho de Node.js do documento, rodado como está", () => {
    const { assinar, assinaturaValida } = nodeSnippet();
    const key = "chave-de-assinatura-com-32-caracteres-ou-mais";
    const body = '{"relay_version":1,"message":{"text":"ação 💬"}}';
    const now = () => String(Math.floor(Date.now() / 1000));
    const headers = (timestamp: string, signature: string) => ({
      "x-crm-timestamp": timestamp,
      "x-crm-signature": signature,
    });

    it("`assinar` dá o mesmo que o CRM, com texto ou com os bytes do corpo", () => {
      expect(assinar("segredo-de-exemplo", "1790000000", '{"relay_version":1}')).toBe(
        signEvent("segredo-de-exemplo", "1790000000", '{"relay_version":1}')
      );
      expect(assinar(key, "1790000000", Buffer.from(body, "utf8"))).toBe(signEvent(key, "1790000000", body));
    });

    it("aceita o que o CRM assina agora", () => {
      const timestamp = now();

      expect(assinaturaValida(key, headers(timestamp, signEvent(key, timestamp, body)), body)).toBe(true);
      expect(assinaturaValida(key, headers(timestamp, signEvent(key, timestamp, body)), Buffer.from(body, "utf8"))).toBe(true);
    });

    it("recusa corpo alterado, chave errada, instante velho e pedido sem assinatura", () => {
      const timestamp = now();
      const signature = signEvent(key, timestamp, body);
      const old = String(Number(timestamp) - 301);

      expect(assinaturaValida(key, headers(timestamp, signature), `${body} `)).toBe(false);
      expect(assinaturaValida("outra-chave-de-assinatura-com-32-ou-mais", headers(timestamp, signature), body)).toBe(false);
      expect(assinaturaValida(key, headers(old, signEvent(key, old, body)), body)).toBe(false);
      expect(assinaturaValida(key, { "x-crm-timestamp": timestamp }, body)).toBe(false);
      expect(assinaturaValida(key, {}, body)).toBe(false);
    });

    it("recusa chave vazia: sem ela qualquer um forjaria a assinatura", () => {
      const timestamp = now();
      const forged = "v1=" + createHmac("sha256", "").update(`${timestamp}.${body}`).digest("hex");

      expect(assinaturaValida("", headers(timestamp, forged), body)).toBe(false);
    });

    it("recusa instante que não é um número em segundos", () => {
      for (const timestamp of ["", "abc", "17900000000000", "1.5e9", " 1790000000", "²"]) {
        expect(assinaturaValida(key, headers(timestamp, "v1=x"), body), timestamp).toBe(false);
      }
    });
  });
});
