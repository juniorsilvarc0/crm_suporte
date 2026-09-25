import { CreateUserDialog } from "@/features/settings/components/create-user-dialog";
import { UsersTable } from "@/features/settings/components/users-table";
import { getAppUsers } from "@/features/settings/queries/get-app-users";
import { requireAdminPage } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export default async function EquipePage() {
  const viewer = await requireAdminPage();
  const users = await getAppUsers();

  return (
    <main className="mx-auto w-full max-w-screen-xl p-4 sm:p-6 lg:p-8">
      <UsersTable users={users} currentUserId={viewer.id} actions={<CreateUserDialog />} />
    </main>
  );
}
