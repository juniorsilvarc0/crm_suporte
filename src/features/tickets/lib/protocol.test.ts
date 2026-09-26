import { describe, expect, it } from "vitest";

import { siteConfig } from "@/config/site";
import { formatProtocol, parseProtocolQuery } from "@/features/tickets/lib/protocol";

describe("formatProtocol", () => {
  it("monta o protocolo com o prefixo de site.ts", () => {
    expect(siteConfig.ticketPrefix).toBe("SUP");
    expect(formatProtocol(1024)).toBe("SUP-1024");
    expect(formatProtocol(1000)).toBe("SUP-1000");
  });
});

describe("parseProtocolQuery", () => {
  it.each([
    ["1024", 1024],
    ["#1024", 1024],
    ["SUP-1024", 1024],
    ["sup-1024", 1024],
    ["sup 1024", 1024],
    ["SUP1024", 1024],
    ["SUP - 1024", 1024],
    ["  SUP-1024  ", 1024],
    [formatProtocol(987654), 987654],
  ])("lê %j como o ticket %d", (query, expected) => {
    expect(parseProtocolQuery(query)).toBe(expected);
  });

  it.each([
    [""],
    ["   "],
    ["#"],
    ["SUP"],
    ["SUP-"],
    ["0"],
    ["#0"],
    ["01024"],
    ["SUP-01024"],
    ["-1024"],
    ["+1024"],
    ["1024.5"],
    ["1e3"],
    ["10 24"],
    ["1024abc"],
    ["abc1024"],
    ["SUP-1024-2"],
    ["SUP--1024"],
    ["##1024"],
    ["TKT-1024"],
    ["SUPORTE 1024"],
    ["１０２４"],
    ["erro na nota fiscal"],
  ])("recusa %j (texto de busca, não protocolo)", (query) => {
    expect(parseProtocolQuery(query)).toBeNull();
  });

  it("recusa número acima do inteiro seguro do JS", () => {
    expect(parseProtocolQuery(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseProtocolQuery("9007199254740993")).toBeNull();
    expect(parseProtocolQuery("99999999999999999999")).toBeNull();
  });
});
