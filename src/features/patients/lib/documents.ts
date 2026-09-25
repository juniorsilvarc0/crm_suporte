/** Só os dígitos — é assim que CPF e CEP são guardados no banco. */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * CPF válido pelo dígito verificador.
 *
 * Não basta ter 11 dígitos: "111.111.111-11" tem, e não existe. Sem esta
 * checagem, um erro de digitação vira um cadastro duplicado que só aparece no
 * dia em que alguém tenta faturar o convênio.
 */
export function isValidCpf(value: string | null | undefined): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return false;
  // Todos os dígitos iguais passam na conta do verificador, mas não são CPF.
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const checkDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10]);
}

/** "12345678900" → "123.456.789-00" (exibição; o banco guarda só dígitos). */
export function formatCpf(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return value ?? "";
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** "29010000" → "29010-000". */
export function formatZipCode(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length !== 8) return value ?? "";
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/** Idade em anos a partir da data de nascimento (`AAAA-MM-DD`). */
export function ageFromBirthDate(birthDate: string | null | undefined, today = new Date()): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
