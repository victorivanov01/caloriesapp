"use client";

import React, { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "../today/Today.module.css";
import DatePicker from "@/components/DatePicker";

type Entry = {
  id: string;
  name: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  grams: number | null;
  meal: string | null;
  created_at: string;
};

type Totals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  grams: number;
};

type WeeklyGoal = {
  mode: "bulk" | "cut";
  calorie_goal: number | null;
  protein_goal_g: number | null;
} | null;

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

function formatDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dow} ${mm}/${dd}`;
}

function emptyTotals(): Totals {
  return { calories: 0, protein: 0, carbs: 0, fat: 0, grams: 0 };
}

function toNullableInt(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function pctRaw(value: number, goal: number | null): number {
  if (!goal || goal <= 0) return 0;
  return (value / goal) * 100;
}

function pctClamped(value: number, goal: number | null): number {
  return Math.max(0, Math.min(100, pctRaw(value, goal)));
}

// calories: bulk vs cut behavior (same as Today)
function ringColorCalories(percentRaw: number, mode: "bulk" | "cut"): string {
  const p = Number.isFinite(percentRaw) ? percentRaw : 0;

  if (mode === "bulk") {
    if (p < 50) return "rgba(239, 68, 68, 0.92)";
    if (p < 75) return "rgba(245, 158, 11, 0.92)";
    if (p < 90) return "rgba(234, 179, 8, 0.92)";
    return "rgba(16, 185, 129, 0.92)";
  }

  if (p >= 100) return "rgba(239, 68, 68, 0.92)";
  if (p >= 90) return "rgba(245, 158, 11, 0.92)";
  if (p >= 75) return "rgba(234, 179, 8, 0.92)";
  return "rgba(16, 185, 129, 0.92)";
}

// protein: low->red->orange->yellow->green, >=100 stays green
function ringColorProtein(percentRaw: number): string {
  const p = Number.isFinite(percentRaw) ? percentRaw : 0;
  if (p < 50) return "rgba(239, 68, 68, 0.92)";
  if (p < 75) return "rgba(245, 158, 11, 0.92)";
  if (p < 90) return "rgba(234, 179, 8, 0.92)";
  return "rgba(16, 185, 129, 0.92)";
}

export default function WeekPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<string>(() => ymd(startOfWeekMonday(ymd(new Date()))));

  const [weekRows, setWeekRows] = useState<{ dateStr: string; label: string; totals: Totals; weightKg: number | null }[]>([]);
  const [weekTotals, setWeekTotals] = useState<Totals>(emptyTotals());

  const [goalMode, setGoalMode] = useState<"bulk" | "cut">("cut");
  const [calorieGoalStr, setCalorieGoalStr] = useState<string>("");
  const [proteinGoalStr, setProteinGoalStr] = useState<string>("");
  const [weeklyGoal, setWeeklyGoal] = useState<WeeklyGoal>(null);
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalMsg, setGoalMsg] = useState<string | null>(null);

  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());
  const [entriesByDay, setEntriesByDay] = useState<Record<string, Entry[]>>({});
  const [loadingDays, setLoadingDays] = useState<Set<string>>(() => new Set());

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        window.location.href = "/login";
        return;
      }
      setUserId(data.user.id);
    });
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    void loadWeek(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, weekStart]);

  async function loadWeeklyGoal(weekStartYmd: string) {
    if (!userId) return;

    const { data, error } = await supabase
      .from("weekly_goals")
      .select("mode, calorie_goal, protein_goal_g")
      .eq("user_id", userId)
      .eq("week_start", weekStartYmd)
      .maybeSingle();

    if (error) {
      setGoalMsg(error.message);
      setWeeklyGoal(null);
      return;
    }

    if (!data) {
      setWeeklyGoal(null);
      setGoalMode("cut");
      setCalorieGoalStr("");
      setProteinGoalStr("");
      return;
    }

    const m = (data as any).mode === "bulk" ? "bulk" : "cut";
    const cg = (data as any).calorie_goal ?? null;
    const pg = (data as any).protein_goal_g ?? null;

    setWeeklyGoal({ mode: m, calorie_goal: cg, protein_goal_g: pg });
    setGoalMode(m);
    setCalorieGoalStr(cg != null ? String(cg) : "");
    setProteinGoalStr(pg != null ? String(pg) : "");
  }

  async function saveWeeklyGoal() {
    if (!userId) return;

    setGoalMsg(null);
    setSavingGoal(true);

    try {
      const payload = {
        user_id: userId,
        week_start: weekStart,
        mode: goalMode,
        calorie_goal: toNullableInt(calorieGoalStr),
        protein_goal_g: toNullableInt(proteinGoalStr),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("weekly_goals").upsert(payload, { onConflict: "user_id,week_start" });
      if (error) throw error;

      setGoalMsg("Saved goals for this week.");
      await loadWeeklyGoal(weekStart);
    } catch (e: any) {
      setGoalMsg(e?.message ?? "Error saving goals");
    } finally {
      setSavingGoal(false);
    }
  }

  async function loadWeek(weekStartYmd: string) {
    setErrorMsg(null);
    setLoading(true);
    setGoalMsg(null);

    try {
      await loadWeeklyGoal(weekStartYmd);

      const start = new Date(`${weekStartYmd}T00:00:00`);
      const days: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        days.push(ymd(d));
      }

      const { data: logs, error: logsErr } = await supabase
        .from("daily_logs")
        .select("id, log_date, weight_kg")
        .eq("user_id", userId!)
        .in("log_date", days);

      if (logsErr) throw logsErr;

      const logByDate = new Map<string, string>();
      const weightByDate = new Map<string, number | null>();

      for (const l of (logs ?? []) as any[]) {
        if (l?.log_date && l?.id) {
          logByDate.set(l.log_date, l.id);
          weightByDate.set(l.log_date, l.weight_kg ?? null);
        }
      }

      const logIds = Array.from(logByDate.values());
      const entriesByLogId = new Map<string, Entry[]>();

      if (logIds.length) {
        const { data: ents, error: eErr } = await supabase
          .from("food_entries")
          .select("id, name, calories, protein_g, carbs_g, fat_g, grams, meal, created_at, daily_log_id")
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
            grams: e.grams ?? null,
            meal: e.meal ?? "",
            created_at: e.created_at,
          });
        }
      }

      const rows = days.map((d) => {
        const logId = logByDate.get(d);
        const list = logId ? entriesByLogId.get(logId) ?? [] : [];
        const t: Totals = {
          calories: list.reduce((s, x) => s + (x.calories ?? 0), 0),
          protein: list.reduce((s, x) => s + (x.protein_g ?? 0), 0),
          carbs: list.reduce((s, x) => s + (x.carbs_g ?? 0), 0),
          fat: list.reduce((s, x) => s + (x.fat_g ?? 0), 0),
          grams: list.reduce((s, x) => s + (x.grams ?? 0), 0),
        };
        return { dateStr: d, label: formatDayLabel(d), totals: t, weightKg: weightByDate.get(d) ?? null };
      });

      const wt = rows.reduce(
        (acc, r) => ({
          calories: acc.calories + r.totals.calories,
          protein: acc.protein + r.totals.protein,
          carbs: acc.carbs + r.totals.carbs,
          fat: acc.fat + r.totals.fat,
          grams: acc.grams + r.totals.grams,
        }),
        emptyTotals()
      );

      setWeekRows(rows);
      setWeekTotals(wt);

      const allowed = new Set(rows.map((r) => r.dateStr));

      setOpenDays((prev) => {
        const next = new Set<string>();
        for (const d of prev) if (allowed.has(d)) next.add(d);
        return next;
      });

      setEntriesByDay((prev) => {
        const next: Record<string, Entry[]> = {};
        for (const [k, v] of Object.entries(prev)) if (allowed.has(k)) next[k] = v;
        return next;
      });

      setLoadingDays((prev) => {
        const next = new Set<string>();
        for (const d of prev) if (allowed.has(d)) next.add(d);
        return next;
      });
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
      setWeekRows([]);
      setWeekTotals(emptyTotals());
      setOpenDays(new Set());
      setEntriesByDay({});
      setLoadingDays(new Set());
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

  function onPickWeek(anyDateInWeek: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anyDateInWeek)) return;
    setWeekStart(ymd(startOfWeekMonday(anyDateInWeek)));
  }

  async function toggleDay(dayStr: string) {
    if (!userId) return;

    const isOpen = openDays.has(dayStr);

    if (isOpen) {
      setOpenDays((prev) => {
        const next = new Set(prev);
        next.delete(dayStr);
        return next;
      });
      return;
    }

    setOpenDays((prev) => new Set(prev).add(dayStr));

    if (entriesByDay[dayStr]) return;

    setLoadingDays((prev) => new Set(prev).add(dayStr));
    setErrorMsg(null);

    try {
      const { data: log, error: logErr } = await supabase
        .from("daily_logs")
        .select("id")
        .eq("user_id", userId)
        .eq("log_date", dayStr)
        .maybeSingle();

      if (logErr) throw logErr;

      if (!log?.id) {
        setEntriesByDay((prev) => ({ ...prev, [dayStr]: [] }));
        return;
      }

      const { data: ents, error: eErr } = await supabase
        .from("food_entries")
        .select("id, name, calories, protein_g, carbs_g, fat_g, grams, meal, created_at")
        .eq("daily_log_id", log.id)
        .order("created_at", { ascending: true });

      if (eErr) throw eErr;

      setEntriesByDay((prev) => ({ ...prev, [dayStr]: (ents ?? []) as Entry[] }));
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
      setEntriesByDay((prev) => ({ ...prev, [dayStr]: [] }));
    } finally {
      setLoadingDays((prev) => {
        const next = new Set(prev);
        next.delete(dayStr);
        return next;
      });
    }
  }

  const mode = weeklyGoal?.mode ?? "cut";

  const weeklyCalTarget = weeklyGoal?.calorie_goal != null ? weeklyGoal.calorie_goal * 7 : null;
  const weeklyProtTarget = weeklyGoal?.protein_goal_g != null ? weeklyGoal.protein_goal_g * 7 : null;

  const calPct = pctRaw(weekTotals.calories, weeklyCalTarget);
  const protPct = pctRaw(weekTotals.protein, weeklyProtTarget);

  return (
    <div className={styles.page}>
      <Nav />

      <div className={styles.container}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Week</h1>

          <div className={styles.totalsInline}>
            <div>Week: {weekTotals.calories} kcal</div>
            <div>
              P: {weekTotals.protein}g · C: {weekTotals.carbs}g · F: {weekTotals.fat}g · G: {weekTotals.grams}g
            </div>
          </div>
        </div>

        {weeklyGoal && (weeklyCalTarget != null || weeklyProtTarget != null) ? (
          <div className={styles.progressCard}>
            <div className={styles.mutedSmall}>
              Mode: <b>{mode.toUpperCase()}</b> · Week of <b>{weekStart}</b>
            </div>

            <div className={styles.goalGrid}>
              {weeklyCalTarget != null ? (
                <div className={styles.goalItem}>
                  <div
                    className={styles.ring}
                    style={
                      {
                        ["--p" as any]: `${pctClamped(weekTotals.calories, weeklyCalTarget)}`,
                        ["--ringColor" as any]: ringColorCalories(calPct, mode),
                      } as React.CSSProperties
                    }
                  >
                    <div className={styles.ringInner}>
                      <div className={styles.ringTitle}>Calories</div>
                      <div className={styles.ringValue}>
                        {weekTotals.calories} / {weeklyCalTarget}
                      </div>
                      <div className={styles.ringSub}>{Math.round(calPct)}%</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {weeklyProtTarget != null ? (
                <div className={styles.goalItem}>
                  <div
                    className={styles.ring}
                    style={
                      {
                        ["--p" as any]: `${pctClamped(weekTotals.protein, weeklyProtTarget)}`,
                        ["--ringColor" as any]: ringColorProtein(protPct),
                      } as React.CSSProperties
                    }
                  >
                    <div className={styles.ringInner}>
                      <div className={styles.ringTitle}>Protein</div>
                      <div className={styles.ringValue}>
                        {weekTotals.protein} / {weeklyProtTarget} g
                      </div>
                      <div className={styles.ringSub}>{Math.round(protPct)}%</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className={styles.controlsRow}>
          <span className={styles.dateLabel}>Week of</span>
          <DatePicker value={weekStart} onChange={onPickWeek} />

          <div className={styles.weekNav}>
            <button className={styles.button} onClick={prevWeek} disabled={loading}>
              ←
            </button>
            <button className={styles.primaryButton} onClick={goToThisWeek} disabled={loading}>
              This week
            </button>
            <button className={styles.button} onClick={nextWeek} disabled={loading}>
              →
            </button>
          </div>

          <label className={styles.field}>
            Mode
            <select className={styles.select} value={goalMode} onChange={(e) => setGoalMode(e.target.value as any)} disabled={loading || savingGoal}>
              <option value="bulk">Bulk</option>
              <option value="cut">Cut</option>
            </select>
          </label>

          <label className={styles.field}>
            Calories goal
            <input
              className={styles.numInput}
              type="number"
              inputMode="numeric"
              value={calorieGoalStr}
              onChange={(e) => setCalorieGoalStr(e.target.value)}
              placeholder="e.g. 2200"
              disabled={loading || savingGoal}
            />
          </label>

          <label className={styles.field}>
            Protein goal (g)
            <input
              className={styles.numInput}
              type="number"
              inputMode="numeric"
              value={proteinGoalStr}
              onChange={(e) => setProteinGoalStr(e.target.value)}
              placeholder="e.g. 180"
              disabled={loading || savingGoal}
            />
          </label>

          <button className={styles.button} onClick={saveWeeklyGoal} disabled={loading || savingGoal}>
            {savingGoal ? "Saving…" : "Save goals"}
          </button>

          <div className={styles.weekTotals}>
            <span>Start:</span>
            <span>{weekStart}</span>
          </div>
        </div>

        {goalMsg ? <div className={styles.mutedSmall}>{goalMsg}</div> : null}
        {errorMsg ? <div className={styles.error}>{errorMsg}</div> : null}

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Week comparison</h2>
            <div className={styles.mutedSmall}>Week starting {weekStart} (Mon)</div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Day</th>
                  <th className={`${styles.th} ${styles.thNum}`}>Weight</th>
                  <th className={`${styles.th} ${styles.thNum}`}>Calories</th>
                  <th className={`${styles.th} ${styles.thNum}`}>Protein</th>
                  <th className={`${styles.th} ${styles.thNum}`}>Carbs</th>
                  <th className={`${styles.th} ${styles.thNum}`}>Fat</th>
                  <th className={`${styles.th} ${styles.thNum}`}>Grams</th>
                  <th className={styles.th}>Open</th>
                </tr>
              </thead>

              <tbody>
                {weekRows.map((r) => {
                  const isOpen = openDays.has(r.dateStr);
                  const isLoadingDay = loadingDays.has(r.dateStr);
                  const dayEntries = entriesByDay[r.dateStr] ?? [];

                  return (
                    <React.Fragment key={r.dateStr}>
                      <tr className={styles.tr}>
                        <td className={styles.td}>{r.label}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.weightKg ?? "-"}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.calories}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.protein}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.carbs}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.fat}</td>
                        <td className={`${styles.td} ${styles.tdNum}`}>{r.totals.grams}</td>
                        <td className={styles.td}>
                          <button className={styles.linkButton} onClick={() => toggleDay(r.dateStr)} disabled={loading}>
                            {isOpen ? "Hide" : "View"}
                          </button>
                        </td>
                      </tr>

                      {isOpen ? (
                        <tr className={styles.tr}>
                          <td className={styles.td} colSpan={8}>
                            {isLoadingDay ? (
                              <div className={styles.muted}>Loading…</div>
                            ) : dayEntries.length === 0 ? (
                              <div className={styles.muted}>No entries for this day.</div>
                            ) : (
                              <div className={styles.tableWrap}>
                                <table className={styles.table}>
                                  <thead>
                                    <tr>
                                      <th className={styles.th}>Meal</th>
                                      <th className={styles.th}>Item</th>
                                      <th className={`${styles.th} ${styles.thNum}`}>g</th>
                                      <th className={`${styles.th} ${styles.thNum}`}>kcal</th>
                                      <th className={`${styles.th} ${styles.thNum}`}>P</th>
                                      <th className={`${styles.th} ${styles.thNum}`}>C</th>
                                      <th className={`${styles.th} ${styles.thNum}`}>F</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dayEntries.map((e) => (
                                      <tr key={e.id} className={styles.tr}>
                                        <td className={styles.td}>{e.meal ?? ""}</td>
                                        <td className={styles.td}>{e.name}</td>
                                        <td className={`${styles.td} ${styles.tdNum}`}>{e.grams ?? "-"}</td>
                                        <td className={`${styles.td} ${styles.tdNum}`}>{e.calories ?? 0}</td>
                                        <td className={`${styles.td} ${styles.tdNum}`}>{e.protein_g ?? 0}</td>
                                        <td className={`${styles.td} ${styles.tdNum}`}>{e.carbs_g ?? 0}</td>
                                        <td className={`${styles.td} ${styles.tdNum}`}>{e.fat_g ?? 0}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}

                {weekRows.length === 0 ? (
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
  );
}
