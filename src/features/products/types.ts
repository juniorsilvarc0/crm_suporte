// Produto = a FILA: cada software da casa (tickets.product_id na Fase 4).
// Escrito à mão com as colunas que as telas leem; `color` é um nome da paleta
// (features/tags/schemas/colors.ts), que o banco só confere no formato.
export type ProductOption = {
  id: string;
  name: string;
  niche: string | null;
  color: string;
  archived_at: string | null;
};
