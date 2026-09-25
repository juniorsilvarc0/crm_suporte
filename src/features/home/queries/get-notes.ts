import { NOTE_COLORS, type NoteColor } from "@/features/home/schemas/note";
import type { HomeNotes, UserNote } from "@/features/home/types";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

const EMPTY: HomeNotes = { quick: { content: "", updatedAt: null }, stickies: [] };

function toColor(value: unknown): NoteColor {
  return NOTE_COLORS.includes(value as NoteColor) ? (value as NoteColor) : "amber";
}

/**
 * Notas do usuário logado. Leitura resiliente: erro loga e devolve vazio em vez
 * de derrubar a tela inteira de Início (padrão das leituras do app).
 */
export async function getNotes(userId: string): Promise<HomeNotes> {
  if (!hasSupabaseServerEnv()) return EMPTY;

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("user_notes")
      .select("id, kind, title, content, color, updated_at")
      .eq("user_id", userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(60);

    if (error) {
      console.error("getNotes", error.message);
      return EMPTY;
    }

    const rows = data ?? [];
    const quickRow = rows.find((row) => row.kind === "quick");
    const stickies: UserNote[] = rows
      .filter((row) => row.kind === "sticky")
      .map((row) => ({
        id: row.id as string,
        title: (row.title as string | null) ?? null,
        content: (row.content as string) ?? "",
        color: toColor(row.color),
        updatedAt: row.updated_at as string,
      }));

    return {
      quick: {
        content: (quickRow?.content as string | undefined) ?? "",
        updatedAt: (quickRow?.updated_at as string | undefined) ?? null,
      },
      stickies,
    };
  } catch (error) {
    console.error("getNotes", error);
    return EMPTY;
  }
}
