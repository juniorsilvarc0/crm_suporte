import { handleN8nWebhook } from "@/features/integrations/lib/handle-n8n-webhook";
import type { Json } from "@/lib/supabase/types";

export function POST(request: Request) {
  return handleN8nWebhook<Json>(request, {
    action: "event",
    run: async (supabase, data) => data,
  });
}
