import { NextResponse } from "next/server";

import { ticketErrorResponse } from "@/features/tickets/lib/ticket-error-response";
import { addTicketAttachment } from "@/features/tickets/server/ticket-attachment";
import { requireDashboardUser } from "@/lib/auth/require-dashboard-session";
import { TICKET_ATTACHMENT_MAX_BYTES } from "@/lib/storage/ticket-attachments";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";

const ROUTE = "[POST /api/tickets/[id]/attachments]";

// Folga do envelope multipart (boundary e cabeçalhos da parte) sobre o teto do
// arquivo, para o Content-Length recusar cedo sem barrar um arquivo de 50 MB.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const TOO_LARGE_MESSAGE = "Arquivo muito grande (máx. 50 MB).";

function fileError(message: string, status: 400 | 413) {
  return NextResponse.json({ ok: false, message, errors: { file: [message] } }, { status });
}

/**
 * Anexa um arquivo ao ticket (multipart, campo `file`, até 50 MB). A rota lê e
 * confere o arquivo; o resto (ticket → upload → INSERT, e o objeto apagado se
 * o INSERT falhar) é o addTicketAttachment, a mesma escrita da API v1, com o
 * autor da sessão. A migration não barra anexo em ticket encerrado: quem
 * precisa juntar um comprovante depois de fechar consegue.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDashboardUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, message: "Ticket inválido." }, { status: 400 });
  }

  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { ok: false, message: "Supabase admin não está configurado neste ambiente." },
      { status: 500 }
    );
  }

  // Acima de proxyClientMaxBodySize (64 MB) o proxy entrega o corpo cortado, e
  // o multipart viraria "não consegui ler": o 413 sai antes, quando dá.
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > TICKET_ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return fileError(TOO_LARGE_MESSAGE, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fileError("Envie o arquivo como multipart, no campo file.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fileError("Escolha um arquivo.", 400);
  }
  if (file.size === 0) {
    return fileError("O arquivo está vazio.", 400);
  }
  if (file.size > TICKET_ATTACHMENT_MAX_BYTES) {
    return fileError(TOO_LARGE_MESSAGE, 413);
  }

  const result = await addTicketAttachment(
    createSupabaseAdminClient(),
    { kind: "user", userId: auth.viewer.id },
    id,
    { name: file.name, type: file.type, read: async () => Buffer.from(await file.arrayBuffer()) }
  );
  if (!result.ok) {
    switch (result.reason) {
      case "read_failed":
        console.error(ROUTE, result.cause.code, result.cause.message);
        return NextResponse.json(
          { ok: false, message: "Não foi possível anexar o arquivo." },
          { status: 500 }
        );
      case "not_found":
        return NextResponse.json(
          { ok: false, code: "not_found", message: "Ticket não encontrado." },
          { status: 404 }
        );
      case "storage_failed":
        return NextResponse.json(
          { ok: false, message: "Não foi possível guardar o arquivo. Tente de novo." },
          { status: 502 }
        );
      case "insert_failed":
        return ticketErrorResponse(ROUTE, result.error, result.cause);
    }
  }

  return NextResponse.json({ ok: true, attachment: result.data }, { status: 201 });
}
