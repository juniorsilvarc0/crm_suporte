import { NextResponse } from "next/server";

import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Qualquer token válido, mesmo sem escopo: é como o integrador descobre que o
// token existe mas não alcança nada. Nunca devolve o hash.
export const GET = withApi({ route: "/api/v1/me", scopes: [] }, ({ token }) =>
  NextResponse.json({
    ok: true,
    data: {
      token: {
        id: token.id,
        name: token.name,
        prefix: token.prefix,
        scopes: token.scopes,
        actor_type: token.actorType,
        rate_limit_per_min: token.rateLimitPerMin,
        expires_at: token.expiresAt,
      },
    },
  })
);
