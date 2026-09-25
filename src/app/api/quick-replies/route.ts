import { NextResponse } from "next/server";

import { quickReplyInputSchema } from "@/features/quick-replies/schemas";
import { getQuickReplies } from "@/features/quick-replies/queries/get-quick-replies";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

const QUICK_REPLY_COLUMNS =
  "id, title, shortcut, content, is_active, created_by_user_id, created_at, updated_at";

/**
 * `?scope=all` inclui as inativas.
 *
 * O padrão continua sendo só as ativas: quem apenas consome a lista para enviar
 * não deve receber mensagem aposentada. Quem gerencia (o popover do chat) pede
 * `all` explicitamente, porque não dá para reativar o que não aparece.
 */
export async function GET(request: Request) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const scope = new URL(request.url).searchParams.get("scope");
  const items = await getQuickReplies({ activeOnly: scope !== "all" });
  return NextResponse.json({ ok: true, items });
}

export async function POST(request: Request) {
  // Toda a equipe cria. Quem digita a mesma frase todo dia é quem sabe qual
  // vale salvar — exigir administrador aqui empurrava o cadastro para longe de
  // onde ele nasce. `created_by_user_id` continua registrando o autor.
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 },
    );
  }

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json({ ok: false, message: "JSON inválido." }, { status: 400 });
  }

  const parsed = quickReplyInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("chat_quick_replies")
    .insert({ ...parsed.data, created_by_user_id: auth.viewer.id })
    .select(QUICK_REPLY_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error?.code === "23505"
            ? "Esse atalho já está em uso."
            : "Não foi possível criar a resposta rápida.",
      },
      { status: error?.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, item: data, message: "Resposta rápida criada." });
}
