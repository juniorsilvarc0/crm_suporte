import { describe, expect, it } from "vitest";

import { deliveredRow } from "@/features/chat/lib/realtime-payload";

describe("deliveredRow", () => {
  it("entrega a linha liberada", () => {
    expect(deliveredRow({ new: { id: "m-1" }, errors: null })).toEqual({ id: "m-1" });
  });

  it("descarta o evento negado pela RLS, que chega com new vazio", () => {
    expect(deliveredRow({ new: {}, errors: ["Error 401: Unauthorized"] })).toBeNull();
  });

  it("descarta new vazio mesmo sem errors", () => {
    expect(deliveredRow({ new: {} })).toBeNull();
  });
});
