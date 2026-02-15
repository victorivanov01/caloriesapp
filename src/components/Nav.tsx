"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function Nav() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function logout() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderBottom: "1px solid #ddd" }}>
      <Link href="/today">Today</Link>
      <Link href="/friends">Friends</Link>
      <Link href="/group">Group</Link>
      <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
        {email && <span style={{ color: "#555" }}>{email}</span>}
        <button onClick={logout} style={{ padding: "6px 10px", cursor: "pointer" }}>
          Logout
        </button>
      </div>
    </div>
  );
}
