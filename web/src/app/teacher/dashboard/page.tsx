import Link from "next/link";
import AuthHeader from "@/app/components/AuthHeader";
import { requireVerifiedUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function TeacherDashboardPage() {
  const { supabase, user } = await requireVerifiedUser({ accountType: "teacher" });

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
      <AuthHeader activeNav="dashboard" accountType="teacher" />
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-16">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-slate-400">Teacher Dashboard</p>
            <h1 className="text-3xl font-semibold">Welcome, {user.email}</h1>
            <p className="text-sm text-slate-400">
              Manage classes, materials, and assignment workflows.
            </p>
          </div>
          <Link
            href="/classes/new"
            className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Create class
          </Link>
        </header>

        <section>
          <h2 className="text-lg font-semibold">Your teaching classes</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {classes && classes.length > 0 ? (
              classes.map((classItem) => {
                const enrollmentRole = enrollmentMap.get(classItem.id);
                const role =
                  classItem.owner_id === user.id
                    ? "Teacher"
                    : enrollmentRole === "teacher"
                      ? "Teacher"
                      : enrollmentRole === "ta"
                        ? "TA"
                        : null;
                if (!role) {
                  return null;
                }

                return (
                  <div
                    key={classItem.id}
                    className="ui-motion-lift group rounded-3xl border border-white/10 bg-slate-900/60 p-6 hover:-translate-y-0.5 hover:border-cyan-400/40"
                  >
                    <p className="text-xs font-medium text-slate-400">{role}</p>
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
                        href={`/classes/${classItem.id}/activities/chat/new`}
                        className="rounded-full border border-cyan-400/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-400/10"
                      >
                        New chat assignment
                      </Link>
                      <Link
                        href={`/classes/${classItem.id}/activities/quiz/new`}
                        className="rounded-full border border-cyan-400/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-400/10"
                      >
                        New quiz draft
                      </Link>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/40 p-6 text-sm text-slate-400">
                No classes yet. Create one to get started.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
