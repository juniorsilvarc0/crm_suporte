// Localidade derivada do telefone.
//
// Não guardamos UF nem cidade do lead: derivamos o estado pelo DDD. Não é 100%
// preciso (portabilidade, quem mudou de cidade e manteve o número), mas todo
// lead tem telefone, então a cobertura é total — diferente de qualquer campo
// que dependesse de alguém preencher.
//
// Mora em lib/formatters porque é conhecimento sobre telefone, ao lado de
// phone.ts, e é consumido por mais de uma feature (dashboard e leads).
const DDD_TO_UF: Record<string, string> = {};
function fill(uf: string, ddds: number[]) {
  for (const d of ddds) DDD_TO_UF[String(d)] = uf;
}
fill("SP", [11, 12, 13, 14, 15, 16, 17, 18, 19]);
fill("RJ", [21, 22, 24]);
fill("ES", [27, 28]);
fill("MG", [31, 32, 33, 34, 35, 37, 38]);
fill("PR", [41, 42, 43, 44, 45, 46]);
fill("SC", [47, 48, 49]);
fill("RS", [51, 53, 54, 55]);
fill("DF", [61]);
fill("GO", [62, 64]);
fill("TO", [63]);
fill("MT", [65, 66]);
fill("MS", [67]);
fill("AC", [68]);
fill("RO", [69]);
fill("BA", [71, 73, 74, 75, 77]);
fill("SE", [79]);
fill("PE", [81, 87]);
fill("AL", [82]);
fill("PB", [83]);
fill("RN", [84]);
fill("CE", [85, 88]);
fill("PI", [86, 89]);
fill("PA", [91, 93, 94]);
fill("AM", [92, 97]);
fill("RR", [95]);
fill("AP", [96]);
fill("MA", [98, 99]);

// Extrai o DDD de um telefone em qualquer formato aceito no produto:
// com ou sem DDI, com ou sem o 9º dígito, formatado ou só dígitos.
export function dddFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  // 12 dígitos = wa_id da Cloud API (sem o 9º); 13 = provedor com o 9º.
  // Em ambos o DDI vem na frente e precisa sair antes de ler o DDD.
  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  // DDD (10 ou 11 dígitos nacionais) = 2 primeiros dígitos.
  if (digits.length < 10) return null;
  return digits.slice(0, 2);
}

// Retorna null quando não dá para determinar.
export function ufFromPhone(phone: string | null | undefined): string | null {
  const ddd = dddFromPhone(phone);
  return ddd ? (DDD_TO_UF[ddd] ?? null) : null;
}

// Rótulo curto para a UI: "SP · DDD 11". Para uma clínica que anuncia num raio
// fechado, o DDD diz mais que a UF — 11 é capital, 19 é Campinas.
export function formatPhoneLocation(phone: string | null | undefined): string | null {
  const ddd = dddFromPhone(phone);
  if (!ddd) return null;
  const uf = DDD_TO_UF[ddd];
  return uf ? `${uf} · DDD ${ddd}` : `DDD ${ddd}`;
}
