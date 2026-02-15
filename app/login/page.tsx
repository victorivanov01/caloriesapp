"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";

function normalizeUsername(raw: string) {
  // Lowercase, trim, only allow a-z 0-9 underscore, 3..24 chars
  const u = raw.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(u)) {
    return null;
  }
  return u;
}

function usernameToEmail(username: string) {
  // Internal-only fake email
  return `${username}@calories.local`;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/today");
    });
  }, [router, supabase]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const u = normalizeUsername(username);
      if (!u) {
        throw new Error("Username must be 3-24 chars: letters, numbers, underscore only.");
      }
      if (password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }

      const email = usernameToEmail(u);

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/today");
        return;
      }

      // register
      const dn = displayName.trim() || u;

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: dn } },
      });

      if (error) throw error;

      // If confirmations are OFF, session may exist immediately
      const session = (await supabase.auth.getSession()).data.session;
      if (session) {
        router.replace("/today");
      } else {
        setMsg("Account created. If email confirmation is enabled, you must confirm before logging in.");
      }
    } catch (err: any) {
      setMsg(err?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>Calorie Tracker</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setMode("login")}
          style={{ padding: "8px 12px", cursor: "pointer", opacity: mode === "login" ? 1 : 0.6 }}
        >
          Login
        </button>
        <button
          onClick={() => setMode("register")}
          style={{ padding: "8px 12px", cursor: "pointer", opacity: mode === "register" ? 1 : 0.6 }}
        >
          Register
        </button>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        {mode === "register" && (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            style={{ padding: 10 }}
          />
        )}

        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username (letters/numbers/_ , 3-24)"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          style={{ padding: 10 }}
        />

        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 6 chars)"
          type="password"
          required
          style={{ padding: 10 }}
        />

        <button disabled={loading} style={{ padding: 10, cursor: "pointer" }}>
          {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>

        {msg && <p style={{ color: "crimson" }}>{msg}</p>}
      </form>

      <p style={{ marginTop: 16, color: "#444" }}>
        After login: go to <b>Group</b> to set a Group Code and share it with friends.
      </p>
    </main>
  );
}
