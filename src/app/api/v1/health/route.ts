import { NextResponse } from "next/server";

import { withPublicApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Público (D14): diz só que a API responde. Não toca o banco nem revela nada.
export const GET = withPublicApi({ route: "/api/v1/health" }, () =>
  NextResponse.json({ ok: true, data: { status: "ok", api_version: "v1" } })
);
