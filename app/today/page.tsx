"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Today.module.css";

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

type Totals = { calories: number; protein: number; carbs: number; fat: number };

type WeekDayRow = {
  dateStr: string; // YYYY-MM-DD
  label: string; // Mon 02/15
  totals: Totals;
};

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

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeekMonday(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dow} ${mm}/${dd}`;
}

export default function TodayPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [meId, setMeId] = useState<string | null>(null);

  const [dateStr, setDateStr] = useState<string>(() => ymd(new Date()));
  const [dailyLogId, setDailyLogId] = useState<string | null>(null);

  // fast manual entry
  const [name, setName] = useState("");
  const [calories, setCalories] = useState<number>(0);
  const [protein, setProtein] = useState<number>(0);
  const [carbs, setCarbs] = useState<number>(0);
  const [fat, setFat] = useState<number>(0);
  const [meal, setMeal] = useState<string>("Snack");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState<Totals>(emptyTotals());

  // week view
  const [weekStart, setWeekStart] = useState<string>(() => ymd(startOfWeekMonday(ymd(new Date()))));
  const [weekRows, setWeekRows] = useState<WeekDayRow[]>([]);
  const [weekTotals, setWeekTotals] = useState<Totals>(emptyTotals());
  const [showWeek, setShowWeek] = useState<boolean>(true);

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
    ensureLogAndLoadDay(dateStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, dateStr]);

  useEffect(() => {
    if (!meId) return;
    if (!showWeek) return;
    loadWeek(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, weekStart, showWeek]);

  async function ensureLogAndLoadDay(ymdStr: string) {
    setMsg(null);
    setLoading(true);
    try {
      const { data: log, error: logErr } = await supabase
        .from("daily_logs")
        .select("id")
        .eq("user_id", meId!)
        .eq("log_date", ymdStr)
        .maybeSingle();

      if (logErr) throw logErr;

      let logId = log?.id as string | undefined;

      if (!logId) {
        const { data: created, error: cErr } = await supabase
          .from("daily_logs")
          .insert({ user_id: meId!, log_date: ymdStr })
          .select("id")
          .single();

        if (cErr) throw cErr;
        logId = created.id;
      }

    setDailyLogId(logId ?? null);


      const { data: ents, error: eErr } = await supabase
        .from("food_entries")
        .select("id, name, calories, protein_g, carbs_g, fat_g, meal, created_at")
        .eq("daily_log_id", logId)
        .order("created_at", { ascending: true });

      if (eErr) throw eErr;

      const list = (ents ?? []) as Entry[];
      setEntries(list);

      const t: Totals = {
        calories: list.reduce((s, x) => s + (x.calories ?? 0), 0),
        protein: list.reduce((s, x) => s + (x.protein_g ?? 0), 0),
        carbs: list.reduce((s, x) => s + (x.carbs_g ?? 0), 0),
        fat: list.reduce((s, x) => s + (x.fat_g ?? 0), 0),
      };
      setTotals(t);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function loadWeek(weekStartYmd: string) {
    setMsg(null);
    setLoading(true);
    try {
      const start = new Date(`${weekStartYmd}T00:00:00`);
      const days: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        days.push(ymd(d));
      }

      const { data: logs, error: logsErr } = await supabase
        .from("daily_logs")
        .select("id, log_date")
        .eq("user_id", meId!)
        .in("log_date", days);

      if (logsErr) throw logsErr;

      const logByDate = new Map<string, string>();
      for (const l of (logs ?? []) as any[]) {
        if (l?.log_date && l?.id) logByDate.set(l.log_date, l.id);
      }

      const logIds = Array.from(logByDate.values());
      let entriesByLogId = new Map<string, Entry[]>();

      if (logIds.length > 0) {
        const { data: ents, error: eErr } = await supabase
          .from("food_entries")
          .select("id, name, calories, protein_g, carbs_g, fat_g, meal, created_at, daily_log_id")
          .in("daily_log_id", logIds);

        if (eErr) throw eErr;

        for (const e of (ents ?? []) as any[]) {
          const lid = e.daily_log_id as string;
          if (!entriesByLogId.has(lid)) entriesByLogId.set(lid, []);
          entriesByLogId.get(lid)!.push({
            id: e.id,
            name: e.name,
            calories: e.calories ?? 0,
            protein_g: e.protein_g ?? 0,
            carbs_g: e.carbs_g ?? 0,
            fat_g: e.fat_g ?? 0,
            meal: e.meal ?? "",
            created_at: e.created_at,
          });
        }
      }

      const rows: WeekDayRow[] = days.map((d) => {
        const logId = logByDate.get(d);
        const list = logId ? entriesByLogId.get(logId) ?? [] : [];
        const t: Totals = {
          calories: list.reduce((s, x) => s + (x.calories ?? 0), 0),
          protein: list.reduce((s, x) => s + (x.protein_g ?? 0), 0),
          carbs: list.reduce((s, x) => s + (x.carbs_g ?? 0), 0),
          fat: list.reduce((s, x) => s + (x.fat_g ?? 0), 0),
        };
        return { dateStr: d, label: formatDayLabel(d), totals: t };
      });

      let wt = emptyTotals();
      for (const r of rows) wt = addTotals(wt, r.totals);

      setWeekRows(rows);
      setWeekTotals(wt);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
      setWeekRows([]);
      setWeekTotals(emptyTotals());
    } finally {
      setLoading(false);
    }
  }

  async function addEntry() {
    if (!dailyLogId) return;
    const n = name.trim();
    if (!n) {
      setMsg("Food name is required.");
      return;
    }

    setMsg(null);
    setLoading(true);
    try {
      const payload = {
        daily_log_id: dailyLogId,
        user_id: meId!,
        name: n,
        calories: Number.isFinite(calories) ? Math.max(0, Math.floor(calories)) : 0,
        protein_g: Number.isFinite(protein) ? Math.max(0, Math.floor(protein)) : 0,
        carbs_g: Number.isFinite(carbs) ? Math.max(0, Math.floor(carbs)) : 0,
        fat_g: Number.isFinite(fat) ? Math.max(0, Math.floor(fat)) : 0,
        meal,
      };

      const { error } = await supabase.from("food_entries").insert(payload);
      if (error) throw error;

      setName("");
      setCalories(0);
      setProtein(0);
      setCarbs(0);
      setFat(0);
      setMeal("Snack");

      await ensureLogAndLoadDay(dateStr);
      if (showWeek) await loadWeek(weekStart);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function deleteEntry(id: string) {
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.from("food_entries").delete().eq("id", id);
      if (error) throw error;
      await ensureLogAndLoadDay(dateStr);
      if (showWeek) await loadWeek(weekStart);
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  function goToThisWeek() {
    setWeekStart(ymd(startOfWeekMonday(ymd(new Date()))));
  }

  function prevWeek() {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setDate(d.getDate() - 7);
    setWeekStart(ymd(d));
  }

  function nextWeek() {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setDate(d.getDate() + 7);
    setWeekStart(ymd(d));
  }

  return (
    <main className={styles.page}>
      <Nav />

      <div className={styles.container}>
        {/* HEADER */}
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Today</h1>

          <div className={styles.totalsInline}>
            <div>
              <b>Total:</b> {totals.calories} kcal
            </div>
            <div>
              <b>P:</b> {totals.protein}g
            </div>
            <div>
              <b>C:</b> {totals.carbs}g
            </div>
            <div>
              <b>F:</b> {totals.fat}g
            </div>
          </div>
        </div>

        {/* CONTROLS */}
        <div className={styles.controlsRow}>
          <label className={styles.dateLabel}>
            Date
            <input className={styles.dateInput} type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </label>

          <label className={styles.switch}>
            <input type="checkbox" checked={showWeek} onChange={(e) => setShowWeek(e.target.checked)} />
            <span>Show week</span>
          </label>

          <div className={styles.weekNav}>
            <button className={styles.button} onClick={prevWeek} disabled={loading || !showWeek}>
              ←
            </button>
            <button className={styles.button} onClick={goToThisWeek} disabled={loading || !showWeek}>
              This week
            </button>
            <button className={styles.button} onClick={nextWeek} disabled={loading || !showWeek}>
              →
            </button>
          </div>

          <div className={styles.weekTotals}>
            <span className={styles.mutedSmall}>Week:</span>
            <span>
              <b>{weekTotals.calories}</b> kcal
            </span>
            <span>
              <b>{weekTotals.protein}</b>P
            </span>
            <span>
              <b>{weekTotals.carbs}</b>C
            </span>
            <span>
              <b>{weekTotals.fat}</b>F
            </span>
          </div>
        </div>

        {/* ✅ QUICK ADD MOVED HERE */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Quick add</h2>

          <div className={styles.card}>
            <input
              className={styles.textInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Food name (fast manual entry)"
            />

            <div className={styles.formRow}>
              <label className={styles.field}>
                kcal
                <input className={styles.numInput} type="number" value={calories} onChange={(e) => setCalories(Number(e.target.value))} />
              </label>

              <label className={styles.field}>
                protein (g)
                <input className={styles.numInput} type="number" value={protein} onChange={(e) => setProtein(Number(e.target.value))} />
              </label>

              <label className={styles.field}>
                carbs (g)
                <input className={styles.numInput} type="number" value={carbs} onChange={(e) => setCarbs(Number(e.target.value))} />
              </label>

              <label className={styles.field}>
                fat (g)
                <input className={styles.numInput} type="number" value={fat} onChange={(e) => setFat(Number(e.target.value))} />
              </label>

              <label className={styles.field}>
                meal
                <select className={styles.select} value={meal} onChange={(e) => setMeal(e.target.value)}>
                  <option>Breakfast</option>
                  <option>Lunch</option>
                  <option>Dinner</option>
                  <option>Snack</option>
                </select>
              </label>

              <button className={styles.primaryButton} onClick={addEntry} disabled={loading}>
                {loading ? "..." : "Add"}
              </button>
            </div>
          </div>
        </div>

        {/* WEEK COMPARISON AFTER QUICK ADD */}
        {showWeek ? (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Week comparison</h2>
              <div className={styles.mutedSmall}>
                Week starting <b>{weekStart}</b> (Mon)
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>Day</th>
                    <th className={`${styles.th} ${styles.thNum}`}>Calories</th>
                    <th className={`${styles.th} ${styles.thNum}`}>Protein</th>
                    <th className={`${styles.th} ${styles.thNum}`}>Carbs</th>
                    <th className={`${styles.th} ${styles.thNum}`}>Fat</th>
                    <th className={styles.th}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {weekRows.map((r) => {
                    const isActive = r.dateStr === dateStr;
                    return (
                      <tr key={r.dateStr} className={`${styles.tr} ${isActive ? styles.trActive : ""}`}>
                        <td className={styles.td}>{r.label}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.calories}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.protein}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.carbs}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.fat}</td>
                        <td className={styles.td}>
                          <button className={styles.linkButton} onClick={() => setDateStr(r.dateStr)} disabled={loading}>
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* ENTRIES */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Entries</h2>

          {entries.length === 0 ? (
            <p className={styles.muted}>No entries yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>Meal</th>
                    <th className={styles.th}>Item</th>
                    <th className={`${styles.th} ${styles.thNum}`}>kcal</th>
                    <th className={`${styles.th} ${styles.thNum}`}>P</th>
                    <th className={`${styles.th} ${styles.thNum}`}>C</th>
                    <th className={`${styles.th} ${styles.thNum}`}>F</th>
                    <th className={styles.th}>Time</th>
                    <th className={styles.th}> </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className={styles.tr}>
                      <td className={styles.td}>{e.meal}</td>
                      <td className={styles.td}>{e.name}</td>
                      <td className={`${styles.td} ${styles.tdNum}`}>{e.calories}</td>
                      <td className={`${styles.td} ${styles.tdNum}`}>{e.protein_g}</td>
                      <td className={`${styles.td} ${styles.tdNum}`}>{e.carbs_g}</td>
                      <td className={`${styles.td} ${styles.tdNum}`}>{e.fat_g}</td>
                      <td className={`${styles.td} ${styles.tdSmall}`}>
                        {e.created_at
                          ? new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : ""}
                      </td>
                      <td className={styles.td}>
                        <button className={styles.dangerButton} onClick={() => deleteEntry(e.id)} disabled={loading}>
                          delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {msg && <p className={styles.error}>{msg}</p>}
      </div>
    </main>
  );
}
