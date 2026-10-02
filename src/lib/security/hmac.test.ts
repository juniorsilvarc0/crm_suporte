// @vitest-environment node
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signEvent } from "@/lib/security/hmac";

// O exemplo de docs/CONTRATO-RELAY.md. O valor esperado foi calculado FORA do
// app (`printf '%s' '1790000000.{"relay_version":1}' | openssl dgst -sha256
// -hmac 'segredo-de-exemplo'`): se a conta mudar, todo agente que confere a
// assinatura passa a recusar o CRM.
const SECRET = "segredo-de-exemplo";
const TIMESTAMP = "1790000000";
const BODY = '{"relay_version":1}';
const EXPECTED = "v1=a4c609d90ff44bf07040388f9ebe306a937dbcc7cd8622f0221b6f9ad96a0694";

describe("signEvent", () => {
  it("v1= + HMAC-SHA256 em hex de `<timestamp>.<corpo>`", () => {
    expect(signEvent(SECRET, TIMESTAMP, BODY)).toBe(EXPECTED);
  });

  it.each([
    ["o segredo", () => signEvent("outro-segredo", TIMESTAMP, BODY)],
    ["o timestamp", () => signEvent(SECRET, "1790000001", BODY)],
    ["o corpo", () => signEvent(SECRET, TIMESTAMP, '{"relay_version":2}')],
    // O ponto separa os dois: mover um dígito de um lado para o outro muda a conta.
    ["a fronteira entre timestamp e corpo", () => signEvent(SECRET, "179000000", `0.${BODY}`)],
  ])("muda quando muda %s", (_label, sign) => {
    const signature = sign();

    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(signature).not.toBe(EXPECTED);
  });

  it("assina o corpo em UTF-8 (acento não é perdido nem trocado)", () => {
    // `printf '%s' '1790000000.{"text":"não"}' | openssl dgst -sha256 -hmac 'segredo-de-exemplo'`
    expect(signEvent(SECRET, TIMESTAMP, '{"text":"não"}')).toBe(
      "v1=ad46466b4aa8380f199c7c0cab8278ffa2ae34042ba8cfd301ef4622d427bea8"
    );
  });

  // A conta é sobre o texto EXATO: quem confere usa os bytes que recebeu, e
  // qualquer "arrumação" do lado de cá faria a assinatura não bater do lado de lá.
  const independent = (secret: string, timestamp: string, body: string) =>
    `v1=${createHmac("sha256", Buffer.from(secret, "utf8")).update(Buffer.from(`${timestamp}.${body}`, "utf8")).digest("hex")}`;

  it("não normaliza o corpo: acento decomposto (teclado de iPhone) é assinado como veio", () => {
    const decomposed = '{"text":"na\u0303o"}'.normalize("NFD");
    const composed = decomposed.normalize("NFC");
    expect(decomposed).not.toBe(composed);

    expect(signEvent(SECRET, TIMESTAMP, decomposed)).toBe(independent(SECRET, TIMESTAMP, decomposed));
    expect(signEvent(SECRET, TIMESTAMP, decomposed)).not.toBe(signEvent(SECRET, TIMESTAMP, composed));
  });

  it("não apara a chave: espaço no começo ou no fim faz parte dela", () => {
    for (const secret of [" segredo", "segredo ", "segredo\n"]) {
      expect(signEvent(secret, TIMESTAMP, BODY), JSON.stringify(secret)).toBe(independent(secret, TIMESTAMP, BODY));
      expect(signEvent(secret, TIMESTAMP, BODY)).not.toBe(signEvent(secret.trim(), TIMESTAMP, BODY));
    }
  });

  it("recusa segredo vazio: HMAC de chave vazia não é assinatura", () => {
    expect(() => signEvent("", TIMESTAMP, BODY)).toThrow("hmac: segredo vazio");
  });
});
