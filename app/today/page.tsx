"use client";

export const dynamic = "force-dynamic";

import { CSSProperties, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  // joined from daily_logs (optional)
  log_date?: string | null;
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
    return "rgba(16, 185, 129, 0.92)"; // green
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

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function labelRange(range: CopyRange): string {
  if (range === "yesterday") return "Yesterday";
  if (range === "week") return "Past week";
  return "Past month";
}

function computeRangeDates(range: CopyRange) {
  // We include "today - 1" back to N days.
  // yesterday: exactly yesterday
  // week: last 7 days (yesterday back 6 more)
  // month: last 30 days (yesterday back 29 more)
  const end = new Date();
  end.setDate(end.getDate() - 1);

  const start = new Date(end);
  if (range === "yesterday") {
    // same day
  } else if (range === "week") {
    start.setDate(start.getDate() - 6);
  } else {
    start.setDate(start.getDate() - 29);
  }

  return { startStr: ymd(start), endStr: ymd(end) };
}

function compactDays(days: string[]): string {
  if (days.length === 0) return "-";
  const sorted = [...days].sort();
  if (sorted.length <= 3) return sorted.join(", ");
  return `${sorted.slice(0, 3).join(", ")} +${sorted.length - 3}`;
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

  // ===== Quick Copy (Modal) =====
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyRange, setCopyRange] = useState<CopyRange>("yesterday");
  const [copyEntries, setCopyEntries] = useState<Entry[]>([]);
  const [copySelectedGroups, setCopySelectedGroups] = useState<Record<string, boolean>>({});
  const [copyLoading, setCopyLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copySearch, setCopySearch] = useState("");
  const [copyMealFilter, setCopyMealFilter] = useState<MealFilter>("All");
  const [copyInfoMsg, setCopyInfoMsg] = useState<string | null>(null);

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

  // auth (client)
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

  // ===== Quick Copy: load entries for the selected range =====
  const copyLoadToken = useRef(0);

  async function loadCopyRange(range: CopyRange) {
    if (!userId) return;

    const token = ++copyLoadToken.current;

    setCopyInfoMsg(null);
    setCopyLoading(true);
    setErrorMsg(null);

    try {
      const { startStr, endStr } = computeRangeDates(range);

      // 1) find daily_logs in date range
      const { data: logs, error: logsErr } = await supabase
        .from("daily_logs")
        .select("id, log_date")
        .eq("user_id", userId)
        .gte("log_date", startStr)
        .lte("log_date", endStr)
        .order("log_date", { ascending: false });

      if (token !== copyLoadToken.current) return;
      if (logsErr) throw logsErr;

      const logRows = (logs ?? []) as { id: string; log_date: string }[];
      const ids = logRows.map((l) => l.id);

      if (ids.length === 0) {
        setCopyEntries([]);
        setCopySelectedGroups({});
        setCopyInfoMsg(`No logs found in ${labelRange(range).toLowerCase()}.`);
        return;
      }

      // map daily_log_id -> log_date for labeling
      const logDateById = new Map<string, string>();
      for (const l of logRows) logDateById.set(l.id, l.log_date);

      // 2) load all food entries for those logs
      const { data: ents, error: entsErr } = await supabase
        .from("food_entries")
        .select("id, name, calories, protein_g, carbs_g, fat_g, grams, meal, created_at, daily_log_id")
        .in("daily_log_id", ids)
        .order("created_at", { ascending: true });

      if (token !== copyLoadToken.current) return;
      if (entsErr) throw entsErr;

      const listRaw = (ents ?? []) as (Entry & { daily_log_id: string })[];

      // attach log_date for display/group info
      const list: Entry[] = listRaw.map((e) => ({
        id: e.id,
        name: e.name,
        calories: e.calories ?? 0,
        protein_g: e.protein_g ?? 0,
        carbs_g: e.carbs_g ?? 0,
        fat_g: e.fat_g ?? 0,
        grams: e.grams ?? null,
        meal: e.meal ?? "Snack",
        created_at: e.created_at,
        log_date: logDateById.get((e as any).daily_log_id) ?? null,
      }));

      setCopyEntries(list);
      setCopySelectedGroups({});
      if (list.length === 0) setCopyInfoMsg(`No entries found in ${labelRange(range).toLowerCase()}.`);
    } catch (e: any) {
      if (token !== copyLoadToken.current) return;
      setCopyEntries([]);
      setCopySelectedGroups({});
      setErrorMsg(e?.message ?? "Error");
    } finally {
      if (token !== copyLoadToken.current) return;
      setCopyLoading(false);
    }
  }

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
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

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

  // load when modal opens or range changes
  useEffect(() => {
    if (!userId) return;
    if (!copyModalOpen) return;

    const handle = window.setTimeout(() => {
      void loadCopyRange(copyRange);
    }, 150);

    return () => window.clearTimeout(handle);
  }, [userId, copyModalOpen, copyRange]);

  // Filter (meal + search), then GROUP BY NAME (Option A)
  const groupedCopy = useMemo(() => {
    const q = copySearch.trim().toLowerCase();

    const filtered = copyEntries.filter((e) => {
      if (copyMealFilter !== "All" && (e.meal ?? "") !== copyMealFilter) return false;
      if (!q) return true;
      return (e.name ?? "").toLowerCase().includes(q);
    });

    type Group = {
      key: string; // normalized
      displayName: string;
      entries: Entry[];
      count: number;
      kcal: number;
      p: number;
      c: number;
      f: number;
      grams: number;
      meals: string[]; // unique
      days: string[]; // unique
    };

    const map = new Map<string, Group>();

    for (const e of filtered) {
      const key = normalizeName(e.name ?? "");
      if (!key) continue;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          displayName: e.name ?? "",
          entries: [e],
          count: 1,
          kcal: e.calories ?? 0,
          p: e.protein_g ?? 0,
          c: e.carbs_g ?? 0,
          f: e.fat_g ?? 0,
          grams: e.grams ?? 0,
          meals: e.meal ? [e.meal] : [],
          days: e.log_date ? [e.log_date] : [],
        });
      } else {
        existing.entries.push(e);
        existing.count += 1;
        existing.kcal += e.calories ?? 0;
        existing.p += e.protein_g ?? 0;
        existing.c += e.carbs_g ?? 0;
        existing.f += e.fat_g ?? 0;
        existing.grams += e.grams ?? 0;

        if (e.meal && !existing.meals.includes(e.meal)) existing.meals.push(e.meal);
        if (e.log_date && !existing.days.includes(e.log_date)) existing.days.push(e.log_date);
      }
    }

    const groups = Array.from(map.values());

    // sort: most recent group first (based on latest created_at in group)
    groups.sort((a, b) => {
      const aLatest = a.entries.reduce((mx, e) => (e.created_at > mx ? e.created_at : mx), a.entries[0]?.created_at ?? "");
      const bLatest = b.entries.reduce((mx, e) => (e.created_at > mx ? e.created_at : mx), b.entries[0]?.created_at ?? "");
      return bLatest.localeCompare(aLatest);
    });

    return groups;
  }, [copyEntries, copyMealFilter, copySearch]);

  const selectedCount = useMemo(
    () => Object.values(copySelectedGroups).filter(Boolean).length,
    [copySelectedGroups]
  );

  function toggleCopyGroup(key: string) {
    setCopySelectedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function selectAllVisibleCopy() {
    const next: Record<string, boolean> = { ...copySelectedGroups };
    for (const g of groupedCopy) next[g.key] = true;
    setCopySelectedGroups(next);
  }

  function clearAllCopy() {
    setCopySelectedGroups({});
  }

  async function copySelectedToToday() {
    if (!userId || !dailyLogId) return;

    const selectedGroups = groupedCopy.filter((g) => !!copySelectedGroups[g.key]);
    if (selectedGroups.length === 0) {
      setErrorMsg("Select at least one item to copy.");
      return;
    }

    setErrorMsg(null);
    setCopyInfoMsg(null);
    setCopying(true);

    try {
      // Option A behavior: selecting a grouped name copies ALL entries in that group
      const rows = selectedGroups.flatMap((g) =>
        g.entries.map((e) => ({
          daily_log_id: dailyLogId,
          user_id: userId,
          name: e.name,
          calories: e.calories ?? 0,
          protein_g: e.protein_g ?? 0,
          carbs_g: e.carbs_g ?? 0,
          fat_g: e.fat_g ?? 0,
          grams: e.grams ?? null,
          meal: e.meal ?? "Snack",
        }))
      );

      const { error: insErr } = await supabase.from("food_entries").insert(rows);
      if (insErr) throw insErr;

      await ensureLogAndLoadDay(dateStr);
      setCopySelectedGroups({});

      setCopyInfoMsg(`Copied ${rows.length} entr${rows.length === 1 ? "y" : "ies"} from ${labelRange(copyRange).toLowerCase()}.`);
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
                      } as CSSProperties
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
                      } as CSSProperties
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

            <button className={styles.button} onClick={openCopyModal} type="button" disabled={loading || !dailyLogId}>
              Quick copy
            </button>
          </div>

          <div className={styles.card}>
            <input
              className={styles.textInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Food name (fast manual entry)"
            />

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
                  Source: <b>{labelRange(copyRange)}</b>
                  {selectedCount ? (
                    <>
                      {" "}
                      · Selected groups: <b>{selectedCount}</b>
                    </>
                  ) : null}
                </div>
              </div>

              <button className={styles.button} onClick={closeCopyModal} type="button">
                Close
              </button>
            </div>

            <div className={styles.modalBody}>
              {/* Range buttons (no date list on the left) */}
              <div className={styles.chipsRow}>
                <button
                  className={`${styles.chip} ${copyRange === "yesterday" ? styles.chipActive : ""}`}
                  onClick={() => setCopyRange("yesterday")}
                  disabled={copying}
                  type="button"
                >
                  Yesterday
                </button>
                <button
                  className={`${styles.chip} ${copyRange === "week" ? styles.chipActive : ""}`}
                  onClick={() => setCopyRange("week")}
                  disabled={copying}
                  type="button"
                >
                  Past week
                </button>
                <button
                  className={`${styles.chip} ${copyRange === "month" ? styles.chipActive : ""}`}
                  onClick={() => setCopyRange("month")}
                  disabled={copying}
                  type="button"
                >
                  Past month
                </button>

                <div className={styles.chipsSpacer} />

                <button
                  className={styles.button}
                  onClick={selectAllVisibleCopy}
                  disabled={groupedCopy.length === 0 || copyLoading || copying}
                  type="button"
                >
                  Select visible
                </button>

                <button className={styles.button} onClick={clearAllCopy} disabled={selectedCount === 0 || copyLoading || copying} type="button">
                  Clear
                </button>
              </div>

              <input
                className={styles.textInput}
                value={copySearch}
                onChange={(e) => setCopySearch(e.target.value)}
                placeholder="Search food…"
                disabled={copying}
              />

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
              </div>

              <div className={styles.modalList}>
                {copyLoading ? <div className={styles.mutedSmall}>Loading…</div> : null}

                {groupedCopy.length === 0 ? (
                  <div className={styles.mutedSmall}>
                    {copyEntries.length === 0 ? "No entries for this range." : "No matches for your filters."}
                  </div>
                ) : (
                  <div className={styles.copyList}>
                    {groupedCopy.map((g) => {
                      const checked = !!copySelectedGroups[g.key];

                      const mealsLabel = g.meals.length ? g.meals.join(", ") : "-";
                      const daysLabel = compactDays(g.days);

                      return (
                        <button
                          key={g.key}
                          type="button"
                          className={`${styles.copyRowItem} ${checked ? styles.copyRowItemActive : ""}`}
                          onClick={() => toggleCopyGroup(g.key)}
                          disabled={copyLoading || copying}
                        >
                          <input
                            className={styles.checkbox}
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCopyGroup(g.key)}
                            onClick={(ev) => ev.stopPropagation()}
                            disabled={copyLoading || copying}
                            aria-label={`Select ${g.displayName}`}
                          />

                          <span className={styles.mealBadge}>{g.count}x</span>

                          <span className={styles.copyMain}>
                            <span className={styles.copyName}>{g.displayName}</span>
                            <span className={styles.copyMeta}>
                              {g.kcal} kcal · P {g.p} · C {g.c} · F {g.f}
                              {g.grams ? ` · ${g.grams}g` : ""}
                              {" · "}
                              Meals: {mealsLabel}
                              {" · "}
                              Days: {daysLabel}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className={styles.copyFooter}>
                <div className={styles.mutedSmall}>
                  Selected groups: <b>{selectedCount}</b>
                  {copyInfoMsg ? <span className={styles.copyInfo}> · {copyInfoMsg}</span> : null}
                </div>

                <button
                  className={styles.primaryButton}
                  onClick={copySelectedToToday}
                  disabled={selectedCount === 0 || copyLoading || copying || loading || !dailyLogId}
                  type="button"
                >
                  {copying ? "Copying…" : `Copy selected`}
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