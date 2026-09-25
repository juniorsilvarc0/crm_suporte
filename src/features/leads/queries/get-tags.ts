import type { Tag } from "@/features/leads/types";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

export async function getTags(): Promise<Tag[]> {
  if (!hasSupabaseServerEnv()) {
    return [];
  }

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("getTags failed", error.message);
      return [];
    }

    return data ?? [];
  } catch (error) {
    console.error("getTags threw", error);
    return [];
  }
}
