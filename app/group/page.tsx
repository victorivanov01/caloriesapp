"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";

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
  .upsert(
    { user_id: meId, group_code: code, display_name: name },
    { onConflict: "user_id" }
  );


      if (error) throw error;

      setMsg("Saved. Share the same Group Code with your friends.");
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui" }}>
      <Nav />
      <div style={{ maxWidth: 700, margin: "24px auto", padding: 16 }}>
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>Group</h1>

        <p style={{ color: "#555" }}>
          Simple mode: everyone who uses the same <b>Group Code</b> can see each other’s logs.
        </p>

        <div style={{ display: "grid", gap: 10, maxWidth: 420, marginTop: 12 }}>
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ padding: 10, width: "100%" }} />
          </label>

          <label>
            Group Code (share this with friends)
            <input value={groupCode} onChange={(e) => setGroupCode(e.target.value)} style={{ padding: 10, width: "100%" }} />
          </label>

          <button onClick={save} disabled={loading} style={{ padding: 10, cursor: "pointer" }}>
            {loading ? "Saving..." : "Save"}
          </button>

          {msg && <p style={{ color: msg.startsWith("Saved") ? "green" : "crimson" }}>{msg}</p>}
        </div>
      </div>
    </main>
  );
}
