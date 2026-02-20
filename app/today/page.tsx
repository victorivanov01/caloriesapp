"use client";

export const dynamic = "force-dynamic";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
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

type EditDraft = {
  name: string;
  grams: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  meal: string;
};

type MealFilter = "All" | "Breakfast" | "Lunch" | "Dinner" | "Snack";
type CopyRange = "yesterday" | "week" | "month";

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

function ringColorProtein(percentRaw: number): string {
  const p = Number.isFinite(percentRaw) ? percentRaw : 0;

  if (p < 50) return "rgba(239, 68, 68, 0.92)";
  if (p < 75) return "rgba(245, 158, 11, 0.92)";
  if (p < 90) return "rgba(234, 179, 8, 0.92)";
  return "rgba(16, 185, 129, 0.92)";
}

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

function rangeLabel(r: CopyRange): string {
  if (r === "yesterday") return "Yesterday";
  if (r === "week") return "Past week";
  return "Past month";
}

function normalizeFoodName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
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

  // ✅ Weekly weight (stored on Monday daily_logs row)
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

  // ===== Quick Add Autocomplete =====
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [nameSuggestions, setNameSuggestions] = useState<Entry[]>([]);
  const suggestToken = useRef(0);
  const suggestTimer = useRef<number | null>(null);
  const suggestWrapRef = useRef<HTMLDivElement | null>(null);

  // ===== Quick Copy (MODAL) =====
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyRange, setCopyRange] = useState<CopyRange>("yesterday");
  const [copyEntries, setCopyEntries] = useState<Entry[]>([]);
  const [copySelectedIds, setCopySelectedIds] = useState<Record<string, boolean>>({});
  const [copyLoading, setCopyLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copySearch, setCopySearch] = useState("");
  const [copyMealFilter, setCopyMealFilter] = useState<MealFilter>("All");
  const [copyInfoMsg, setCopyInfoMsg] = useState<string | null>(null);

  const selectedCount = useMemo(() => Object.values(copySelectedIds).filter(Boolean).length, [copySelectedIds]);

  const filteredCopyEntries = useMemo(() => {
    const q = copySearch.trim().toLowerCase();
    return copyEntries.filter((e) => {
      if (copyMealFilter !== "All" && (e.meal ?? "") !== copyMealFilter) return false;
      if (!q) return true;
      return (e.name ?? "").toLowerCase().includes(q);
    });
  }, [copyEntries, copyMealFilter, copySearch]);

  const groupedCopy = useMemo(() => {
    const map = new Map<string, Entry[]>();

    for (const e of filteredCopyEntries) {
      const day = e.created_at ? e.created_at.slice(0, 10) : "Unknown";
      const arr = map.get(day) ?? [];
      arr.push(e);
      map.set(day, arr);
    }

    const days = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1)); // newest first
    return days.map((day) => ({ day, entries: map.get(day)! }));
  }, [filteredCopyEntries]);

  const copySourceText = useMemo(() => rangeLabel(copyRange), [copyRange]);

  // init date from /today?date=YYYY-MM-DD once
  useEffect(() => {
    if (didInitFromUrl.current) return;
    const d = (searchParams.get("date") ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) setDateStr(d);
    didInitFromUrl.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // client-only auth check
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

  // weekly goals for this date's week
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

  // ✅ Load weekly weight (Monday log) for the selected date
  async function loadWeeklyWeight(forDateYmd: string) {
    if (!userId) return;

    const ws = ymd(startOfWeekMonday(forDateYmd));
    try {
      const { data, error } = await supabase
        .from("daily_logs")
        .select("weight_kg")
        .eq("user_id", userId)
        .eq("log_date", ws)
        .maybeSingle();

      if (error) throw error;
      setWeightKg(data?.weight_kg != null ? String(data.weight_kg) : "");
    } catch {
      setWeightKg("");
    }
  }

  useEffect(() => {
    if (!userId) return;
    void loadWeeklyWeight(dateStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dateStr]);

  async function ensureLogAndLoadDay(day: string) {
    setErrorMsg(null);
    setLoading(true);

    try {
      const { data: existing, error: exErr } = await supabase
        .from("daily_logs")
        .select("id")
        .eq("user_id", userId!)
        .eq("log_date", day)
        .maybeSingle();

      if (exErr) throw exErr;

      let logId = (existing?.id as string | undefined) ?? undefined;

      if (!logId) {
        const { data: created, error: cErr } = await supabase
          .from("daily_logs")
          .insert({ user_id: userId!, log_date: day })
          .select("id")
          .single();

        if (cErr) throw cErr;
        logId = created.id;
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

      setSuggestOpen(false);
      setNameSuggestions([]);

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

  // ===== Quick Add Autocomplete =====
  async function loadNameSuggestions(query: string) {
    if (!userId) return;

    const token = ++suggestToken.current;
    setSuggestLoading(true);

    try {
      const q = query.trim();
      if (q.length < 2) {
        setNameSuggestions([]);
        return;
      }

      const { data, error } = await supabase
        .from("food_entries")
        .select("id, name, calories, protein_g, carbs_g, fat_g, grams, meal, created_at")
        .eq("user_id", userId)
        .ilike("name", `%${q}%`)
        .order("created_at", { ascending: false })
        .limit(40);

      if (token !== suggestToken.current) return;
      if (error) throw error;

      const list = (data ?? []) as Entry[];

      // dedupe by name, keep newest
      const seen = new Set<string>();
      const deduped: Entry[] = [];
      for (const e of list) {
        const key = normalizeFoodName(e.name);
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(e);
        if (deduped.length >= 10) break;
      }

      setNameSuggestions(deduped);
    } catch {
      setNameSuggestions([]);
    } finally {
      if (token !== suggestToken.current) return;
      setSuggestLoading(false);
    }
  }

  function applySuggestion(e: Entry) {
    setName(e.name ?? "");
    setGrams(e.grams != null ? String(e.grams) : "");
    setCalories(e.calories != null ? String(e.calories) : "");
    setProtein(e.protein_g != null ? String(e.protein_g) : "");
    setCarbs(e.carbs_g != null ? String(e.carbs_g) : "");
    setFat(e.fat_g != null ? String(e.fat_g) : "");
    setMeal((e.meal ?? "Snack") || "Snack");

    setSuggestOpen(false);
    setNameSuggestions([]);
  }

  function closeSuggestionsKeepText() {
    setSuggestOpen(false);
    setNameSuggestions([]);
  }

  // close on outside click
  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const el = suggestWrapRef.current;
      if (!el) return;
      if (el.contains(ev.target as Node)) return;
      closeSuggestionsKeepText();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ===== Quick Copy modal behavior =====
  function openCopyModal() {
    setCopyModalOpen(true);
  }

  function closeCopyModal() {
    setCopyModalOpen(false);
  }

  // Prevent background scroll while modal is open + ESC close
  useEffect(() => {
    if (!copyModalOpen) return;

    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCopyModal();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [copyModalOpen]);

  const copyLoadToken = useRef(0);

  async function loadCopyRange(range: CopyRange) {
    if (!userId) return;

    const token = ++copyLoadToken.current;
    setCopyInfoMsg(null);
    setCopyLoading(true);
    setErrorMsg(null);

    try {
      const now = new Date();
      const end = ymd(now);

      const startDate = new Date(now);
      if (range === "yesterday") startDate.setDate(startDate.getDate() - 1);
      if (range === "week") startDate.setDate(startDate.getDate() - 7);
      if (range === "month") startDate.setDate(startDate.getDate() - 30);

      const start = ymd(startDate);

      const { data: logs, error: logsErr } = await supabase
        .from("daily_logs")
        .select("id, log_date")
        .eq("user_id", userId)
        .gte("log_date", start)
        .lte("log_date", end)
        .order("log_date", { ascending: false });

      if (token !== copyLoadToken.current) return;
      if (logsErr) throw logsErr;

      const logIds = (logs ?? []).map((l: any) => l.id);
      if (logIds.length === 0) {
        setCopyEntries([]);
        setCopySelectedIds({});
        setCopyInfoMsg(`No logs found for ${rangeLabel(range).toLowerCase()}.`);
        return;
      }

      const { data: ents, error: entsErr } = await supabase
        .from("food_entries")
        .select("id, name, calories, protein_g, carbs_g, fat_g, grams, meal, created_at")
        .in("daily_log_id", logIds)
        .order("created_at", { ascending: false });

      if (token !== copyLoadToken.current) return;
      if (entsErr) throw entsErr;

      const list = (ents ?? []) as Entry[];
      setCopyEntries(list);
      setCopySelectedIds({});
      if (list.length === 0) setCopyInfoMsg(`No entries found for ${rangeLabel(range).toLowerCase()}.`);
    } catch (e: any) {
      if (token !== copyLoadToken.current) return;
      setCopyEntries([]);
      setCopySelectedIds({});
      setErrorMsg(e?.message ?? "Error");
    } finally {
      if (token !== copyLoadToken.current) return;
      setCopyLoading(false);
    }
  }

  useEffect(() => {
    if (!userId) return;
    if (!copyModalOpen) return;

    const handle = window.setTimeout(() => {
      void loadCopyRange(copyRange);
    }, 150);

    return () => window.clearTimeout(handle);
  }, [userId, copyModalOpen, copyRange]);

  function toggleCopySelected(id: string) {
    setCopySelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function selectAllVisibleCopy() {
    const next: Record<string, boolean> = { ...copySelectedIds };
    for (const e of filteredCopyEntries) next[e.id] = true;
    setCopySelectedIds(next);
  }

  function clearAllCopy() {
    setCopySelectedIds({});
  }

  async function copySelectedToToday() {
    if (!userId || !dailyLogId) return;

    const selected = copyEntries.filter((e) => !!copySelectedIds[e.id]);
    if (selected.length === 0) {
      setErrorMsg("Select at least one entry to copy.");
      return;
    }

    setErrorMsg(null);
    setCopyInfoMsg(null);
    setCopying(true);

    try {
      const rows = selected.map((e) => ({
        daily_log_id: dailyLogId,
        user_id: userId,
        name: e.name,
        calories: e.calories ?? 0,
        protein_g: e.protein_g ?? 0,
        carbs_g: e.carbs_g ?? 0,
        fat_g: e.fat_g ?? 0,
        grams: e.grams ?? null,
        meal: e.meal ?? "Snack",
      }));

      const { error: insErr } = await supabase.from("food_entries").insert(rows);
      if (insErr) throw insErr;

      await ensureLogAndLoadDay(dateStr);
      setCopySelectedIds({});
      setCopyInfoMsg(`Copied ${rows.length} item${rows.length === 1 ? "" : "s"} to ${dateStr}.`);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error");
    } finally {
      setCopying(false);
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
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Quick add</h2>
          </div>

          <div className={styles.card}>
            <div ref={suggestWrapRef} className={styles.suggestWrap}>
              <input
                className={styles.textInput}
                value={name}
                onChange={(e) => {
                  const v = e.target.value;
                  setName(v);
                  setErrorMsg(null);

                  if (suggestTimer.current) window.clearTimeout(suggestTimer.current);

                  const q = v.trim();
                  if (!userId || q.length < 2) {
                    setSuggestOpen(false);
                    setNameSuggestions([]);
                    return;
                  }

                  setSuggestOpen(true);
                  suggestTimer.current = window.setTimeout(() => {
                    void loadNameSuggestions(q);
                  }, 180);
                }}
                onFocus={() => {
                  const q = name.trim();
                  if (q.length >= 2 && nameSuggestions.length > 0) setSuggestOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    closeSuggestionsKeepText();
                    return;
                  }

                  // ✅ Enter closes suggestions and keeps typed text (no auto-select)
                  if (e.key === "Enter") {
                    e.preventDefault();
                    closeSuggestionsKeepText();
                    return;
                  }
                }}
                placeholder="Food name (fast manual entry)"
              />

              {suggestOpen ? (
                <div className={styles.suggestMenu} role="listbox" aria-label="Previous foods">
                  {suggestLoading ? (
                    <div className={styles.suggestEmpty}>Loading…</div>
                  ) : name.trim().length < 2 ? (
                    <div className={styles.suggestEmpty}>Type at least 2 characters…</div>
                  ) : nameSuggestions.length === 0 ? (
                    <div className={styles.suggestEmpty}>No matches.</div>
                  ) : (
                    nameSuggestions.map((s) => {
                      const kcal = s.calories ?? 0;
                      const p = s.protein_g ?? 0;
                      const c = s.carbs_g ?? 0;
                      const f = s.fat_g ?? 0;
                      const g = s.grams ?? null;

                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={styles.suggestItem}
                          onClick={() => applySuggestion(s)}
                        >
                          <div className={styles.suggestName}>{s.name}</div>
                          <div className={styles.suggestMeta}>
                            {kcal} kcal · P {p} · C {c} · F {f}
                            {g != null ? ` · ${g}g` : ""}
                            {s.meal ? ` · ${s.meal}` : ""}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>

            <div className={styles.formRow}>
              <label className={styles.field}>
                grams (g)
                <input
                  className={styles.numInput}
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  inputMode="numeric"
                  placeholder="g"
                />
              </label>

              <label className={styles.field}>
                kcal
                <input
                  className={styles.numInput}
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  inputMode="numeric"
                />
              </label>

              <label className={styles.field}>
                protein (g)
                <input
                  className={styles.numInput}
                  value={protein}
                  onChange={(e) => setProtein(e.target.value)}
                  inputMode="numeric"
                />
              </label>

              <label className={styles.field}>
                carbs (g)
                <input
                  className={styles.numInput}
                  value={carbs}
                  onChange={(e) => setCarbs(e.target.value)}
                  inputMode="numeric"
                />
              </label>

              <label className={styles.field}>
                fat (g)
                <input
                  className={styles.numInput}
                  value={fat}
                  onChange={(e) => setFat(e.target.value)}
                  inputMode="numeric"
                />
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

              {/* ✅ Buttons together: Add + Quick copy */}
              <div className={styles.quickAddActions}>
                <button className={styles.primaryButton} onClick={addEntry} disabled={loading} type="button">
                  Add
                </button>

                <button
                  className={`${styles.button} ${styles.quickCopyButton}`}
                  onClick={openCopyModal}
                  type="button"
                  disabled={loading || !dailyLogId}
                >
                  Quick copy
                </button>
              </div>
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
                            <button className={styles.button} onClick={() => startEdit(e)} disabled={loading} type="button">
                              Edit
                            </button>
                            <button className={styles.dangerButton} onClick={() => deleteEntry(e.id)} disabled={loading} type="button">
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
                            <button className={styles.primaryButton} onClick={() => saveEdit(e.id)} disabled={loading} type="button">
                              save
                            </button>

                            <button className={styles.button} onClick={cancelEdit} disabled={loading} type="button">
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

      {/* ===== Quick Copy Modal ===== */}
      {copyModalOpen ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCopyModal();
          }}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>Quick copy</div>
                <div className={styles.mutedSmall}>
                  Source: <b>{copySourceText}</b>
                  {selectedCount ? (
                    <>
                      {" "}
                      · Selected: <b>{selectedCount}</b>
                    </>
                  ) : null}
                </div>
              </div>

              <button className={styles.button} onClick={closeCopyModal} type="button">
                Close
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.quickCopyTop}>
                <div className={styles.chipsRow}>
                  {(["yesterday", "week", "month"] as CopyRange[]).map((r) => (
                    <button
                      key={r}
                      className={`${styles.chip} ${copyRange === r ? styles.chipActive : ""}`}
                      onClick={() => setCopyRange(r)}
                      disabled={copyLoading || copying}
                      type="button"
                    >
                      {rangeLabel(r)}
                    </button>
                  ))}
                </div>

                <input
                  className={styles.textInput}
                  value={copySearch}
                  onChange={(e) => setCopySearch(e.target.value)}
                  placeholder="Search food…"
                  disabled={copying}
                />
              </div>

              <div className={styles.chipsRow}>
                {(["All", "Breakfast", "Lunch", "Dinner", "Snack"] as MealFilter[]).map((m) => (
                  <button
                    key={m}
                    className={`${styles.chip} ${copyMealFilter === m ? styles.chipActive : ""}`}
                    onClick={() => setCopyMealFilter(m)}
                    disabled={copying}
                    type="button"
                  >
                    {m}
                  </button>
                ))}

                <div className={styles.chipsSpacer} />

                <button
                  className={styles.button}
                  onClick={selectAllVisibleCopy}
                  disabled={filteredCopyEntries.length === 0 || copyLoading || copying}
                  type="button"
                >
                  Select visible
                </button>

                <button
                  className={styles.button}
                  onClick={clearAllCopy}
                  disabled={selectedCount === 0 || copyLoading || copying}
                  type="button"
                >
                  Clear
                </button>
              </div>

              <div className={styles.modalList}>
                {copyLoading ? <div className={styles.mutedSmall}>Loading…</div> : null}

                {filteredCopyEntries.length === 0 ? (
                  <div className={styles.mutedSmall}>
                    {copyEntries.length === 0 ? "No entries for this range." : "No matches for your filters."}
                  </div>
                ) : (
                  <div className={styles.copyList}>
                    {groupedCopy.map(({ day, entries }) => (
                      <div key={day} className={styles.copyDayGroup}>
                        <div className={styles.copyDayHeader}>{day}</div>

                        {entries.map((e) => {
                          const checked = !!copySelectedIds[e.id];
                          const kcal = e.calories ?? 0;
                          const p = e.protein_g ?? 0;
                          const c = e.carbs_g ?? 0;
                          const f = e.fat_g ?? 0;
                          const g = e.grams ?? null;

                          return (
                            <button
                              key={e.id}
                              type="button"
                              className={`${styles.copyRowItem} ${checked ? styles.copyRowItemActive : ""}`}
                              onClick={() => toggleCopySelected(e.id)}
                              disabled={copyLoading || copying}
                            >
                              <input
                                className={styles.checkbox}
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCopySelected(e.id)}
                                onClick={(ev) => ev.stopPropagation()}
                                disabled={copyLoading || copying}
                                aria-label={`Select ${e.name}`}
                              />

                              <span className={styles.mealBadge}>{e.meal ?? "Snack"}</span>

                              <span className={styles.copyMain}>
                                <span className={styles.copyName}>{e.name}</span>
                                <span className={styles.copyMeta}>
                                  {kcal} kcal · P {p} · C {c} · F {f}
                                  {g != null ? ` · ${g}g` : ""}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.copyFooter}>
                <div className={styles.mutedSmall}>
                  Selected: <b>{selectedCount}</b>
                  {copyInfoMsg ? <span className={styles.copyInfo}> · {copyInfoMsg}</span> : null}
                </div>

                <button
                  className={styles.primaryButton}
                  onClick={copySelectedToToday}
                  disabled={selectedCount === 0 || copyLoading || copying || loading || !dailyLogId}
                  type="button"
                >
                  {copying ? "Copying…" : `Copy selected${selectedCount ? ` (${selectedCount})` : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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