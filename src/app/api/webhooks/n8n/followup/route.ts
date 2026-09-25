import { followupWebhookSchema } from "@/features/followups/schemas/webhook";
import { createFollowupFromWebhook } from "@/features/followups/queries/webhook-mutations";
import { findLeadByPhone } from "@/features/leads/queries/webhook-mutations";
import { handleN8nWebhook } from "@/features/integrations/lib/handle-n8n-webhook";

export function POST(request: Request) {
  return handleN8nWebhook(request, {
    action: "followup",
    schema: followupWebhookSchema,
    run: async (supabase, data) => {
      const lead = await findLeadByPhone(supabase, data.phone);
      const followup = await createFollowupFromWebhook(supabase, {
        ...data,
        leadId: lead?.id,
      });
      return { followupId: followup.id };
    },
  });
}
