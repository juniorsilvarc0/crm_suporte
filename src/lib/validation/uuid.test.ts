import { describe, expect, it } from "vitest";

import { isUuid, UUID_RE } from "@/lib/validation/uuid";

describe("isUuid", () => {
  it("aceita uuid em minúsculas e em maiúsculas", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5b")).toBe(true);
    expect(isUuid("3F2B8C1E-9A4D-4E7F-8B1A-0C9D8E7F6A5B")).toBe(true);
  });

  it("aceita qualquer versão, como as rotas existentes", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("01890a5d-ac96-774b-bcce-b302099a8057")).toBe(true);
  });

  it("recusa espaço, chaves, prefixo e texto em volta", () => {
    expect(isUuid(" 3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5b")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5b\n")).toBe(false);
    expect(isUuid("{3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5b}")).toBe(false);
    expect(isUuid("urn:uuid:3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5b")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5b; drop")).toBe(false);
  });

  it("recusa formato errado: sem hífens, curto, letra fora de hex", () => {
    expect(isUuid("3f2b8c1e9a4d4e7f8b1a0c9d8e7f6a5b")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5g")).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("recusa o que não é string, sem converter", () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(1024)).toBe(false);
    expect(isUuid(["3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5b"])).toBe(false);
    expect(isUuid({ id: "3f2b8c1e-9a4d-4e7f-8b1a-0c9d8e7f6a5b" })).toBe(false);
  });

  it("usa o mesmo regex das rotas existentes", () => {
    expect(UUID_RE.source).toBe(
      "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    );
    expect(UUID_RE.flags).toBe("i");
  });
});
