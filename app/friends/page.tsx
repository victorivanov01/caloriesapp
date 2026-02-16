"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Friends.module.css";
import DatePicker from "@/components/DatePicker";

type Friend = { user_id: string; display_name: string };

type Entry = {
  id: string;
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  grams: number;
  meal: string;
  created_at: string;
};

type EntryRow = Entry & {
  friend_id: string;
  friend_name: string;
};

type Totals = { calories: number; protein: number; carbs: number; fat: number; grams: number };

type WeeklyGoal = {
  mode: "bulk" | "cut";
  calorie_goal: number | null; // DAILY goal
  protein_goal_g: number | null; // DAILY goal
} | null;

function emptyTotals(): Totals {
  return { calories: 0, protein: 0, carbs: 0, fat: 0, grams: 0 };
}

function addTotals(a: Totals, b: Totals): Totals {
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    grams: a.grams + b.grams,
  };
}

function totalsFromEntries(list: Entry[]): Totals {
  return {
    calories: list.reduce((sum, x) => sum + (x.calories ?? 0), 0),
    protein: list.reduce((sum, x) => sum + (x.protein_g ?? 0), 0),
    carbs: list.reduce((sum, x) => sum + (x.carbs_g ?? 0), 0),
    fat: list.reduce((sum, x) => sum + (x.fat_g ?? 0), 0),
    grams: list.reduce((sum, x) => sum + (x.grams ?? 0), 0),
  };
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeekMonday(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // Monday start
  d.setDate(d.getDate() - diff);
  return d;
}

function pctRaw(value: number, goal: number | null): number {
  if (!goal || goal <= 0) return 0;
  return (value / goal) * 100;
}

function pctClamped(value: number, goal: number | null): number {
  return Math.max(0, Math.min(100, pctRaw(value, goal)));
}

/**
 * Calories:
 * - BULK: low is bad (red) -> orange -> yellow -> green near goal; >100 stays green
 * - CUT: low is good (green) -> yellow -> orange -> red at >=100 (over limit)
 */
function colorCalories(percentRaw: number, mode: "bulk" | "cut"): string {
  const p = Number.isFinite(percentRaw) ? percentRaw : 0;

  if (mode === "bulk") {
    if (p < 50) return "rgba(239, 68, 68, 0.92)";
    if (p < 75) return "rgba(245, 158, 11, 0.92)";
    if (p < 90) return "rgba(234, 179, 8, 0.92)";
    return "rgba(16, 185, 129, 0.92)";
  }

  // cut
  if (p >= 100) return "rgba(239, 68, 68, 0.92)";
  if (p >= 90) return "rgba(245, 158, 11, 0.92)";
  if (p >= 75) return "rgba(234, 179, 8, 0.92)";
  return "rgba(16, 185, 129, 0.92)";
}

/**
 * Protein:
 * low = red -> orange -> yellow -> green as it approaches goal
 * at 100% and above: still GREEN
 */
function colorProtein(percentRaw: number): string {
  const p = Number.isFinite(percentRaw) ? percentRaw : 0;

  if (p < 50) return "rgba(239, 68, 68, 0.92)";
  if (p < 75) return "rgba(245, 158, 11, 0.92)";
  if (p < 90) return "rgba(234, 179, 8, 0.92)";
  return "rgba(16, 185, 129, 0.92)";
}

export default function FriendsPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [meId, setMeId] = useState<string | null>(null);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);

  const [dateStr, setDateStr] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [weekStartStr, setWeekStartStr] = useState<string>(() => ymd(startOfWeekMonday(new Date().toISOString().slice(0, 10))));

  const [rows, setRows] = useState<EntryRow[]>([]);
  const [totalsByFriend, setTotalsByFriend] = useState<Record<string, Totals>>({});
  const [grandTotals, setGrandTotals] = useState<Totals>(emptyTotals());

  // NEW: goals (still loaded per week, but used for daily targets)
  const [goalsByFriend, setGoalsByFriend] = useState<Record<string, WeeklyGoal>>({});

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) window.location.href = "/login";
      else setMeId(data.user.id);
    });
  }, [supabase]);

  useEffect(() => {
    setWeekStartStr(ymd(startOfWeekMonday(dateStr)));
  }, [dateStr]);

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
      setGoalsByFriend({});
      return;
    }

    void loadSelectedFriendsDay(selectedFriendIds, dateStr);
    void loadSelectedFriendsGoals(selectedFriendIds, weekStartStr);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFriendIds, dateStr, weekStartStr]);

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

      const myName = (myProf.display_name ?? "").trim();
      const listWithYou = list.map((f) =>
        f.user_id === meId
          ? {
              ...f,
              display_name: myName ? `${myName} (you)` : "You",
            }
          : f
      );

      listWithYou.sort((a, b) => {
        if (a.user_id === meId) return -1;
        if (b.user_id === meId) return 1;
        return a.display_name.localeCompare(b.display_name);
      });

      setFriends(listWithYou);

      const valid = new Set(listWithYou.map((f) => f.user_id));
      const kept = selectedFriendIds.filter((id) => valid.has(id));

      if (kept.length > 0) {
        setSelectedFriendIds(kept);
      } else {
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
        .select("id, name, calories, protein_g, carbs_g, fat_g, grams, meal, created_at, daily_log_id")
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
          grams: x.grams ?? 0,
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

  // NEW: load goals for selected friends for the week containing dateStr
  async function loadSelectedFriendsGoals(friendIds: string[], weekStartYmd: string) {
    try {
      const { data: goals, error: gErr } = await supabase
        .from("weekly_goals")
        .select("user_id, week_start, mode, calorie_goal, protein_goal_g")
        .in("user_id", friendIds)
        .eq("week_start", weekStartYmd);

      if (gErr) throw gErr;

      const next: Record<string, WeeklyGoal> = {};
      for (const uid of friendIds) next[uid] = null;

      for (const r of (goals ?? []) as any[]) {
        const uid = r.user_id as string;
        const mode: "bulk" | "cut" = r.mode === "bulk" ? "bulk" : "cut";
        next[uid] = {
          mode,
          calorie_goal: r.calorie_goal ?? null,
          protein_goal_g: r.protein_goal_g ?? null,
        };
      }

      setGoalsByFriend(next);
    } catch {
      // don't break the page if this fails
      setGoalsByFriend({});
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
                        <input type="checkbox" checked={checked} onChange={() => toggleFriend(f.user_id)} className={styles.checkbox} />
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
                  Date <DatePicker value={dateStr} onChange={(newDate) => setDateStr(newDate)} />
                </label>
              </div>
            </div>

            {msg && <p className={styles.error}>{msg}</p>}

            {/* DAILY PROGRESS */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Daily progress</h2>

              {selectedFriendIds.length === 0 ? (
                <p className={styles.muted}>Select one or more people to view daily progress.</p>
              ) : (
                <div className={styles.progressList}>
                  {selectedFriendIds
                    .map((id) => {
                      const f = friends.find((x) => x.user_id === id);
                      const t = totalsByFriend[id] ?? emptyTotals();
                      const goal = goalsByFriend[id] ?? null;
                      return { id, name: f?.display_name ?? "(unknown)", t, goal };
                    })
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(({ id, name, t, goal }) => {
                      const mode: "bulk" | "cut" = goal?.mode ?? "cut";

                      const calGoal = goal?.calorie_goal ?? null; // DAILY
                      const protGoal = goal?.protein_goal_g ?? null; // DAILY

                      const calPct = pctClamped(t.calories, calGoal);
                      const protPct = pctClamped(t.protein, protGoal);

                      const calPctRaw = pctRaw(t.calories, calGoal);
                      const protPctRaw = pctRaw(t.protein, protGoal);

                      const calColor = goal ? colorCalories(calPctRaw, mode) : "rgba(255,255,255,0.25)";
                      const protColor = goal ? colorProtein(protPctRaw) : "rgba(255,255,255,0.25)";

                      const hasAnyGoal = (calGoal != null && calGoal > 0) || (protGoal != null && protGoal > 0);

                      return (
                        <div key={id} className={styles.progressCard}>
                          <div className={styles.progressHeader}>
                            <div className={styles.progressName}>{name}</div>
                            <div className={styles.progressMeta}>
                              <span className={styles.modeBadge}>{goal && hasAnyGoal ? mode.toUpperCase() : "NO GOALS"}</span>
                            </div>
                          </div>

                          {!goal || !hasAnyGoal ? (
                            <div className={styles.progressEmpty}>No goals set for this week (used as daily targets).</div>
                          ) : (
                            <div className={styles.progressBars}>
                              {/* Calories */}
                              {calGoal != null && calGoal > 0 ? (
                                <div className={styles.progressRow}>
                                  <div className={styles.progressLabel}>
                                    <span>Calories</span>
                                    <span className={styles.progressNums}>
                                      {t.calories} / {calGoal} · {Math.round(calPctRaw)}%
                                    </span>
                                  </div>
                                  <div className={styles.barTrack}>
                                    <div className={styles.barFill} style={{ width: `${calPct}%`, background: calColor } as CSSProperties} />
                                  </div>
                                </div>
                              ) : null}

                              {/* Protein */}
                              {protGoal != null && protGoal > 0 ? (
                                <div className={styles.progressRow}>
                                  <div className={styles.progressLabel}>
                                    <span>Protein</span>
                                    <span className={styles.progressNums}>
                                      {t.protein} / {protGoal} g · {Math.round(protPctRaw)}%
                                    </span>
                                  </div>
                                  <div className={styles.barTrack}>
                                    <div className={styles.barFill} style={{ width: `${protPct}%`, background: protColor } as CSSProperties} />
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

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
                      <th className={`${styles.th} ${styles.thNum}`}>Grams (g)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedFriendIds.length === 0 ? (
                      <tr>
                        <td className={styles.td} colSpan={6}>
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
                            <td className={`${styles.td} ${styles.tdNum}`}>{t.grams}</td>
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
                      <th className={`${styles.th} ${styles.thNum}`}>Grams</th>
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
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.grams ?? 0}</td>
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
