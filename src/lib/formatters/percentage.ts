// Abaixo de meio ponto percentual, arredondar mente: 1 venda em 318 leads é
// 0,31% e virava "0%" no KPI de conversão — uma conversão real lida como
// nenhuma. Nesse caso mostra um dígito significativo (0,3% · 0,04%).
export function formatPercentage(value: number) {
  const rounded = Math.round(value);
  if (rounded === 0 && value !== 0) {
    return `${value.toLocaleString("pt-BR", { maximumSignificantDigits: 1 })}%`;
  }
  return `${rounded}%`;
}

export function ratioPercentage(part: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return (part / total) * 100;
}
