import { NextResponse } from "next/server";

import { AUTH_COOKIE } from "@/lib/auth/session";

function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: AUTH_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function POST() {
  return clearSessionCookie(
    NextResponse.json({ ok: true, message: "Sessão encerrada." })
  );
}

// GET limpa o cookie e manda para /login. Usado quando o layout detecta uma
// sessão com JWT válido mas usuário inválido (desativado/removido): sem apagar o
// cookie, o middleware devolveria /login → /app em loop infinito.
export async function GET(request: Request) {
  return clearSessionCookie(
    NextResponse.redirect(new URL("/login", request.url))
  );
}
