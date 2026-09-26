// Tamanho de arquivo para a tela ("820 KB", "1.5 MB"). 3º uso: a prévia de
// anexo e o cartão de documento do chat tinham cada um a sua cópia, e o anexo do
// ticket é o terceiro. Base 1024; B e KB inteiros, MB e GB com uma casa.
//
// O separador decimal é o ponto, como as duas telas do chat já mostravam: a
// troca para a vírgula do pt-BR mudaria a saída delas.
//
// Valor negativo ou não finito devolve "": a tela não inventa um tamanho.

const KB = 1024;
const MB = KB ** 2;
const GB = KB ** 3;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}
