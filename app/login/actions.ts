"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export type LoginState = { message: string | null };

export async function authAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const mode = String(formData.get("mode") ?? "login");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (!email || !password) return { message: "Email and password are required." };
  if (password.length < 6) return { message: "Password must be at least 6 characters." };

  const supabase = await supabaseServer();

  if (mode === "register") {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || undefined } },
    });

    if (error) return { message: error.message };
    redirect("/today");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { message: error.message };

  redirect("/today");
}