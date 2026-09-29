import { NextResponse } from "next/server";

import { buildOpenApiDocument } from "@/lib/api/v1/openapi";
import { withPublicApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Público (D14): o contrato da API, sem dado nenhum.
export const GET = withPublicApi({ route: "/api/v1/openapi.json" }, () =>
  NextResponse.json(buildOpenApiDocument())
);
