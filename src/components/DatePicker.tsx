"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { format } from "date-fns";

type Props = {
  value: string;
  onChange: (val: string) => void;
};

export default function DatePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const selected = value ? new Date(value) : undefined;

  useEffect(() => {
    setMounted(true);
  }, []);

  const rect = buttonRef.current?.getBoundingClientRect();

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "8px 12px",
          background: "#111827",
          border: "1px solid #374151",
          borderRadius: 12,
          color: "white",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        📅 {value}
      </button>

      {open && mounted && rect
        ? createPortal(
            <div
              style={{
                position: "fixed",
                top: rect.bottom + 8,
                left: rect.left,
                zIndex: 9999,
                background: "#111827",
                padding: 16,
                borderRadius: 16,
                border: "1px solid #374151",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
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
