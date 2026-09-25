import { redirect } from "next/navigation";

import { ProfileEditor } from "@/features/settings/components/profile-editor";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/login");
  return <ProfileEditor user={viewer} />;
}
