import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Reencoda áudio de conversa para voz.
 *
 * É o maior item do armazenamento e ninguém tinha olhado: **403 MB de 704**,
 * 1.532 arquivos a 269 kB de média. A uazapi entrega o áudio do WhatsApp já
 * convertido em mp3, com bitrate de música — para um recado de 30 segundos.
 *
 * 32 kbps mono é padrão de voz: o recado continua perfeitamente inteligível e o
 * arquivo cai para perto de um quinto.
 *
 * **Por que mp3 e não Opus**, que seria metade disso: o Safari do iPhone é
 * irregular com Opus, e o CRM roda como PWA de iPhone. Áudio que não toca no
 * aparelho de quem atende não é economia, é defeito.
 *
 * O `ffmpeg` já está na imagem de produção (Dockerfile.production) — foi
 * instalado para a compressão de vídeo do envio.
 */

const MONO_VOICE_BITRATE = "32k";

const ffmpegArgs = (input: string, output: string) => [
  "-i",
  input,
  "-vn", // descarta capa embutida, se houver
  "-ac",
  "1", // mono: voz não tem estéreo a preservar
  "-ar",
  "24000", // 24 kHz cobre a banda da fala
  "-b:a",
  MONO_VOICE_BITRATE,
  "-c:a",
  "libmp3lame",
  "-y",
  output,
];

/**
 * Devolve o mp3 reencodado, ou `null` quando o ffmpeg falha ou o resultado não
 * ficou menor. **Nunca lança**: áudio original é melhor que áudio nenhum.
 */
export async function compressAudio(input: Buffer): Promise<Buffer | null> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "chat-audio-"));
    const inPath = join(dir, "in");
    const outPath = join(dir, "out.mp3");
    await writeFile(inPath, input);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ffmpegArgs(inPath, outPath), {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let err = "";
      proc.stderr.on("data", (chunk) => {
        err += String(chunk);
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg saiu com ${code}: ${err.slice(-400)}`));
      });
    });

    const output = await readFile(outPath);
    // Áudio já enxuto (um "ok" de 2 segundos) pode sair MAIOR pelo cabeçalho do
    // mp3. Nesse caso o original vence.
    return output.length < input.length ? output : null;
  } catch (error) {
    console.warn("[compressAudio] mantendo o original:", error);
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
