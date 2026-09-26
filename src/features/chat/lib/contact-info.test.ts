import { describe, expect, it } from "vitest";

import {
  contactDisplayName,
  contactTelHref,
  notesAreDirty,
  notesPatchValue,
} from "@/features/chat/lib/contact-info";

describe("contactDisplayName", () => {
  it("prefere o nome do contato", () => {
    expect(
      contactDisplayName({ contact_name: "Ana", contact_phone: "5511999998888" })
    ).toBe("Ana");
  });

  it("cai para o telefone quando o WhatsApp não mandou nome", () => {
    expect(
      contactDisplayName({ contact_name: null, contact_phone: "5511999998888" })
    ).toBe("5511999998888");
  });

  it("nome vazio conta como ausente", () => {
    expect(contactDisplayName({ contact_name: "", contact_phone: "551199" })).toBe(
      "551199"
    );
  });

  it("usa o fallback quando não há nome nem telefone", () => {
    expect(contactDisplayName({ contact_name: null, contact_phone: null })).toBe(
      "Contato"
    );
    expect(
      contactDisplayName({ contact_name: null, contact_phone: null }, "este contato")
    ).toBe("este contato");
  });
});

describe("contactTelHref", () => {
  it("mantém o DDI que já veio do WhatsApp", () => {
    expect(contactTelHref("558690000021")).toBe("tel:+558690000021");
  });

  it("completa com +55 o celular nacional de 11 dígitos", () => {
    expect(contactTelHref("11990000002")).toBe("tel:+5511990000002");
  });

  it("completa com +55 o fixo nacional de 10 dígitos", () => {
    expect(contactTelHref("1132224444")).toBe("tel:+551132224444");
  });

  it("ignora máscara, espaço e sinal", () => {
    expect(contactTelHref("+55 (11) 99000-0002")).toBe("tel:+5511990000002");
  });

  it("recusa número curto demais para discar", () => {
    expect(contactTelHref("123456789")).toBeNull();
    expect(contactTelHref("")).toBeNull();
    expect(contactTelHref(null)).toBeNull();
    expect(contactTelHref(undefined)).toBeNull();
  });
});

describe("notesAreDirty", () => {
  it("campo vazio e notas nulas são o mesmo estado", () => {
    expect(notesAreDirty("", null)).toBe(false);
    expect(notesAreDirty("   ", null)).toBe(false);
    expect(notesAreDirty("", undefined)).toBe(false);
  });

  it("espaço nas pontas não é alteração", () => {
    expect(notesAreDirty("  cliente prefere manhã  ", "cliente prefere manhã")).toBe(
      false
    );
  });

  it("texto diferente é alteração", () => {
    expect(notesAreDirty("prefere manhã", "prefere tarde")).toBe(true);
    expect(notesAreDirty("nova nota", null)).toBe(true);
  });

  it("apagar tudo é alteração quando havia nota", () => {
    expect(notesAreDirty("", "tinha nota")).toBe(true);
  });
});

describe("notesPatchValue", () => {
  it("apara o texto", () => {
    expect(notesPatchValue("  prefere manhã \n")).toBe("prefere manhã");
  });

  it("campo vazio vira null para limpar a coluna", () => {
    expect(notesPatchValue("")).toBeNull();
    expect(notesPatchValue("    ")).toBeNull();
  });
});
