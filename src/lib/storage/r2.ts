import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 — o destino de toda mídia NOVA.
 *
 * O Supabase Storage continua servindo o que já está lá: `media_url` é gravado
 * como URL absoluta, então mensagem antiga aponta para o Supabase e mensagem
 * nova aponta para o R2, sem camada de tradução no meio. Nada foi copiado e
 * nada será apagado.
 *
 * ⚠️ Enquanto as credenciais não existirem no ambiente, `isR2Configured()`
 * devolve `false` e quem chama **cai no Supabase**. É de propósito: subir o
 * código antes das chaves não pode quebrar o recebimento de mídia.
 *
 * R2 é S3-compatível; `region: "auto"` é o que a Cloudflare exige.
 */

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

function readConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }
  // Sem barra no fim: a URL pública é montada com `${base}/${key}`.
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
  };
}

export function isR2Configured(): boolean {
  return readConfig() !== null;
}

let client: S3Client | undefined;

function getClient(config: R2Config): S3Client {
  // Singleton: cada `S3Client` abre seu próprio pool de conexões, e o webhook
  // roda a cada mensagem recebida.
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return client;
}

/**
 * Sobe o objeto e devolve a URL pública, ou `null` se o R2 não estiver
 * configurado ou a subida falhar.
 *
 * Nunca lança: perder o destino preferido não pode derrubar o recebimento da
 * mensagem — quem chama cai no Supabase.
 */
export async function putToR2(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string | null> {
  const config = readConfig();
  if (!config) return null;

  try {
    await getClient(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Um ano: a chave é aleatória e o conteúdo nunca muda no lugar.
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return `${config.publicBaseUrl}/${key}`;
  } catch (error) {
    console.error("[r2] upload falhou, caindo no Supabase:", error);
    return null;
  }
}
