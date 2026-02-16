"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Group.module.css";

export default function GroupPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [meId, setMeId] = useState<string | null>(null);
  const [groupCode, setGroupCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        window.location.href = "/login";
        return;
      }

      setMeId(data.user.id);

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("display_name, group_code")
        .eq("user_id", data.user.id)
        .single();

      if (!error && prof) {
        setDisplayName(prof.display_name || "");
        setGroupCode(prof.group_code || "");
      }
    });
  }, [supabase]);

  async function save() {
    if (!meId) return;

    setMsg(null);
    setLoading(true);

    try {
      const code = groupCode.trim();
      const name = displayName.trim();

      const { error } = await supabase
        .from("profiles")
        .upsert({ user_id: meId, group_code: code, display_name: name }, { onConflict: "user_id" });

      if (error) throw error;

      setMsg("Saved. Share the same Group Code with your friends.");
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  const isOk = msg?.startsWith("Saved");

  return (
    <main className={styles.page}>
      <Nav />

      <div className={styles.container}>
        <h1 className={styles.title}>Group</h1>

        <p className={styles.subtitle}>
          Simple mode: everyone who uses the same <b>Group Code</b> can see each other’s logs.
        </p>

        <div className={styles.card}>
          <div className={styles.form}>
            <label className={styles.field}>
              Display name
              <input className={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>

            <label className={styles.field}>
              Group Code (share this with friends)
              <input className={styles.input} value={groupCode} onChange={(e) => setGroupCode(e.target.value)} />
            </label>

            <button className={styles.button} onClick={save} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </button>

            {msg ? <p className={isOk ? styles.msgOk : styles.msgErr}>{msg}</p> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
