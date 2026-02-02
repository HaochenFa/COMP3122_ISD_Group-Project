"use server";

import { redirect } from "next/navigation";
import { generateJoinCode } from "@/lib/join-code";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

const MAX_JOIN_CODE_ATTEMPTS = 5;

export async function createClass(formData: FormData) {
  const title = getFormValue(formData, "title");
  const description = getFormValue(formData, "description");
  const subject = getFormValue(formData, "subject");
  const level = getFormValue(formData, "level");

  if (!title) {
    redirect("/classes/new?error=Class title is required");
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let newClassId: string | null = null;

  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const joinCode = generateJoinCode();
    const { data, error } = await supabase
      .from("classes")
      .insert({
        owner_id: user.id,
        title,
        description,
        subject,
        level,
        join_code: joinCode,
      })
      .select("id")
      .single();

    if (!error && data) {
      newClassId = data.id;
      break;
    }

    if (error?.code !== "23505") {
      redirect(`/classes/new?error=${encodeURIComponent(error.message)}`);
    }
  }

  if (!newClassId) {
    redirect("/classes/new?error=Unable to generate a join code");
  }

  const { error: enrollmentError } = await supabase
    .from("enrollments")
    .insert({
      class_id: newClassId,
      user_id: user.id,
      role: "teacher",
    });

  if (enrollmentError) {
    redirect(`/classes/new?error=${encodeURIComponent(enrollmentError.message)}`);
  }

  redirect(`/classes/${newClassId}`);
}

export async function joinClass(formData: FormData) {
  const joinCode = getFormValue(formData, "join_code").toUpperCase();

  if (!joinCode) {
    redirect("/join?error=Join code is required");
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    redirect("/join?error=Server configuration error");
  }
  const { data: classRow, error } = await admin
    .from("classes")
    .select("id")
    .eq("join_code", joinCode)
    .single();

  if (error || !classRow) {
    redirect("/join?error=Invalid join code");
  }

  const { error: enrollmentError } = await admin
    .from("enrollments")
    .upsert(
      {
        class_id: classRow.id,
        user_id: user.id,
        role: "student",
      },
      { onConflict: "class_id,user_id", ignoreDuplicates: true }
    );

  if (enrollmentError) {
    redirect(`/join?error=${encodeURIComponent(enrollmentError.message)}`);
  }

  redirect(`/classes/${classRow.id}`);
}
