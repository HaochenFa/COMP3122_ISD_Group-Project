import Link from "next/link";
import { signOut } from "@/app/actions";
import type { AccountType } from "@/lib/auth/session";

type Breadcrumb = {
  label: string;
  href?: string;
};

type NavKey = "dashboard" | "new-class" | "join-class";

type AuthHeaderProps = {
  breadcrumbs?: Breadcrumb[];
  activeNav?: NavKey;
  accountType?: AccountType;
  classContext?: {
    classId: string;
    isTeacher: boolean;
  };
};

function getNavClass(isActive: boolean) {
  const base = "ui-motion-color rounded-full border px-4 py-2 text-xs font-medium";
  if (isActive) {
    return `${base} border-cyan-400/50 bg-cyan-400/10 text-cyan-100`;
  }
  return `${base} border-white/10 text-slate-200 hover:border-white/30 hover:bg-white/5`;
}

export default function AuthHeader({
  breadcrumbs,
  activeNav,
  accountType,
  classContext,
}: AuthHeaderProps) {
  const resolvedAccountType =
    accountType ??
    (classContext
      ? classContext.isTeacher
        ? "teacher"
        : "student"
      : null);
  const dashboardHref =
    resolvedAccountType === "teacher"
      ? "/teacher/dashboard"
      : resolvedAccountType === "student"
        ? "/student/dashboard"
        : "/dashboard";
  const showTeacherNav = resolvedAccountType === "teacher" || classContext?.isTeacher;

  return (
    <div className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <Link
          href={dashboardHref}
          className="ui-motion-color text-sm font-medium tracking-wide text-slate-300 hover:text-slate-100"
        >
          STEM Learning Platform
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={dashboardHref}
            className={getNavClass(activeNav === "dashboard")}
            aria-current={activeNav === "dashboard" ? "page" : undefined}
          >
            Dashboard
          </Link>
          {showTeacherNav ? (
            <Link
              href="/classes/new"
              className={getNavClass(activeNav === "new-class")}
              aria-current={activeNav === "new-class" ? "page" : undefined}
            >
              New Class
            </Link>
          ) : (
            <Link
              href="/join"
              className={getNavClass(activeNav === "join-class")}
              aria-current={activeNav === "join-class" ? "page" : undefined}
            >
              Join Class
            </Link>
          )}
          {classContext ? (
            <>
              <Link
                href={`/classes/${classContext.classId}/chat`}
                className="ui-motion-color rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-slate-200 hover:border-white/30 hover:bg-white/5"
              >
                Open Chat
              </Link>
              {classContext.isTeacher ? (
                <Link
                  href={`/classes/${classContext.classId}/activities/chat/new`}
                  className="ui-motion-color rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-xs font-medium text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-400/20"
                >
                  New Chat Assignment
                </Link>
              ) : null}
            </>
          ) : null}
          <form action={signOut}>
            <button
              type="submit"
              className="ui-motion-color rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-slate-200 hover:border-white/30 hover:bg-white/5"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className="mx-auto w-full max-w-6xl px-6 pb-6">
          <nav className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              if (crumb.href && !isLast) {
                return (
                  <span key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                    <Link href={crumb.href} className="ui-motion-color hover:text-slate-300">
                      {crumb.label}
                    </Link>
                    <span className="text-slate-600">/</span>
                  </span>
                );
              }
              return (
                <span key={`${crumb.label}-${index}`} className="text-slate-300">
                  {crumb.label}
                </span>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
