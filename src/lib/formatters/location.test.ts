import { describe, expect, it } from "vitest";

import {
  dddFromPhone,
  formatPhoneLocation,
  ufFromPhone,
} from "@/lib/formatters/location";

describe("dddFromPhone", () => {
  it("lê o DDD de um número nacional com o 9º dígito", () => {
    expect(dddFromPhone("11987654321")).toBe("11");
  });

  it("lê o DDD de um número nacional sem o 9º dígito", () => {
    expect(dddFromPhone("1132654321")).toBe("11");
  });

  it("remove o DDI antes de ler o DDD (13 dígitos, provedor com 9º)", () => {
    expect(dddFromPhone("5511987654321")).toBe("11");
  });

  it("remove o DDI antes de ler o DDD (12 dígitos, wa_id da Cloud API)", () => {
    // A Meta entrega wa_id sem o 9º dígito: 55 + 63 + 90000001.
    expect(dddFromPhone("556390000001")).toBe("63");
  });

  it("aceita telefone formatado", () => {
    expect(dddFromPhone("(19) 98112-5101")).toBe("19");
    expect(dddFromPhone("+55 11 99000-0002")).toBe("11");
  });

  it("não confunde DDD 55 com o DDI 55", () => {
    // Santa Rosa/RS: 55 é o DDD, não o país. Onze dígitos, sem DDI.
    expect(dddFromPhone("55999990000")).toBe("55");
  });

  it("devolve null para entrada curta, vazia ou ausente", () => {
    expect(dddFromPhone("999990000")).toBeNull();
    expect(dddFromPhone("")).toBeNull();
    expect(dddFromPhone(null)).toBeNull();
    expect(dddFromPhone(undefined)).toBeNull();
  });
});

describe("ufFromPhone", () => {
  it("mapeia DDD para UF", () => {
    expect(ufFromPhone("11987654321")).toBe("SP");
    expect(ufFromPhone("5527999990000")).toBe("ES");
    expect(ufFromPhone("556390000001")).toBe("TO");
  });

  it("devolve null para DDD inexistente", () => {
    expect(ufFromPhone("10999990000")).toBeNull();
  });

  it("devolve null sem telefone", () => {
    expect(ufFromPhone(null)).toBeNull();
  });
});

describe("formatPhoneLocation", () => {
  it("junta UF e DDD no rótulo curto", () => {
    expect(formatPhoneLocation("11987654321")).toBe("SP · DDD 11");
    expect(formatPhoneLocation("+55 19 98112-5101")).toBe("SP · DDD 19");
  });

  it("mostra só o DDD quando a UF é desconhecida", () => {
    expect(formatPhoneLocation("10999990000")).toBe("DDD 10");
  });

  it("devolve null quando não dá para determinar", () => {
    expect(formatPhoneLocation("999")).toBeNull();
    expect(formatPhoneLocation(null)).toBeNull();
  });
});
