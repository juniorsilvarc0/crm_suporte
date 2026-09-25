import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const FEEDBACK_BUCKET = "feedback-screenshots";
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const allowedImageTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export async function POST(request: Request) {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Envie os dados como multipart/form-data." },
      { status: 400 }
    );
  }

  const caption = String(formData.get("caption") ?? "").trim();
  const image = formData.get("image");

  if (!caption) {
    return NextResponse.json(
      {
        ok: false,
        message: "Descreva o ajuste antes de enviar.",
        errors: { caption: ["Descreva o ajuste antes de enviar."] },
      },
      { status: 400 }
    );
  }

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json(
      {
        ok: false,
        message: "Anexe um print ou imagem.",
        errors: { image: ["Anexe um print ou imagem."] },
      },
      { status: 400 }
    );
  }

  const extension = allowedImageTypes.get(image.type);

  if (!extension) {
    return NextResponse.json(
      {
        ok: false,
        message: "Use uma imagem PNG, JPG ou WebP.",
        errors: { image: ["Use uma imagem PNG, JPG ou WebP."] },
      },
      { status: 400 }
    );
  }

  if (image.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        message: "A imagem deve ter no máximo 10 MB.",
        errors: { image: ["A imagem deve ter no máximo 10 MB."] },
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const imagePath = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(FEEDBACK_BUCKET)
    .upload(imagePath, image, {
      contentType: image.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ ok: false, message: uploadError.message }, { status: 500 });
  }

  const { data: feedback, error: insertError } = await supabase
    .from("feedback_requests")
    .insert({
      caption,
      image_url: imagePath,
      author_name: "Marcelo",
    })
    .select("id")
    .single();

  if (insertError) {
    await supabase.storage.from(FEEDBACK_BUCKET).remove([imagePath]);

    return NextResponse.json({ ok: false, message: insertError.message }, { status: 500 });
  }

  revalidatePath("/app/feedbacks");

  return NextResponse.json({ ok: true, message: "Feedback enviado.", id: feedback.id });
}
