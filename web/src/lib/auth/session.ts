import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AccountType = "teacher" | "student";

type ProfileRow = {
  id: string;
  account_type: AccountType | null;
};

export type AuthContext = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  user: Awaited<
    ReturnType<Awaited<ReturnType<typeof createServerSupabaseClient>>["auth"]["getUser"]>
  >["data"]["user"];
  profile: ProfileRow | null;
  isEmailVerified: boolean;
};

function loginErrorUrl(message: string) {
  return `/login?error=${encodeURIComponent(message)}`;
}

export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      supabase,
      user: null,
      profile: null,
      isEmailVerified: false,
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,account_type")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  return {
    supabase,
    user,
    profile: profile ?? null,
    isEmailVerified: Boolean(user.email_confirmed_at),
  };
}

export async function requireVerifiedUser(options?: {
  accountType?: AccountType;
  redirectPath?: string;
}) {
  const context = await getAuthContext();
  if (!context.user) {
    redirect("/login");
  }

  if (!context.isEmailVerified) {
    redirect(loginErrorUrl("Please verify your email before continuing."));
  }

  const accountType = context.profile?.account_type;
  if (!accountType) {
    redirect(loginErrorUrl("Account setup is incomplete. Please sign in again."));
  }

  if (options?.accountType && accountType !== options.accountType) {
    const fallback = accountType === "teacher" ? "/teacher/dashboard" : "/student/dashboard";
    const destination = options.redirectPath ?? fallback;
    redirect(
      `${destination}?error=${encodeURIComponent(
        `This action requires a ${options.accountType} account.`,
      )}`,
    );
  }

  return {
    ...context,
    user: context.user,
    profile: {
      id: context.user.id,
      account_type: accountType,
    },
    accountType,
    isEmailVerified: true,
  };
}
