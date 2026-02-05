import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("requesting_user_id");

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code, details: error.details },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, requestingUserId: data });
}
