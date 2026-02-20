"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/today");
    });
  }, [router, supabase.auth]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/today");
        return;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });

      if (error) throw error;

      const session = (await supabase.auth.getSession()).data.session;
      if (session) router.replace("/today");
      else setMsg("Registered. Check your email to confirm (if confirmations are enabled).");
    } catch (err: any) {
      setMsg(err?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

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
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => setMode("register")}
              className={`${styles.modeBtn} ${mode === "register" ? styles.modeBtnActive : ""}`}
            >
              Register
            </button>
          </div>

          <form onSubmit={onSubmit} className={styles.form}>
            {mode === "register" && (
              <input
                className={styles.input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name (e.g. Viktor)"
                required
              />
            )}

            <input
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              required
              autoComplete="email"
            />

            <input
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 chars)"
              type="password"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />

            <button className={styles.submit} disabled={loading}>
              {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
            </button>

            {msg ? <p className={styles.msg}>{msg}</p> : null}
          </form>
        </div>

        <p className={styles.help}>
          After login: go to <b>Group</b> to create a group + invite friends.
        </p>
      </div>
    </main>
  );
}
