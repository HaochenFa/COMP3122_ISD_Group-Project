import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { accountType } = await requireVerifiedUser();
  redirect(accountType === "teacher" ? "/teacher/dashboard" : "/student/dashboard");
}
