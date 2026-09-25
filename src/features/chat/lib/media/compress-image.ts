import sharp from "sharp";

/**
 * Compressão de imagem na ENTRADA, não sob demanda.
 *
 * O `render/image` do Supabase resolvia o tamanho da miniatura na hora da
 * exibição. O R2 não tem transformação embutida (o equivalente da Cloudflare é
 * produto pago à parte), então o trabalho migra para o momento em que o arquivo
 * chega: grava-se **o cheio e a miniatura**, prontos.
 *
 * Sai melhor do que era: o cheio também encolhe (a foto de WhatsApp chega em
 * 900x1600 e vira 1600px de lado maior em webp), e a miniatura não custa
 * requisição a serviço nenhum.
 *
 * ⚠️ **Animação passa intacta.** Existem figurinhas webp animadas em produção
 * (verificado: 2 das 50, pela flag ANIM do bloco VP8X). Reencodar achataria em
 * um quadro parado. `sharp` denuncia isso em `metadata.pages > 1`.
 */

/** Lado maior do arquivo cheio. Acima disso é resolução que ninguém vê. */
const FULL_MAX = 1600;
/** Largura da miniatura — a bolha tem ~308 CSS px; 640 cobre tela 2x. */
const THUMB_WIDTH = 640;

export type ImageVariant = {
  body: Buffer;
  contentType: string;
  ext: string;
};

export type CompressedImage = {
  full: ImageVariant;
  /** Ausente quando o original já é menor que a miniatura, ou é animado. */
  thumb: ImageVariant | null;
  /** Dimensões do arquivo CHEIO, para o `<img>` reservar altura. */
  width: number | null;
  height: number | null;
};

const WEBP: Pick<ImageVariant, "contentType" | "ext"> = {
  contentType: "image/webp",
  ext: "webp",
};

/**
 * Comprime e gera a miniatura. **Nunca lança**: imagem que o `sharp` não
 * entende volta como chegou, porque perder a foto é pior que guardá-la grande.
 */
export async function compressImage(
  input: Buffer,
  mime: string
): Promise<CompressedImage> {
  const asIs: CompressedImage = {
    full: { body: input, contentType: mime, ext: mime.includes("png") ? "png" : "jpg" },
    thumb: null,
    width: null,
    height: null,
  };

  try {
    const image = sharp(input, { failOn: "none" });
    const meta = await image.metadata();

    // Animado (webp/gif de figurinha): reencodar mataria o movimento.
    if ((meta.pages ?? 1) > 1) {
      return {
        full: { body: input, contentType: mime, ext: mime.includes("gif") ? "gif" : "webp" },
        thumb: null,
        width: meta.width ?? null,
        height: meta.height ?? null,
      };
    }

    const full = await sharp(input, { failOn: "none" })
      // `withoutEnlargement`: imagem menor que o teto não é esticada — isso só
      // gastaria bytes e RAM de decodificação sem ganhar nitidez nenhuma.
      .rotate() // aplica a orientação do EXIF antes de redimensionar
      .resize({ width: FULL_MAX, height: FULL_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    const thumb =
      full.info.width > THUMB_WIDTH
        ? await sharp(input, { failOn: "none" })
            .rotate()
            .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer()
        : null;

    return {
      full: { body: full.data, ...WEBP },
      thumb: thumb ? { body: thumb, ...WEBP } : null,
      width: full.info.width,
      height: full.info.height,
    };
  } catch (error) {
    console.warn("[compressImage] mantendo o original:", error);
    return asIs;
  }
}
