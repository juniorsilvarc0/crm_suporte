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
