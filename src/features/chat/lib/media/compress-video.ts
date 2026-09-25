import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Compressão/recodificação de vídeo com ffmpeg — mesma ideia do WhatsApp Web:
// reduz a resolução (cabe em 1280px no maior lado), re-encoda em H.264/AAC e
// limita o bitrate, gerando um MP4 web-friendly bem menor. Requer ffmpeg no PATH
// (instalado na imagem de produção).
const ffmpegArgs = (inp: string, out: string) => [
  "-i",
  inp,
  // cabe em 1280x1280 preservando aspecto; dimensões pares (libx264 exige)
  "-vf",
  "scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "28",
  "-maxrate",
  "2M",
  "-bufsize",
  "4M",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-movflags",
  "+faststart",
  "-y",
  out,
];

/**
 * Comprime um vídeo e devolve o MP4 resultante. Lança se o ffmpeg falhar ou
 * estourar o tempo (o chamador deve cair de volta para o arquivo original).
 */
export async function compressVideo(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "chat-vid-"));
  const inPath = join(dir, "input");
  const outPath = join(dir, "output.mp4");
  try {
    await writeFile(inPath, input);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ffmpegArgs(inPath, outPath), {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let err = "";
      proc.stderr.on("data", (d) => {
        err = (err + d.toString()).slice(-1500);
      });
      const killer = setTimeout(() => proc.kill("SIGKILL"), 120_000); // 2min máx
      proc.on("error", (e) => {
        clearTimeout(killer);
        reject(e);
      });
      proc.on("close", (code) => {
        clearTimeout(killer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg saiu com ${code}: ${err.slice(-400)}`));
      });
    });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
