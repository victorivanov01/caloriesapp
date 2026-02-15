"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";

type Member = {
  user_id: string;
  display_name: string | null;
  group_code: string | null;
};

export default function GroupPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [meId, setMeId] = useState<string | null>(null);

  const [groupCode, setGroupCode] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [members, setMembers] = useState<Member[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);

  async function loadMeAndProfile(userId: string) {
    const { data: prof, error } = await supabase
      .from("profiles")
      .select("display_name, group_code")
      .eq("user_id", userId)
      .single();

    if (!error && prof) {
      const dn = prof.display_name || "";
      const gc = prof.group_code || "";

      setDisplayName(dn);
      setGroupCode(gc);

      // Default selection includes me
      setSelectedIds((prev) => (prev.length ? prev : [userId]));

      // Load members (if no group code yet, we'll still show "me")
      await loadMembers(gc, userId, dn);
    } else {
      // If profile missing, still show "me"
      setSelectedIds((prev) => (prev.length ? prev : [userId]));
      await loadMembers("", userId, "");
    }
  }

  async function loadMembers(code: string, userId: string, myDisplayName: string) {
    setLoadingMembers(true);
    try {
      const trimmed = (code || "").trim();

      // If no group code, show only me
      if (!trimmed) {
        setMembers([
          {
            user_id: userId,
            display_name: myDisplayName || null,
            group_code: null,
          },
        ]);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, group_code")
        .eq("group_code", trimmed);

      if (error) throw error;

      const list = (data || []) as Member[];

      // Guarantee "me" is present even if profile list is weird / delayed
      const hasMe = list.some((m) => m.user_id === userId);
      const ensured = hasMe
        ? list
        : [
            ...list,
            {
              user_id: userId,
              display_name: myDisplayName || null,
              group_code: trimmed,
            },
          ];

      // Sort: me first, then alphabetical
      ensured.sort((a, b) => {
        if (a.user_id === userId) return -1;
        if (b.user_id === userId) return 1;
        const an = (a.display_name || "").toLowerCase();
        const bn = (b.display_name || "").toLowerCase();
        return an.localeCompare(bn);
      });

      setMembers(ensured);

      // Ensure selection always includes me (so you can select yourself)
      setSelectedIds((prev) => {
        const set = new Set(prev);
        set.add(userId);
        return Array.from(set);
      });
    } catch (e: any) {
      setMsg(e?.message ?? "Error loading members");
    } finally {
      setLoadingMembers(false);
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        window.location.href = "/login";
        return;
      }
      setMeId(data.user.id);
      await loadMeAndProfile(data.user.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function save() {
    if (!meId) return;
    setMsg(null);
    setLoading(true);
    try {
      const code = groupCode.trim();
      const name = displayName.trim();

      const { error } = await supabase.from("profiles").upsert(
        { user_id: meId, group_code: code, display_name: name },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      setMsg("Saved. Share the same Group Code with your friends.");

      // Refresh members after saving changes
      await loadMembers(code, meId, name);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelected(userId: string) {
    setSelectedIds((prev) => {
      const set = new Set(prev);
      if (set.has(userId)) set.delete(userId);
      else set.add(userId);
      return Array.from(set);
    });
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
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{ padding: 10, width: "100%" }}
            />
          </label>

          <label>
            Group Code (share this with friends)
            <input
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              style={{ padding: 10, width: "100%" }}
            />
          </label>

          <button onClick={save} disabled={loading} style={{ padding: 10, cursor: "pointer" }}>
            {loading ? "Saving..." : "Save"}
          </button>

          {msg && <p style={{ color: msg.startsWith("Saved") ? "green" : "crimson" }}>{msg}</p>}
        </div>

        <hr style={{ margin: "18px 0" }} />

        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Members in this Group</h2>
        <p style={{ color: "#666", marginTop: 0 }}>
          Select who you want to include (you can select yourself too).
        </p>

        {loadingMembers ? (
          <p>Loading members...</p>
        ) : members.length === 0 ? (
          <p style={{ color: "#666" }}>No members found yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
            {members.map((m) => {
              const isMe = m.user_id === meId;
              const label = (m.display_name || "").trim() || (isMe ? "You" : "Unnamed");
              const checked = selectedIds.includes(m.user_id);

              return (
                <label
                  key={m.user_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    border: "1px solid #ddd",
                    borderRadius: 10,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelected(m.user_id)}
                  />
                  <div style={{ display: "grid" }}>
                    <span style={{ fontWeight: 600 }}>
                      {label} {isMe ? "(you)" : ""}
                    </span>
                    <span style={{ fontSize: 12, color: "#666" }}>
                      {m.user_id}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {/* If you want to use the selection elsewhere, it's in selectedIds */}
        {selectedIds.length > 0 && (
          <p style={{ marginTop: 12, color: "#555" }}>
            Selected: <b>{selectedIds.length}</b>
          </p>
        )}
      </div>
    </main>
  );
}
