import Link from "next/link";
import { redirect } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import OpenPracticeChatPanel from "@/app/classes/[classId]/chat/OpenPracticeChatPanel";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OpenPracticeChatPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,title,subject,level,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";
  const isMember = isTeacher || Boolean(enrollment);

  if (!isMember) {
    redirect(`/dashboard`);
  }

  const { data: publishedBlueprint } = await supabase
    .from("blueprints")
    .select("id,version")
    .eq("class_id", classId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId: classRow.id, isTeacher }}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: classRow.title, href: `/classes/${classRow.id}` },
          { label: "Open Practice Chat" },
        ]}
      />
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-400">Student Hub</p>
          <h1 className="text-3xl font-semibold">Open Practice Chat</h1>
          <p className="text-sm text-slate-400">
            {classRow.title} · {classRow.subject || "STEM"} · {classRow.level || "Mixed level"}
          </p>
        </header>

        {!publishedBlueprint ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-8">
            <h2 className="text-xl font-semibold">Published blueprint required</h2>
            <p className="mt-3 text-sm text-slate-400">
              Open practice chat is available once your teacher publishes the class blueprint.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/classes/${classId}`}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-white/30 hover:bg-white/5"
              >
                Back to class
              </Link>
              {isTeacher ? (
                <Link
                  href={`/classes/${classId}/blueprint`}
                  className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
                >
                  Open blueprint studio
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <OpenPracticeChatPanel classId={classId} />
        )}
      </div>
    </div>
  );
}
