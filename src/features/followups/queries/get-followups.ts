import type { Followup } from "@/features/followups/types";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export async function getFollowups(): Promise<Followup[]> {
  if (!hasSupabaseServerEnv()) return [];

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("followups")
      .select("*, leads(name, phone)")
      .order("scheduled_for", { ascending: false })
      .limit(200);

    if (error) {
      console.error("getFollowups", error.message);
      return [];
    }

    return (data ?? []) as Followup[];
  } catch (error) {
    console.error("getFollowups threw", error);
    return [];
  }
}
