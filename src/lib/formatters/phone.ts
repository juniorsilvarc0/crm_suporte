export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  // Remove o DDI do Brasil (55) quando presente, para que a mesma pessoa via
  // WhatsApp (ex.: 5527999990000) e via cadastro manual (ex.: 27999990000)
  // gerem a MESMA chave de deduplicação (normalized_phone). O guard length > 11
  // preserva números nacionais de 11 dígitos cujo DDD é 55 (Rio Grande do Sul).
  if (digits.length > 11 && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

export function formatPhone(value: string | null) {
  if (!value) {
    return "-";
  }

  const digits = normalizePhone(value);

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return value;
}

// Formata no padrão brasileiro de celular com o 9º dígito. Números com DDD + 8
// dígitos (10 no total, sem o 9) recebem um "9" após o DDD, virando o padrão
// (DD) 9XXXX-XXXX. Usado onde queremos exibir o número "completo" ao operador.
export function formatPhoneBR(value: string | null) {
  if (!value) {
    return "-";
  }

  let digits = normalizePhone(value);
  if (digits.length === 10) {
    digits = `${digits.slice(0, 2)}9${digits.slice(2)}`;
  }

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  return formatPhone(value);
}

/**
 * Variações do MESMO número para consultar numa fonte externa que casa por
 * formato exato (ex.: TCBX). A identidade é **DDD + os 8 últimos dígitos**; o 9º
 * dígito do celular, o `55` e o `+55` são só variações. Gera, do mais específico
 * ao menos, sem repetir: `DDD+8`, `DDD+9+8`, `55+DDD+8`, `55+DDD+9+8`. Devolve
 * vazio quando não dá para extrair DDD + 8 (número curto demais).
 */
export function phoneLookupCandidates(value: string | null | undefined): string[] {
  const national = normalizePhone(value ?? ""); // sem o 55
  if (national.length < 10) return [];
  const ddd = national.slice(0, 2);
  const last8 = national.slice(2).slice(-8); // tira o 9 extra quando houver
  const with9 = `${ddd}9${last8}`;
  const without9 = `${ddd}${last8}`;
  // Tenta primeiro o formato COMO VEIO (celular com o 9 → com o 9), depois a
  // outra variação; assim o número real é a 1ª tentativa e um match único sai
  // antes de arriscar casar o formato curto com outro cadastro.
  const [primary, secondary] = national.length >= 11 ? [with9, without9] : [without9, with9];
  return [...new Set([primary, secondary, `55${primary}`, `55${secondary}`])];
}
