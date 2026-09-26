/**
 * Nome do objeto no armazenamento.
 *
 * ⚠️ **Sem o telefone do contato no caminho.** O layout antigo era
 * `5511990000024/inbound-1786108413241.webp`: bucket público, pasta nomeada
 * pelo número, e nota fiscal dentro. Quem soubesse o telefone tinha metade da
 * URL. A chave nova é aleatória e não diz nada sobre quem é o dono.
 *
 * O prefixo por ano/mês não é enfeite: é o que deixa uma regra de ciclo de vida
 * ("mova para Infrequent Access depois de N meses") ser escrita depois sem
 * precisar varrer o bucket.
 */

const EXT_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/** Extensão a partir do mimetype, com `bin` como último recurso. */
export function extFromMime(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? "bin";
}

/**
 * `chat/2026/08/<uuid>.<ext>`.
 *
 * `folder` separa origens que podem ter política diferente depois (mídia de
 * conversa x foto de perfil), sem voltar a identificar a pessoa.
 */
export function buildMediaKey(folder: string, ext: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, "") || "chat";
  return `${safeFolder}/${year}/${month}/${crypto.randomUUID()}.${ext}`;
}

/**
 * Chave da miniatura, derivada da chave do original.
 *
 * `foto.webp` → `foto.thumb.webp`. Derivar em vez de sortear uma segunda chave
 * mantém as duas juntas em qualquer listagem do bucket, o que importa no dia em
 * que alguém for escrever uma limpeza.
 */
export function thumbKeyFor(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot <= 0) return `${key}.thumb`;
  return `${key.slice(0, dot)}.thumb${key.slice(dot)}`;
}
