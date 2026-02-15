"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";

type Member = {
  user_id: string;
  display_name: string | null;
  group_code?: string | null;
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

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        window.location.href = "/login";
        return;
      }

      const uid = data.user.id;
      setMeId(uid);

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("display_name, group_code")
        .eq("user_id", uid)
        .single();

      if (!error && prof) {
        setDisplayName(prof.display_name || "");
        setGroupCode(prof.group_code || "");
        // default selection includes me
        setSelectedIds((prev) => (prev.length ? prev : [uid]));
        // load group members (includes you)
        await loadMembers(prof.group_code || "", uid, prof.display_name || "");
      } else {
        // no profile row yet: still show/select me
        setSelectedIds((prev) => (prev.length ? prev : [uid]));
        await loadMembers("", uid, "");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function loadMembers(code: string, uid: string, myName: string) {
    setLoadingMembers(true);
    try {
      const trimmed = (code || "").trim();

      // If no code yet, show just you
      if (!trimmed) {
        setMembers([
          {
            user_id: uid,
            display_name: myName ? `${myName} (you)` : "You",
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

      const list = (data ?? []) as Member[];

      // Guarantee you appear even if something is delayed
      const hasMe = list.some((m) => m.user_id === uid);
      const ensured = hasMe
        ? list
        : [
            ...list,
            { user_id: uid, display_name: myName || "You", group_code: trimmed },
          ];

      // Label you and put you first
      const normalized = ensured.map((m) =>
        m.user_id === uid
          ? {
              ...m,
              display_name: (myName || m.display_name || "").trim()
                ? `${(myName || m.display_name || "").trim()} (you)`
                : "You",
            }
          : { ...m, display_name: m.display_name || "(no name)" }
      );

      normalized.sort((a, b) => {
        if (a.user_id === uid) return -1;
        if (b.user_id === uid) return 1;
        return (a.display_name || "").localeCompare(b.display_name || "");
      });

      setMembers(normalized);

      // Ensure you can be selected too
      setSelectedIds((prev) => {
        const set = new Set(prev);
        set.add(uid);
        return Array.from(set);
      });
    } catch (e: any) {
      setMsg(e?.message ?? "Error loading members");
    } finally {
      setLoadingMembers(false);
    }
  }

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

      // reload members after saving
      await loadMembers(code, meId, name);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  }

  function selectAll() {
    setSelectedIds(members.map((m) => m.user_id));
  }

  function clearAll() {
    setSelectedIds([]);
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

          <button
            onClick={save}
            disabled={loading}
            style={{ padding: 10, cursor: "pointer" }}
          >
            {loading ? "Saving..." : "Save"}
          </button>

          {msg && (
            <p style={{ color: msg.startsWith("Saved") ? "green" : "crimson" }}>
              {msg}
            </p>
          )}
        </div>

        <hr style={{ margin: "18px 0" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>People in your group</h2>

          <button
            onClick={selectAll}
            disabled={members.length === 0}
            style={{ padding: "6px 10px", cursor: "pointer" }}
          >
            Select all
          </button>

          <button
            onClick={clearAll}
            disabled={selectedIds.length === 0}
            style={{ padding: "6px 10px", cursor: "pointer" }}
          >
            Clear
          </button>
        </div>

        <p style={{ color: "#666", marginTop: 8 }}>
          You can select yourself too.
        </p>

        {loadingMembers ? (
          <p>Loading…</p>
        ) : members.length === 0 ? (
          <p style={{ color: "#666" }}>No people found yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, marginTop: 10, maxWidth: 520 }}>
            {members.map((m) => {
              const checked = selectedIds.includes(m.user_id);
              return (
                <li
                  key={m.user_id}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(m.user_id)}
                    />
                    <span style={{ fontWeight: 600 }}>{m.display_name || "(no name)"}</span>
                  </label>

                  <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>
                    {m.user_id}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
