// A query string como a página (`searchParams` do Next) e a rota a recebem.
// Parâmetro repetido na URL: vale a PRIMEIRA ocorrência, nos dois lados.

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Os parâmetros de uma URL, com a primeira ocorrência de cada nome. */
export function searchParamsRecord(params: URLSearchParams): Record<string, string> {
  const seen = new Set<string>();
  return Object.fromEntries([...params].filter(([name]) => !seen.has(name) && seen.add(name)));
}
