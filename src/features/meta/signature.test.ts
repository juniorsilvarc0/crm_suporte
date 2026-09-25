import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaWebhookSignature } from "@/features/meta/signature";

function sign(body: Uint8Array, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyMetaWebhookSignature", () => {
  const secret = "application-secret";

  it("aceita o HMAC dos bytes exatos, inclusive Unicode", () => {
    const body = new TextEncoder().encode('{"text":"Olá, próstata"}');
    expect(verifyMetaWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("recusa corpo alterado", () => {
    const original = new TextEncoder().encode('{"ok":true}');
    const changed = new TextEncoder().encode('{"ok":false}');
    expect(verifyMetaWebhookSignature(changed, sign(original, secret), secret)).toBe(false);
  });

  it.each([null, "", "sha1=abc", "sha256=xyz", `sha256=${"0".repeat(63)}`])(
    "recusa assinatura ausente ou malformada: %s",
    (signature) => {
      expect(verifyMetaWebhookSignature(new Uint8Array(), signature, secret)).toBe(false);
    }
  );
});

