import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/features/auth/lib/safe-redirect";

const ORIGIN = "https://crm.exemplo.com";

describe("safeRedirectPath", () => {
  it("sem destino, vai para o app", () => {
    expect(safeRedirectPath(null, ORIGIN)).toBe("/app");
    expect(safeRedirectPath("", ORIGIN)).toBe("/app");
  });

  it("mantém caminho interno, com busca e âncora", () => {
    expect(safeRedirectPath("/app/chat", ORIGIN)).toBe("/app/chat");
    expect(safeRedirectPath("/app/chat?conversa=1#fim", ORIGIN)).toBe("/app/chat?conversa=1#fim");
  });

  it.each([
    "https://outro.site/login",
    "//outro.site/login",
    "/\\outro.site/login",
    "\t//outro.site",
    "javascript:alert(1)",
    "data:text/html,oi",
  ])("recusa destino fora da origem: %s", (raw) => {
    expect(safeRedirectPath(raw, ORIGIN)).toBe("/app");
  });
});
