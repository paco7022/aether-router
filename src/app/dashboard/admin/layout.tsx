import { redirect } from "next/navigation";
import { getAdminRole } from "@/lib/admin-role";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Admins get the full panel; mods (gifted moderators on the `mod` plan) get a
  // scoped slice. Anyone else is bounced. The per-action scoping lives in the
  // /api/v1/admin route — this only controls who may load the page.
  const identity = await getAdminRole();
  if (!identity) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
