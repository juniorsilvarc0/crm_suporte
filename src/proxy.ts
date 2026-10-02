import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { decideRouteAccess, isCrossOriginWrite } from "@/lib/auth/route-guard";

/** O host da URL pública do app (`APP_PUBLIC_URL`), quando ela está configurada. */
function publicHost(): string | null {
  try {
    return new URL(process.env.APP_PUBLIC_URL ?? "").host;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Antes de tudo: escrita (POST, PUT, PATCH, DELETE) vinda de outra origem não
  // chega a rota nenhuma, nem ao login nem a definir senha. Leitura passa: GET
  // não é coberto aqui.
  const crossOrigin = isCrossOriginWrite(pathname, {
    method: request.method,
    secFetchSite: request.headers.get("sec-fetch-site"),
    origin: request.headers.get("origin"),
    ownHosts: [request.headers.get("host"), publicHost()],
  });
  if (crossOrigin) {
    return NextResponse.json(
      {
        ok: false,
        error: "cross_origin",
        message: "Pedido recusado: ele não partiu desta aplicação.",
      },
      { status: 403 }
    );
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const session = await verifySessionToken(token);
  const decision = decideRouteAccess(pathname, session !== null, session?.role ?? null);

  switch (decision.type) {
    case "unauthorized":
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    case "forbidden":
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    case "redirect-login": {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", decision.redirectTo);
      return NextResponse.redirect(loginUrl);
    }
    case "redirect-app":
      return NextResponse.redirect(new URL("/app", request.url));
    case "allow":
      return;
  }
}

export const config = {
  matcher: [
    "/app/:path*",
    "/admin/:path*",
    "/definir-senha",
    "/login",
    "/api/:path*",
  ],
};
