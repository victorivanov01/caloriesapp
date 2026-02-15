"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Friends.module.css";

type Friend = { user_id: string; display_name: string };

type Entry = {
  id: string;
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meal: string;
  created_at: string;
};

type EntryRow = Entry & {
  friend_id: string;
  friend_name: string;
};

type Totals = { calories: number; protein: number; carbs: number; fat: number };

function emptyTotals(): Totals {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

function addTotals(a: Totals, b: Totals): Totals {
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
}

function totalsFromEntries(list: Entry[]): Totals {
  return {
    calories: list.reduce((sum, x) => sum + (x.calories ?? 0), 0),
    protein: list.reduce((sum, x) => sum + (x.protein_g ?? 0), 0),
    carbs: list.reduce((sum, x) => sum + (x.carbs_g ?? 0), 0),
    fat: list.reduce((sum, x) => sum + (x.fat_g ?? 0), 0),
  };
}

export default function FriendsPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [meId, setMeId] = useState<string | null>(null);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);

  const [dateStr, setDateStr] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [rows, setRows] = useState<EntryRow[]>([]);
  const [totalsByFriend, setTotalsByFriend] = useState<Record<string, Totals>>({});
  const [grandTotals, setGrandTotals] = useState<Totals>(emptyTotals());

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) window.location.href = "/login";
      else setMeId(data.user.id);
    });
  }, [supabase]);

  useEffect(() => {
    if (!meId) return;
    loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  useEffect(() => {
    if (selectedFriendIds.length === 0) {
      setRows([]);
      setTotalsByFriend({});
      setGrandTotals(emptyTotals());
      return;
    }
    loadSelectedFriendsDay(selectedFriendIds, dateStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFriendIds, dateStr]);

  async function loadFriends() {
    setMsg(null);
    setLoading(true);
    try {
      const { data: myProf, error: myErr } = await supabase
        .from("profiles")
        .select("group_code, display_name")
        .eq("user_id", meId!)
        .maybeSingle();

      if (myErr) throw myErr;

      if (!myProf) {
        setFriends([]);
        setSelectedFriendIds([]);
        setMsg("No profile row found for your user. Go to Group page and click Save once.");
        return;
      }

      const code = (myProf.group_code ?? "").trim();
      if (!code) {
        setFriends([]);
        setSelectedFriendIds([]);
        setMsg("Set a Group Code in the Group page first.");
        return;
      }

      // ✅ INCLUDE ME: removed .neq("user_id", meId!)
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .eq("group_code", code);

      if (pErr) throw pErr;

      const list: Friend[] = (profs ?? [])
        .map((p: any) => ({
          user_id: p.user_id,
          display_name: p.display_name || "(no name)",
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name));

      // ✅ Optional: make your row show as "You" while keeping other names intact
      const myName = (myProf.display_name ?? "").trim();
      const listWithYou = list.map((f) =>
        f.user_id === meId
          ? {
              ...f,
              display_name: myName ? `${myName} (you)` : "You",
            }
          : f
      );

      // ✅ Optional: put you at the top
      listWithYou.sort((a, b) => {
        if (a.user_id === meId) return -1;
        if (b.user_id === meId) return 1;
        return a.display_name.localeCompare(b.display_name);
      });

      setFriends(listWithYou);

      // Keep selections that still exist
      const valid = new Set(listWithYou.map((f) => f.user_id));
      const kept = selectedFriendIds.filter((id) => valid.has(id));

      if (kept.length > 0) {
        setSelectedFriendIds(kept);
      } else {
        // default selection: you (if present) else first in list
        const you = listWithYou.find((f) => f.user_id === meId);
        setSelectedFriendIds(you ? [you.user_id] : listWithYou[0] ? [listWithYou[0].user_id] : []);
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedFriendsDay(friendIds: string[], yyyyMmDd: string) {
    setMsg(null);
    setLoading(true);
    try {
      const { data: logs, error: logsErr } = await supabase
        .from("daily_logs")
        .select("id, user_id")
        .in("user_id", friendIds)
        .eq("log_date", yyyyMmDd);

      if (logsErr) throw logsErr;

      const logsList = logs ?? [];
      if (logsList.length === 0) {
        setRows([]);
        setTotalsByFriend({});
        setGrandTotals(emptyTotals());
        return;
      }

      const logIdToUserId = new Map<string, string>();
      const logIds: string[] = [];
      for (const l of logsList as any[]) {
        if (l?.id && l?.user_id) {
          logIdToUserId.set(l.id, l.user_id);
          logIds.push(l.id);
        }
      }

      if (logIds.length === 0) {
        setRows([]);
        setTotalsByFriend({});
        setGrandTotals(emptyTotals());
        return;
      }

      const { data: ents, error: eErr } = await supabase
        .from("food_entries")
        .select("id, name, calories, protein_g, carbs_g, fat_g, meal, created_at, daily_log_id")
        .in("daily_log_id", logIds)
        .order("created_at", { ascending: true });

      if (eErr) throw eErr;

      const friendNameById = new Map(friends.map((f) => [f.user_id, f.display_name] as const));

      const flat: EntryRow[] = (ents ?? []).map((x: any) => {
        const fid = logIdToUserId.get(x.daily_log_id) ?? "";
        return {
          id: x.id,
          name: x.name,
          calories: x.calories ?? 0,
          protein_g: x.protein_g ?? 0,
          carbs_g: x.carbs_g ?? 0,
          fat_g: x.fat_g ?? 0,
          meal: x.meal ?? "",
          created_at: x.created_at,
          friend_id: fid,
          friend_name: friendNameById.get(fid) ?? "(unknown)",
        };
      });

      const byFriend: Record<string, Entry[]> = {};
      for (const r of flat) {
        if (!r.friend_id) continue;
        if (!byFriend[r.friend_id]) byFriend[r.friend_id] = [];
        byFriend[r.friend_id].push(r);
      }

      const tb: Record<string, Totals> = {};
      let gt = emptyTotals();
      for (const fid of friendIds) {
        const t = totalsFromEntries(byFriend[fid] ?? []);
        tb[fid] = t;
        gt = addTotals(gt, t);
      }

      flat.sort((a, b) => {
        const n = a.friend_name.localeCompare(b.friend_name);
        if (n !== 0) return n;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      setRows(flat);
      setTotalsByFriend(tb);
      setGrandTotals(gt);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
      setRows([]);
      setTotalsByFriend({});
      setGrandTotals(emptyTotals());
    } finally {
      setLoading(false);
    }
  }

  function toggleFriend(id: string) {
    setSelectedFriendIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAll() {
    setSelectedFriendIds(friends.map((f) => f.user_id));
  }

  function clearAll() {
    setSelectedFriendIds([]);
  }

  return (
    <main className={styles.page}>
      <Nav />

      <div className={styles.container}>
        <h1 className={styles.title}>Friends</h1>

        <div className={styles.layout}>
          {/* LEFT */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <b>People in your group</b>
              <button className={styles.button} onClick={loadFriends} disabled={loading}>
                {loading ? "..." : "Refresh"}
              </button>
            </div>

            <div className={styles.toolbar}>
              <button className={styles.button} onClick={selectAll} disabled={loading || friends.length === 0}>
                Select all
              </button>
              <button className={styles.button} onClick={clearAll} disabled={loading || selectedFriendIds.length === 0}>
                Clear
              </button>
            </div>

            {friends.length === 0 ? (
              <p className={styles.muted}>{msg ?? "No people found yet."}</p>
            ) : (
              <ul className={styles.friendList}>
                {friends.map((f) => {
                  const checked = selectedFriendIds.includes(f.user_id);
                  return (
                    <li key={f.user_id} className={styles.friendItem}>
                      <label className={styles.friendLabel}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFriend(f.user_id)}
                          className={styles.checkbox}
                        />
                        <span>{f.display_name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* RIGHT */}
          <div className={styles.card}>
            <div className={styles.topRow}>
              <div>
                <b>Selected:</b> {selectedFriendIds.length} / {friends.length}
              </div>

              <div className={styles.topRowRight}>
                <label className={styles.dateLabel}>
                  Date{" "}
                  <input
                    className={styles.dateInput}
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                  />
                </label>

                <div className={styles.totalsInline}>
                  <div>
                    <b>Total:</b> {grandTotals.calories} kcal
                  </div>
                  <div>
                    <b>P:</b> {grandTotals.protein}g
                  </div>
                  <div>
                    <b>C:</b> {grandTotals.carbs}g
                  </div>
                  <div>
                    <b>F:</b> {grandTotals.fat}g
                  </div>
                </div>
              </div>
            </div>

            {msg && <p className={styles.error}>{msg}</p>}

            {/* SUMMARY TABLE */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Totals by friend</h2>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Friend</th>
                      <th className={`${styles.th} ${styles.thNum}`}>Calories</th>
                      <th className={`${styles.th} ${styles.thNum}`}>Protein (g)</th>
                      <th className={`${styles.th} ${styles.thNum}`}>Carbs (g)</th>
                      <th className={`${styles.th} ${styles.thNum}`}>Fat (g)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedFriendIds.length === 0 ? (
                      <tr>
                        <td className={styles.td} colSpan={5}>
                          <span className={styles.muted}>Select one or more people to view.</span>
                        </td>
                      </tr>
                    ) : (
                      selectedFriendIds
                        .map((id) => {
                          const f = friends.find((x) => x.user_id === id);
                          const t = totalsByFriend[id] ?? emptyTotals();
                          return { id, name: f?.display_name ?? "(unknown)", t };
                        })
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(({ id, name, t }) => (
                          <tr key={id} className={styles.tr}>
                            <td className={styles.td}>{name}</td>
                            <td className={`${styles.td} ${styles.tdNum}`}>{t.calories}</td>
                            <td className={`${styles.td} ${styles.tdNum}`}>{t.protein}</td>
                            <td className={`${styles.td} ${styles.tdNum}`}>{t.carbs}</td>
                            <td className={`${styles.td} ${styles.tdNum}`}>{t.fat}</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ENTRIES TABLE */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Entries</h2>

              {selectedFriendIds.length > 0 && rows.length === 0 ? <p className={styles.muted}>No entries for this day.</p> : null}

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Friend</th>
                      <th className={styles.th}>Meal</th>
                      <th className={styles.th}>Item</th>
                      <th className={`${styles.th} ${styles.thNum}`}>Calories</th>
                      <th className={`${styles.th} ${styles.thNum}`}>P</th>
                      <th className={`${styles.th} ${styles.thNum}`}>C</th>
                      <th className={`${styles.th} ${styles.thNum}`}>F</th>
                      <th className={styles.th}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={styles.tr}>
                        <td className={styles.td}>{r.friend_name}</td>
                        <td className={styles.td}>{r.meal}</td>
                        <td className={styles.td}>{r.name}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.calories}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.protein_g}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.carbs_g}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.fat_g}</td>
                        <td className={`${styles.td} ${styles.tdSmall}`}>
                          {r.created_at ? new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                        </td>
                      </tr>
                    ))}

                    {selectedFriendIds.length > 0 && rows.length === 0 ? (
                      <tr>
                        <td className={styles.td} colSpan={8}>
                          <span className={styles.muted}>No rows to display.</span>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            {loading ? <p className={styles.muted}>Loading…</p> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
