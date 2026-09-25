import { NextResponse } from "next/server";
import { getMetaOperationalHealth } from "@/features/meta/health";
import { constantTimeSecretEquals } from "@/features/meta/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (
    !constantTimeSecretEquals(
      request.headers.get("x-meta-dispatch-secret"),
      process.env.META_DISPATCH_SECRET
    )
  ) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await getMetaOperationalHealth()) });
  } catch {
    return NextResponse.json({ ok: false, reason: "health_failed" }, { status: 500 });
  }
}

