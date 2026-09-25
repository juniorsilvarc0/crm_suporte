import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({ tag_id: z.string().regex(UUID_RE, "Etiqueta inválida.") });

/**
 * Vincula e desvincula etiqueta de uma conversa.
 *
 * Espelha `/api/leads/[id]/tags` de propósito: é a mesma tabela `tags` na outra
 * ponta, e duas validações diferentes para o mesmo vínculo divergiriam.
 *
 * Não chama `revalidatePath` como a rota dos leads: o chat não é renderizado no
 * servidor — a lista vive no cliente e atualiza o próprio estado. Revalidar aqui
 * derrubaria o cache de `/app/leads` a cada etiqueta posta no chat, sem ninguém
 * para aproveitar.
 */
async function readTagId(request: Request) {
  const body = await readJsonBody(request);
  if (body.error) return { error: "JSON inválido." as const };
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return { error: "Etiqueta inválida." as const };
  return { tagId: parsed.data.tag_id };
}

function guard(id: string) {
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: "Conversa inválida." }, { status: 400 });
  }
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ ok: false, message: "Supabase não configurado." }, { status: 500 });
  }
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = guard(id);
  if (blocked) return blocked;

  const parsed = await readTagId(request);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, message: parsed.error }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  // `upsert` e não `insert`: etiquetar duas vezes é toque repetido, não erro —
  // devolver 409 aqui faria a interface acusar falha de um estado já correto.
  const { error } = await supabase
    .from("conversation_tags")
    .upsert(
      { conversation_id: id, tag_id: parsed.tagId },
      { onConflict: "conversation_id,tag_id" }
    );

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = guard(id);
  if (blocked) return blocked;

  const parsed = await readTagId(request);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, message: parsed.error }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("conversation_tags")
    .delete()
    .eq("conversation_id", id)
    .eq("tag_id", parsed.tagId);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
