import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, plans(name)")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen">
      <Sidebar
        user={{
          email: user.email || "",
          displayName: profile?.display_name || "",
          credits: profile?.credits || 0,
          dailyCredits: profile?.daily_credits || 0,
          planName: (profile?.plans as { name: string } | null)?.name,
        }}
      />
      <main className="flex-1 p-6 lg:p-8 ml-64">{children}</main>
    </div>
  );
}
