import Link from "next/link";
import AuthHeader from "@/app/components/AuthHeader";
import { requireVerifiedUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function StudentDashboardPage() {
  const { supabase, user } = await requireVerifiedUser({ accountType: "student" });

  const { data: classes } = await supabase
    .from("classes")
    .select("id,title,subject,level,owner_id")
    .order("created_at", { ascending: false });

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_id,role")
    .eq("user_id", user.id);

  const enrollmentMap = new Map(
    enrollments?.map((enrollment) => [enrollment.class_id, enrollment.role]) ?? [],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader activeNav="dashboard" accountType="student" />
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-16">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-slate-400">Student Dashboard</p>
            <h1 className="text-3xl font-semibold">Welcome, {user.email}</h1>
            <p className="text-sm text-slate-400">
              Join classes and complete your assignments in one place.
            </p>
          </div>
          <Link
            href="/join"
            className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Join class
          </Link>
        </header>

        <section>
          <h2 className="text-lg font-semibold">Your enrolled classes</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {classes && classes.length > 0 ? (
              classes.map((classItem) => {
                const role = enrollmentMap.get(classItem.id);
                if (role !== "student") {
                  return null;
                }

                return (
                  <div
                    key={classItem.id}
                    className="ui-motion-lift group rounded-3xl border border-white/10 bg-slate-900/60 p-6 hover:-translate-y-0.5 hover:border-cyan-400/40"
                  >
                    <p className="text-xs font-medium text-slate-400">Student</p>
                    <Link href={`/classes/${classItem.id}`} className="mt-2 block">
                      <h3 className="text-xl font-semibold group-hover:text-cyan-200">
                        {classItem.title}
                      </h3>
                    </Link>
                    <p className="mt-2 text-sm text-slate-400">
                      {classItem.subject || "STEM"} · {classItem.level || "Mixed"}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/classes/${classItem.id}`}
                        className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:border-white/30 hover:bg-white/5"
                      >
                        Open class
                      </Link>
                      <Link
                        href={`/classes/${classItem.id}/chat`}
                        className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:border-white/30 hover:bg-white/5"
                      >
                        Open chat
                      </Link>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/40 p-6 text-sm text-slate-400">
                No classes joined yet. Use a join code from your teacher.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
