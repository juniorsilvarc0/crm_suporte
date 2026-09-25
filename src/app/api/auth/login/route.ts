import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AUTH_COOKIE,
  AUTH_COOKIE_MAX_AGE,
  createSessionToken,
} from "@/lib/auth/session";
import { isAppUserRole } from "@/features/settings/types";
import { readJsonBody } from "@/lib/http/read-json-body";
import { clientKeyFromRequest, rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Anti-força-bruta: no máximo 10 tentativas de login por IP por minuto.
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 60_000;

const loginSchema = z.object({
  email: z.string().trim().min(1, "Informe o email."),
  password: z.string().min(1, "Informe a senha."),
});

export async function POST(request: Request) {
  const limit = rateLimit(
    `login:${clientKeyFromRequest(request)}`,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_WINDOW_MS
  );
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: "Muitas tentativas de login. Tente novamente em instantes.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Autenticação não está configurada neste ambiente." },
      { status: 500 }
    );
  }

  // A verificação da senha acontece no banco (função verify_login com bcrypt),
  // então o hash nunca sai do Postgres.
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("verify_login", {
    p_email: parsed.data.email,
    p_password: parsed.data.password,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível validar o login." },
      { status: 500 }
    );
  }

  const user = data?.[0];
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Email ou senha incorretos." },
      { status: 401 }
    );
  }

  // Papel que o app não conhece (ex.: um `paid_traffic` que sobrou no banco)
  // não ganha sessão: falhar fechado é não herdar o acesso de ninguém.
  if (!isAppUserRole(user.role)) {
    return NextResponse.json(
      { ok: false, message: "Seu perfil não tem acesso a este sistema." },
      { status: 403 }
    );
  }

  const token = await createSessionToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  const response = NextResponse.json({ ok: true, message: "Sessão iniciada." });
  response.cookies.set({
    name: AUTH_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return response;
}
