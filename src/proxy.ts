import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AUTH_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { decideRouteAccess } from "@/lib/auth/route-guard";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
