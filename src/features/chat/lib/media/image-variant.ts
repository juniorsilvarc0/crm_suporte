/**
 * Miniatura das imagens do chat.
 *
 * A bolha mostra a foto em ~308 CSS px, mas o `<img>` recebia a URL crua do
 * Storage — e o WebKit decodifica pelo tamanho ORIGINAL, não pelo tamanho na
 * tela. Uma foto de WhatsApp (900x1600) custa 5,5 MB de RAM decodificada.
 * Medido em produção: uma única conversa com 26 fotos chega a 143 MB, e o
 * processo do Safari no iPhone morre por volta de 100 MB. Era isso que
 * derrubava o PWA com "Um problema ocorreu repetidamente" em /app/chat.
 *
 * O transformador do Storage devolve a mesma foto em 640x1138 → 2,78 MB.
 *
 * Dois cuidados verificados contra a produção, não supostos:
 *  - **não amplia**: um webp de 512x512 volta 512x512, então imagem pequena
 *    não passa a custar mais RAM do que já custava;
 *  - só reescreve URL pública do NOSSO Storage. Mídia que ficou na URL do
 *    provedor (quando o `persistInboundMedia` falha) passa intacta.
 *
 * A URL original continua sendo a do lightbox e a do "Abrir original": quem
 * amplia a foto quer a foto, não a miniatura.
 */

/** Largura da miniatura. A bolha tem ~308 CSS px; 640 cobre tela 2x. */
export const CHAT_THUMB_WIDTH = 640;

/**
 * Endereço da miniatura a exibir na bolha, na ordem de preferência.
 *
 * 1. `metadata.thumbUrl` — a miniatura **de verdade**, gerada na entrada. É o
 *    caminho de toda mídia nova: o R2 não tem transformação sob demanda, então
 *    o arquivo pequeno é gravado junto com o cheio.
 * 2. O transformador do Supabase, para o que já estava lá antes da migração.
 * 3. A própria `src`, quando nenhum dos dois se aplica.
 *
 * Nada foi copiado nem apagado do Supabase: mensagem antiga continua com a URL
 * de lá, e é por isso que os três caminhos coexistem.
 */
export function chatThumbSrc(
  src: string,
  metadata: Record<string, unknown> | null | undefined
): string {
  const stored = metadata?.thumbUrl;
  if (typeof stored === "string" && stored.startsWith("http")) return stored;
  return chatImageThumbUrl(src);
}

const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const RENDER_IMAGE_PATH = "/storage/v1/render/image/public/";

/**
 * URL da miniatura para `src`. Devolve `src` inalterado quando não dá para
 * transformar — nunca lança, porque uma URL estranha não pode sumir com a
 * imagem da conversa.
 */
export function chatImageThumbUrl(src: string, width = CHAT_THUMB_WIDTH): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return src;
  if (!url.pathname.startsWith(PUBLIC_OBJECT_PATH)) return src;

  url.pathname =
    RENDER_IMAGE_PATH + url.pathname.slice(PUBLIC_OBJECT_PATH.length);
  url.searchParams.set("width", String(width));
  url.searchParams.set("resize", "contain");
  url.searchParams.set("quality", "75");
  return url.toString();
}

export type ImageDimensions = { width: number; height: number };

/**
 * Dimensões originais gravadas no `metadata` da mensagem, quando o provedor as
 * mandou. Servem para o `<img>` reservar a altura certa ANTES de carregar —
 * sem isso cada foto que chega remede a linha, empurra o que está abaixo e a
 * conversa salta debaixo do dedo. O WebKit não tem scroll anchoring para
 * absorver isso; Chrome e Firefox têm, e é por isso que só aparece no celular.
 *
 * Mensagem antiga não tem o campo e continua como sempre foi: sem atributo.
 * Nada é inventado a partir de um palpite de proporção.
 */
export function chatImageDimensions(
  metadata: Record<string, unknown> | null | undefined
): ImageDimensions | null {
  if (!metadata) return null;
  const width = metadata.mediaWidth;
  const height = metadata.mediaHeight;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}
