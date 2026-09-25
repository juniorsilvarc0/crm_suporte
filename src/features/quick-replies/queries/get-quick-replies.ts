import type { QuickReply } from "@/features/quick-replies/types";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

const QUICK_REPLY_COLUMNS =
  "id, title, shortcut, content, is_active, created_by_user_id, created_at, updated_at";

export async function getQuickReplies(options: { activeOnly?: boolean } = {}): Promise<QuickReply[]> {
  if (!hasSupabaseAdminEnv()) return [];

  try {
    const supabase = createSupabaseAdminClient();
    let query = supabase
      .from("chat_quick_replies")
      .select(QUICK_REPLY_COLUMNS)
      .order("title", { ascending: true });

    if (options.activeOnly) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) {
      console.error("getQuickReplies failed", error.message);
      return [];
    }
    return data ?? [];
  } catch (error) {
    console.error("getQuickReplies threw", error);
    return [];
  }
}
