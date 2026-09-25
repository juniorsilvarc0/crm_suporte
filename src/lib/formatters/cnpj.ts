/**
 * CNPJ sem máscara, em caixa alta — é assim que o banco guarda
 * (`customers_cnpj_format_check`). Aceita o CNPJ alfanumérico da IN RFB
 * 2.229/2024: as 12 primeiras posições podem ter letras, os 2 DVs são dígitos.
 *
 * Filtra antes de subir a caixa: "ß".toUpperCase() vira "SS" e letras de fora
 * do ASCII não podem virar A–Z por acidente.
 */
export function normalizeCnpj(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

const FIRST_DV_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const SECOND_DV_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/**
 * CNPJ válido pelo dígito verificador.
 *
 * Não basta ter 14 caracteres: "11.111.111/1111-11" tem, e não existe. Sem esta
 * checagem, um erro de digitação vira uma empresa duplicada que só aparece no
 * dia em que alguém procura o cliente pelo CNPJ certo.
 */
export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  // Todos os caracteres iguais passam na conta do verificador, mas não são CNPJ.
  if (/^(.)\1{13}$/.test(cnpj)) return false;

  // Cada caractere vale o código ASCII − 48: os dígitos continuam 0–9 e as
  // letras vão de A = 17 a Z = 42. Os pesos são os do CNPJ numérico.
  const checkDigit = (weights: readonly number[]) => {
    let sum = 0;
    weights.forEach((weight, index) => {
      sum += (cnpj.charCodeAt(index) - 48) * weight;
    });
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return (
    checkDigit(FIRST_DV_WEIGHTS) === Number(cnpj[12]) &&
    checkDigit(SECOND_DV_WEIGHTS) === Number(cnpj[13])
  );
}

/** "12ABC34501DE35" → "12.ABC.345/01DE-35" (exibição; o banco guarda sem máscara). */
export function formatCnpj(value: string | null | undefined): string {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== 14) return value ?? "";
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
