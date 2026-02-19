"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Login.module.css";
import { authAction, type LoginState } from "./actions";

export default function LoginPage() {
  const router = useRouter();

  const supabase = useMemo(() => supabaseBrowser(), []);

  const [mode, setMode] = useState<"login" | "register">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [state, formAction, isPending] = useActionState<LoginState, FormData>(authAction, { message: null });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/today");
    });
  }, [router, supabase]);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <h1 className={styles.title}>Calorie Tracker</h1>

        <div className={styles.card}>
          <div className={styles.modeRow}>
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`${styles.modeBtn} ${mode === "login" ? styles.modeBtnActive : ""}`}
              disabled={isPending}
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => setMode("register")}
              className={`${styles.modeBtn} ${mode === "register" ? styles.modeBtnActive : ""}`}
              disabled={isPending}
            >
              Register
            </button>
          </div>

          <form action={formAction} className={styles.form}>
            <input type="hidden" name="mode" value={mode} />

            {mode === "register" && (
              <input
                className={styles.input}
                name="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name (e.g. Viktor)"
                required
                disabled={isPending}
              />
            )}

            <input
              className={styles.input}
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              required
              autoComplete="email"
              disabled={isPending}
            />

            <input
              className={styles.input}
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 chars)"
              type="password"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={isPending}
            />

            <button className={styles.submit} disabled={isPending}>
              {isPending ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
            </button>

            {state.message ? <p className={styles.msg}>{state.message}</p> : null}
          </form>
        </div>

        <p className={styles.help}>
          After login: go to <b>Group</b> to create a group + invite friends.
        </p>
      </div>
    </main>
  );
}
