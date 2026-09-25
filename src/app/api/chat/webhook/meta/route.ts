import { NextResponse } from "next/server";
import { getMetaRuntimeConfig } from "@/features/meta/config";
import { ingestMetaEnvelope } from "@/features/meta/ingest";
import { metaWebhookEnvelopeSchema } from "@/features/meta/schemas";
import {
  constantTimeSecretEquals,
  verifyMetaWebhookSignature,
} from "@/features/meta/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

async function readBodyWithLimit(request: Request, limit: number) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (
    mode === "subscribe" &&
    challenge &&
    constantTimeSecretEquals(token, verifyToken)
  ) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(request: Request) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ ok: false, reason: "body_too_large" }, { status: 413 });
  }

  const rawBody = await readBodyWithLimit(request, MAX_WEBHOOK_BYTES);
  if (!rawBody) {
    return NextResponse.json({ ok: false, reason: "body_too_large" }, { status: 413 });
  }

  if (
    !verifyMetaWebhookSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      appSecret
    )
  ) {
    return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  const envelope = metaWebhookEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) {
    return NextResponse.json({ ok: false, reason: "invalid_envelope" }, { status: 400 });
  }
  if (envelope.data.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, reason: "not_whatsapp" });
  }

  try {
    const result = await ingestMetaEnvelope(
      envelope.data,
      getMetaRuntimeConfig().captureEnabled
    );

    const manychatUrl = process.env.MANYCHAT_WEBHOOK_RELAY_URL;
    if (manychatUrl) {
      void fetch(manychatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope.data),
      }).catch(() => console.error("[meta-webhook] relay_failed"));
    }

    return NextResponse.json({ ok: true, ...result });
  } catch {
    console.error("[meta-webhook] persistence_failed");
    return NextResponse.json({ ok: false, reason: "persistence_failed" }, { status: 503 });
  }
}
