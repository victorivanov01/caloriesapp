"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Nav from "@/components/Nav";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Today.module.css";
import { useSearchParams } from "next/navigation";
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

function toNullableInt(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function toIntOrZero(v: string): number {
  const s = v.trim();
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function emptyTotals(): Totals {
  return { calories: 0, protein: 0, carbs: 0, fat: 0, grams: 0 };
}

function parseWeightKg(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.round(n * 100) / 100;
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
function ringColorCalories(percentRaw: number, mode: "bulk" | "cut"): string {
  const p = Number.isFinite(percentRaw) ? percentRaw : 0;

  if (mode === "bulk") {
    if (p < 50) return "rgba(239, 68, 68, 0.92)"; // red
    if (p < 75) return "rgba(245, 158, 11, 0.92)"; // orange
    if (p < 90) return "rgba(234, 179, 8, 0.92)"; // yellow
    return "rgba(16, 185, 129, 0.92)"; // green (>=90, including >100)
  }

  // cut
  if (p >= 100) return "rgba(239, 68, 68, 0.92)"; // red (over)
  if (p >= 90) return "rgba(245, 158, 11, 0.92)"; // orange
  if (p >= 75) return "rgba(234, 179, 8, 0.92)"; // yellow
  return "rgba(16, 185, 129, 0.92)"; // green
}

/**
 * Protein (both modes):
 * low = red -> orange -> yellow -> green as it approaches goal
 * at 100% and above: still GREEN
 */
function ringColorProtein(percentRaw: number): string {
  const p = Number.isFinite(percentRaw) ? percentRaw : 0;

  if (p < 50) return "rgba(239, 68, 68, 0.92)"; // red
  if (p < 75) return "rgba(245, 158, 11, 0.92)"; // orange
  if (p < 90) return "rgba(234, 179, 8, 0.92)"; // yellow
  return "rgba(16, 185, 129, 0.92)"; // green (>=90, including >100)
}

type EditDraft = {
  name: string;
  grams: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  meal: string;
};

function toDraft(e: Entry): EditDraft {
  return {
    name: e.name ?? "",
    grams: e.grams != null ? String(e.grams) : "",
    calories: e.calories != null ? String(e.calories) : "",
    protein: e.protein_g != null ? String(e.protein_g) : "",
    carbs: e.carbs_g != null ? String(e.carbs_g) : "",
    fat: e.fat_g != null ? String(e.fat_g) : "",
    meal: (e.meal ?? "Snack") || "Snack",
  };
}

function TodayInner() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const searchParams = useSearchParams();

  const [userId, setUserId] = useState<string | null>(null);

  const [dateStr, setDateStr] = useState<string>(() => ymd(new Date()));
  const didInitFromUrl = useRef(false);

  const [dailyLogId, setDailyLogId] = useState<string | null>(null);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState<Totals>(emptyTotals());

  const [weightKg, setWeightKg] = useState<string>("");

  const [weekStart, setWeekStart] = useState<string>(() => ymd(startOfWeekMonday(ymd(new Date()))));
  const [weeklyGoal, setWeeklyGoal] = useState<WeeklyGoal>(null);

  const [name, setName] = useState("");
  const [grams, setGrams] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [meal, setMeal] = useState("Snack");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // init date from /today?date=YYYY-MM-DD once
  useEffect(() => {
    if (didInitFromUrl.current) return;
    const d = (searchParams.get("date") ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setDateStr(d);
    }
    didInitFromUrl.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
    void ensureLogAndLoadDay(dateStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dateStr]);

  // load weekly goals for this date's week
  useEffect(() => {
    if (!userId) return;

    const ws = ymd(startOfWeekMonday(dateStr));
    setWeekStart(ws);

    void (async () => {
      const { data, error } = await supabase
        .from("weekly_goals")
        .select("mode, calorie_goal, protein_goal_g")
        .eq("user_id", userId)
        .eq("week_start", ws)
        .maybeSingle();

      if (error || !data) {
        setWeeklyGoal(null);
        return;
      }

      const m = (data as any).mode === "bulk" ? "bulk" : "cut";
      setWeeklyGoal({
        mode: m,
        calorie_goal: (data as any).calorie_goal ?? null,
        protein_goal_g: (data as any).protein_goal_g ?? null,
      });
    })();
  }, [userId, dateStr, supabase]);

  async function ensureLogAndLoadDay(day: string) {
    setErrorMsg(null);
    setLoading(true);

    try {
      const { data: existing, error: exErr } = await supabase
        .from("daily_logs")
        .select("id, weight_kg")
        .eq("user_id", userId!)
        .eq("log_date", day)
        .maybeSingle();

      if (exErr) throw exErr;

      let logId = (existing?.id as string | undefined) ?? undefined;

      if (!logId) {
        const { data: created, error: cErr } = await supabase
          .from("daily_logs")
          .insert({ user_id: userId!, log_date: day })
          .select("id, weight_kg")
          .single();

        if (cErr) throw cErr;
        logId = created.id;
        setWeightKg(created.weight_kg != null ? String(created.weight_kg) : "");
      } else {
        setWeightKg(existing?.weight_kg != null ? String(existing.weight_kg) : "");
      }

      setDailyLogId(logId ?? null);

      const { data: ents, error: eErr } = await supabase
        .from("food_entries")
        .select("id, name, calories, protein_g, carbs_g, fat_g, grams, meal, created_at")
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
        grams: list.reduce((s, x) => s + (x.grams ?? 0), 0),
      };
      setTotals(t);

      if (editingId && !list.some((x) => x.id === editingId)) {
        setEditingId(null);
        setEditDraft(null);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
      setEntries([]);
      setTotals(emptyTotals());
      setDailyLogId(null);
      setEditingId(null);
      setEditDraft(null);
    } finally {
      setLoading(false);
    }
  }

  async function saveWeight() {
    if (!dailyLogId) return;
    setErrorMsg(null);

    try {
      const w = parseWeightKg(weightKg);
      const { error } = await supabase.from("daily_logs").update({ weight_kg: w }).eq("id", dailyLogId);
      if (error) throw error;

      setWeightKg(w != null ? String(w) : "");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
    }
  }

  async function addEntry() {
    if (!dailyLogId) return;

    const n = name.trim();
    if (!n) {
      setErrorMsg("Food name is required.");
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      const payload = {
        daily_log_id: dailyLogId,
        user_id: userId!,
        name: n,
        grams: toNullableInt(grams),
        calories: toIntOrZero(calories),
        protein_g: toIntOrZero(protein),
        carbs_g: toIntOrZero(carbs),
        fat_g: toIntOrZero(fat),
        meal,
      };

      const { error } = await supabase.from("food_entries").insert(payload);
      if (error) throw error;

      setName("");
      setGrams("");
      setCalories("");
      setProtein("");
      setCarbs("");
      setFat("");
      setMeal("Snack");

      await ensureLogAndLoadDay(dateStr);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function deleteEntry(id: string) {
    setErrorMsg(null);
    setLoading(true);

    try {
      if (editingId === id) {
        setEditingId(null);
        setEditDraft(null);
      }

      const { error } = await supabase.from("food_entries").delete().eq("id", id);
      if (error) throw error;

      await ensureLogAndLoadDay(dateStr);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(e: Entry) {
    setEditingId(e.id);
    setEditDraft(toDraft(e));
    setErrorMsg(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;

    const newName = editDraft.name.trim();
    if (!newName) {
      setErrorMsg("Food name is required.");
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      const payload = {
        name: newName,
        grams: toNullableInt(editDraft.grams),
        calories: toIntOrZero(editDraft.calories),
        protein_g: toIntOrZero(editDraft.protein),
        carbs_g: toIntOrZero(editDraft.carbs),
        fat_g: toIntOrZero(editDraft.fat),
        meal: editDraft.meal,
      };

      const { error } = await supabase.from("food_entries").update(payload).eq("id", id);
      if (error) throw error;

      setEditingId(null);
      setEditDraft(null);

      await ensureLogAndLoadDay(dateStr);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  const mode = weeklyGoal?.mode ?? "cut";
  const calPct = pctRaw(totals.calories, weeklyGoal?.calorie_goal ?? null);
  const protPct = pctRaw(totals.protein, weeklyGoal?.protein_goal_g ?? null);

  return (
    <div className={styles.page}>
      <Nav />

      <div className={styles.container}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Today</h1>

          <div className={styles.totalsInline}>
            <div>Total: {totals.calories} kcal</div>
            <div>
              P: {totals.protein}g · C: {totals.carbs}g · F: {totals.fat}g · G: {totals.grams}g · W:{" "}
              {weightKg ? `${weightKg}kg` : "-"}
            </div>
          </div>
        </div>

        {weeklyGoal && (weeklyGoal.calorie_goal != null || weeklyGoal.protein_goal_g != null) ? (
          <div className={styles.progressCard}>
            <div className={styles.mutedSmall}>
              Mode: <b>{weeklyGoal.mode.toUpperCase()}</b> · Week of <b>{weekStart}</b>
            </div>

            <div className={styles.goalGrid}>
              {weeklyGoal.calorie_goal != null ? (
                <div className={styles.goalItem}>
                  <div
                    className={styles.ring}
                    style={
                      {
                        ["--p" as any]: `${pctClamped(totals.calories, weeklyGoal.calorie_goal)}`,
                        ["--ringColor" as any]: ringColorCalories(calPct, mode),
                      } as React.CSSProperties
                    }
                  >
                    <div className={styles.ringInner}>
                      <div className={styles.ringTitle}>Calories</div>
                      <div className={styles.ringValue}>
                        {totals.calories} / {weeklyGoal.calorie_goal}
                      </div>
                      <div className={styles.ringSub}>{Math.round(calPct)}%</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {weeklyGoal.protein_goal_g != null ? (
                <div className={styles.goalItem}>
                  <div
                    className={styles.ring}
                    style={
                      {
                        ["--p" as any]: `${pctClamped(totals.protein, weeklyGoal.protein_goal_g)}`,
                        ["--ringColor" as any]: ringColorProtein(protPct),
                      } as React.CSSProperties
                    }
                  >
                    <div className={styles.ringInner}>
                      <div className={styles.ringTitle}>Protein</div>
                      <div className={styles.ringValue}>
                        {totals.protein} / {weeklyGoal.protein_goal_g} g
                      </div>
                      <div className={styles.ringSub}>{Math.round(protPct)}%</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={styles.mutedSmall}>
              Set goals in <b>Week</b>.
            </div>
          </div>
        ) : (
          <div className={styles.mutedSmall} style={{ marginTop: 10 }}>
            No goals set for this week yet. Set them in <b>Week</b>.
          </div>
        )}

        <div className={styles.controlsRow}>
          <label className={styles.dateLabel}>
            Date <DatePicker value={dateStr} onChange={setDateStr} />
          </label>

          <label className={styles.field}>
            Weight (kg)
            <input
              className={styles.numInput}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              onBlur={saveWeight}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              }}
              inputMode="decimal"
              placeholder="e.g. 72.5"
              disabled={loading || !dailyLogId}
            />
          </label>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Quick add</h2>
          </div>

          <div className={styles.card}>
            <input className={styles.textInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Food name (fast manual entry)" />

            <div className={styles.formRow}>
              <label className={styles.field}>
                grams (g)
                <input className={styles.numInput} value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="numeric" placeholder="g" />
              </label>

              <label className={styles.field}>
                kcal
                <input className={styles.numInput} value={calories} onChange={(e) => setCalories(e.target.value)} inputMode="numeric" />
              </label>

              <label className={styles.field}>
                protein (g)
                <input className={styles.numInput} value={protein} onChange={(e) => setProtein(e.target.value)} inputMode="numeric" />
              </label>

              <label className={styles.field}>
                carbs (g)
                <input className={styles.numInput} value={carbs} onChange={(e) => setCarbs(e.target.value)} inputMode="numeric" />
              </label>

              <label className={styles.field}>
                fat (g)
                <input className={styles.numInput} value={fat} onChange={(e) => setFat(e.target.value)} inputMode="numeric" />
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
                Add
              </button>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Entries</h2>
          </div>

          {entries.length === 0 ? (
            <div className={styles.muted}>No entries yet.</div>
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
                    <th className={styles.th}></th>
                  </tr>
                </thead>

                <tbody>
                  {entries.map((e) => {
                    const isEditing = editingId === e.id;

                    if (!isEditing) {
                      return (
                        <tr key={e.id} className={styles.tr}>
                          <td className={styles.td}>{e.meal ?? ""}</td>
                          <td className={styles.td}>{e.name}</td>
                          <td className={`${styles.td} ${styles.tdNum}`}>{e.grams ?? "-"}</td>
                          <td className={`${styles.td} ${styles.tdNum}`}>{e.calories ?? 0}</td>
                          <td className={`${styles.td} ${styles.tdNum}`}>{e.protein_g ?? 0}</td>
                          <td className={`${styles.td} ${styles.tdNum}`}>{e.carbs_g ?? 0}</td>
                          <td className={`${styles.td} ${styles.tdNum}`}>{e.fat_g ?? 0}</td>
                          <td className={styles.td}>
                            <button className={styles.button} onClick={() => startEdit(e)} disabled={loading}>
                              Edit
                            </button>
                            <button className={styles.dangerButton} onClick={() => deleteEntry(e.id)} disabled={loading}>
                              delete
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={e.id} className={styles.tr}>
                        <td className={styles.td}>
                          <select
                            className={styles.select}
                            value={editDraft?.meal ?? "Snack"}
                            onChange={(ev) => setEditDraft((p) => (p ? { ...p, meal: ev.target.value } : p))}
                            disabled={loading}
                          >
                            <option>Breakfast</option>
                            <option>Lunch</option>
                            <option>Dinner</option>
                            <option>Snack</option>
                          </select>
                        </td>

                        <td className={styles.td}>
                          <input
                            className={styles.textInput}
                            value={editDraft?.name ?? ""}
                            onChange={(ev) => setEditDraft((p) => (p ? { ...p, name: ev.target.value } : p))}
                            disabled={loading}
                          />
                        </td>

                        <td className={`${styles.td} ${styles.tdNum}`}>
                          <input
                            className={styles.numInput}
                            value={editDraft?.grams ?? ""}
                            onChange={(ev) => setEditDraft((p) => (p ? { ...p, grams: ev.target.value } : p))}
                            inputMode="numeric"
                            disabled={loading}
                          />
                        </td>

                        <td className={`${styles.td} ${styles.tdNum}`}>
                          <input
                            className={styles.numInput}
                            value={editDraft?.calories ?? ""}
                            onChange={(ev) => setEditDraft((p) => (p ? { ...p, calories: ev.target.value } : p))}
                            inputMode="numeric"
                            disabled={loading}
                          />
                        </td>

                        <td className={`${styles.td} ${styles.tdNum}`}>
                          <input
                            className={styles.numInput}
                            value={editDraft?.protein ?? ""}
                            onChange={(ev) => setEditDraft((p) => (p ? { ...p, protein: ev.target.value } : p))}
                            inputMode="numeric"
                            disabled={loading}
                          />
                        </td>

                        <td className={`${styles.td} ${styles.tdNum}`}>
                          <input
                            className={styles.numInput}
                            value={editDraft?.carbs ?? ""}
                            onChange={(ev) => setEditDraft((p) => (p ? { ...p, carbs: ev.target.value } : p))}
                            inputMode="numeric"
                            disabled={loading}
                          />
                        </td>

                        <td className={`${styles.td} ${styles.tdNum}`}>
                          <input
                            className={styles.numInput}
                            value={editDraft?.fat ?? ""}
                            onChange={(ev) => setEditDraft((p) => (p ? { ...p, fat: ev.target.value } : p))}
                            inputMode="numeric"
                            disabled={loading}
                          />
                        </td>

                        <td className={styles.td}>
                          <div className={styles.editActions}>
                            <button className={styles.primaryButton} onClick={() => saveEdit(e.id)} disabled={loading}>
                              save
                            </button>

                            <button className={styles.button} onClick={cancelEdit} disabled={loading}>
                              cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {errorMsg ? <div className={styles.error}>{errorMsg}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function TodayPage() {
  return (
    <Suspense fallback={null}>
      <TodayInner />
    </Suspense>
  );
}
