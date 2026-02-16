"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { format } from "date-fns";

type Props = {
  value: string;
  onChange: (val: string) => void;
};

type Pos = { top: number; left: number; openUp: boolean };

export default function DatePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const selected = value ? new Date(value) : undefined;

  const [pos, setPos] = useState<Pos | null>(null);

  useEffect(() => setMounted(true), []);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Close on outside click/tap
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (!t) return;

      const btn = buttonRef.current;
      const pop = popoverRef.current;

      if (btn?.contains(t)) return;
      if (pop?.contains(t)) return;

      setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // Reposition when opened (and on resize/scroll)
  useLayoutEffect(() => {
    if (!open) return;

    function compute() {
      const btn = buttonRef.current;
      if (!btn) return;

      const r = btn.getBoundingClientRect();

      // Approx popover size (DayPicker is usually ~320px wide)
      const popW = 340;
      const popH = 360;

      const pad = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Default open below, aligned to left
      let left = r.left;
      let top = r.bottom + 8;
      let openUp = false;

      // Clamp horizontally so it stays on screen
      left = Math.max(pad, Math.min(left, vw - popW - pad));

      // If not enough space below, open above
      if (top + popH + pad > vh) {
        const aboveTop = r.top - 8 - popH;
        if (aboveTop >= pad) {
          top = aboveTop;
          openUp = true;
        } else {
          // If neither fits fully, clamp vertically too
          top = Math.max(pad, Math.min(top, vh - popH - pad));
        }
      }

      setPos({ top, left, openUp });
    }

    compute();

    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true); // capture nested scroll containers too
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "8px 12px",
          background: "rgba(10, 14, 26, 0.65)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          color: "rgba(231,234,240,0.95)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        📅 {value}
      </button>

      {open && mounted && pos
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                zIndex: 9999,
                width: 340,
                maxWidth: "calc(100vw - 16px)",

                background: "#111827",
                padding: 16,
                borderRadius: 16,
                border: "1px solid #374151",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                overflow: "auto",
                WebkitOverflowScrolling: "touch",
              }}
            >
              <DayPicker
                mode="single"
                selected={selected}
                onSelect={(date) => {
                  if (!date) return;
                  onChange(format(date, "yyyy-MM-dd"));
                  setOpen(false);
                }}
                styles={{
                  caption: { color: "white" },
                  head_cell: { color: "#9CA3AF" },
                  day: { color: "white" },
                  nav_button: { color: "white" },
                }}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
