import type { Database } from "@/lib/supabase/types";

export type QuickReply = Database["public"]["Tables"]["chat_quick_replies"]["Row"];
