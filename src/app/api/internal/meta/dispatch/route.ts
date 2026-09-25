import { NextResponse } from "next/server";
import { dispatchMetaWork } from "@/features/meta/outbox";
import { constantTimeSecretEquals } from "@/features/meta/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (
    !constantTimeSecretEquals(
      request.headers.get("x-meta-dispatch-secret"),
      process.env.META_DISPATCH_SECRET
    )
  ) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  try {
    const result = await dispatchMetaWork();
    return NextResponse.json({ ok: true, ...result });
  } catch {
    console.error("[meta-dispatch] run_failed");
    return NextResponse.json({ ok: false, reason: "dispatch_failed" }, { status: 500 });
  }
}

