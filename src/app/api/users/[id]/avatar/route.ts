import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "profile-avatars";

// Confere a ASSINATURA REAL dos bytes (magic number), não o Content-Type que o
// cliente declara — que é forjável. Só png/jpeg/webp passam; qualquer outra
// coisa (SVG, HTML, um script renomeado) é rejeitada antes de ir ao bucket.
function detectImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function getAuthorizedTarget(id: string) {
  const viewer = await getDashboardViewer();
  if (!viewer) return { error: NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 }) };
  if (viewer.role !== "admin" && viewer.id !== id) {
    return { error: NextResponse.json({ ok: false, message: "Você só pode editar o próprio perfil." }, { status: 403 }) };
  }
  if (!hasSupabaseAdminEnv()) {
    return { error: NextResponse.json({ ok: false, message: "Supabase admin não está configurado." }, { status: 500 }) };
  }
  const supabase = createSupabaseAdminClient();
  const { data: target } = await supabase
    .from("app_users")
    .select("id, email, name, role, avatar_url, avatar_color, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!target) return { error: NextResponse.json({ ok: false, message: "Usuário não encontrado." }, { status: 404 }) };
  return { viewer, target, supabase };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, message: "Usuário inválido." }, { status: 400 });
  const authorized = await getAuthorizedTarget(id);
  if ("error" in authorized) return authorized.error;

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File) || !ACCEPTED_TYPES.has(image.type) || image.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, message: "Use uma imagem PNG, JPG ou WebP de até 5 MB." }, { status: 422 });
  }

  const path = `app-users/${id}/avatar`;
  const bytes = new Uint8Array(await image.arrayBuffer());
  // Não confia no Content-Type declarado: valida a assinatura real dos bytes e
  // hospeda com o tipo DETECTADO. Bloqueia SVG/HTML/script disfarçados de imagem.
  const detectedType = detectImageType(bytes);
  if (!detectedType) {
    return NextResponse.json(
      { ok: false, message: "Arquivo inválido: envie uma imagem PNG, JPG ou WebP de verdade." },
      { status: 422 }
    );
  }
  const { error: uploadError } = await authorized.supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: detectedType, upsert: true });
  if (uploadError) return NextResponse.json({ ok: false, message: "Não foi possível enviar a foto." }, { status: 500 });

  const { data } = authorized.supabase.storage.from(BUCKET).getPublicUrl(path);
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
  const { error } = await authorized.supabase.rpc("update_app_user", {
    p_actor_id: authorized.viewer.id,
    p_id: id,
    p_name: authorized.target.name,
    p_email: authorized.target.email,
    p_is_active: authorized.target.is_active,
    p_role: authorized.target.role,
    p_avatar_url: avatarUrl,
    p_avatar_color: authorized.target.avatar_color,
  });
  if (error) return NextResponse.json({ ok: false, message: "A foto foi enviada, mas o perfil não foi atualizado." }, { status: 500 });

  revalidatePath("/app/perfil");
  revalidatePath("/app/equipe");
  return NextResponse.json({ ok: true, avatarUrl });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, message: "Usuário inválido." }, { status: 400 });
  const authorized = await getAuthorizedTarget(id);
  if ("error" in authorized) return authorized.error;

  await authorized.supabase.storage.from(BUCKET).remove([`app-users/${id}/avatar`]);
  const { error } = await authorized.supabase.rpc("update_app_user", {
    p_actor_id: authorized.viewer.id,
    p_id: id,
    p_name: authorized.target.name,
    p_email: authorized.target.email,
    p_is_active: authorized.target.is_active,
    p_role: authorized.target.role,
    // `''` limpa a foto: a RPC normaliza vazio para null.
    p_avatar_url: "",
    p_avatar_color: authorized.target.avatar_color,
  });
  if (error) return NextResponse.json({ ok: false, message: "Não foi possível remover a foto." }, { status: 500 });

  revalidatePath("/app/perfil");
  revalidatePath("/app/equipe");
  return NextResponse.json({ ok: true });
}
