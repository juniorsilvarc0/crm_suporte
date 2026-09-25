import { appointmentWebhookSchema } from "@/features/appointments/schemas/webhook";
import { upsertAppointmentFromWebhook } from "@/features/appointments/queries/webhook-mutations";
import { findLeadByPhone } from "@/features/leads/queries/webhook-mutations";
import { handleN8nWebhook } from "@/features/integrations/lib/handle-n8n-webhook";

export function POST(request: Request) {
  return handleN8nWebhook(request, {
    action: "appointment",
    schema: appointmentWebhookSchema,
    run: async (supabase, data) => {
      const lead = await findLeadByPhone(supabase, data.phone);
      const appointment = await upsertAppointmentFromWebhook(supabase, {
        ...data,
        leadId: lead?.id,
      });
      return { appointmentId: appointment.id };
    },
  });
}
