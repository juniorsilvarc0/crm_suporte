import {
  authorizeIntegration,
  ok,
} from "@/features/integrations/lib/authorize-integration";
import { getTags } from "@/features/leads/queries/get-tags";

export const runtime = "nodejs";

// GET /api/integracao/tags — lista as tags disponíveis.
export async function GET(request: Request) {
  const auth = await authorizeIntegration(request);
  if (auth.error) return auth.error;

  const tags = await getTags();
  return ok({ tags });
}
