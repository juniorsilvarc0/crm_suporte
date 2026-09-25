import { leadWebhookSchema } from "@/features/leads/schemas/webhook";
import { upsertLeadFromWebhook } from "@/features/leads/queries/webhook-mutations";
import { handleN8nWebhook } from "@/features/integrations/lib/handle-n8n-webhook";

export function POST(request: Request) {
  return handleN8nWebhook(request, {
    action: "lead",
    schema: leadWebhookSchema,
    run: async (supabase, data) => {
      const lead = await upsertLeadFromWebhook(supabase, data);
      return { leadId: lead.id };
    },
  });
}
