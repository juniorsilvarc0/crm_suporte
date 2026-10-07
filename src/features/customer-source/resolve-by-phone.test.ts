import { beforeEach, describe, expect, it, vi } from "vitest";

const { contextMock } = vi.hoisted(() => ({ contextMock: vi.fn() }));
vi.mock("@/features/customer-source/get-customer-context", () => ({ getCustomerContext: contextMock }));

import { resolveCustomerByPhone } from "@/features/customer-source/resolve-by-phone";

// "5586994259816" → candidatos: 86994259816, 8694259816, 5586994259816, 558694259816
const PHONE = "5586994259816";
const OK = { state: "ok", context: { externalId: "9" } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCustomerByPhone", () => {
  it("a 1ª variação que acha um cliente único vence", async () => {
    contextMock.mockImplementation(async ({ telefone }: { telefone: string }) =>
      telefone === "86994259816" ? OK : { state: "not_found" }
    );

    expect(await resolveCustomerByPhone(PHONE)).toEqual(OK);
    expect(contextMock).toHaveBeenCalledTimes(1);
  });

  it("variação ambígua (409) é pulada; a próxima que resolve vence", async () => {
    contextMock.mockImplementation(async ({ telefone }: { telefone: string }) => {
      if (telefone === "86994259816") return { state: "ambiguous" };
      if (telefone === "8694259816") return OK;
      return { state: "not_found" };
    });

    expect(await resolveCustomerByPhone(PHONE)).toEqual(OK);
    expect(contextMock).toHaveBeenCalledTimes(2);
  });

  it("todas ambíguas: `ambiguous` (não 'sem cadastro')", async () => {
    contextMock.mockResolvedValue({ state: "ambiguous" });
    expect(await resolveCustomerByPhone(PHONE)).toEqual({ state: "ambiguous" });
  });

  it("nenhuma achou: not_found (tentou todas as variações)", async () => {
    contextMock.mockResolvedValue({ state: "not_found" });

    expect(await resolveCustomerByPhone(PHONE)).toEqual({ state: "not_found" });
    expect(contextMock).toHaveBeenCalledTimes(4);
  });

  it("fonte fora: para na 1ª e devolve unavailable", async () => {
    contextMock.mockResolvedValue({ state: "unavailable" });

    expect(await resolveCustomerByPhone(PHONE)).toEqual({ state: "unavailable" });
    expect(contextMock).toHaveBeenCalledTimes(1);
  });

  it("integração desligada: para e devolve not_configured", async () => {
    contextMock.mockResolvedValue({ state: "not_configured" });

    expect(await resolveCustomerByPhone(PHONE)).toEqual({ state: "not_configured" });
    expect(contextMock).toHaveBeenCalledTimes(1);
  });

  it("telefone curto demais (sem variações): not_found, sem consultar", async () => {
    expect(await resolveCustomerByPhone("994259816")).toEqual({ state: "not_found" });
    expect(contextMock).not.toHaveBeenCalled();
  });
});
