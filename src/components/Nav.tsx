"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import styles from "./Nav.module.css";

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
    <div className={styles.nav}>
      <div className={styles.left}>
        <Link className={styles.link} href="/today">
          Today
        </Link>

        <Link className={styles.link} href="/week">
          Week
        </Link>

        <Link className={styles.link} href="/friends">
          Friends
        </Link>
        <Link className={styles.link} href="/group">
          Group
        </Link>
      </div>

      <div className={styles.right}>
        {email && <span className={styles.email}>{email}</span>}
        <button className={styles.logout} onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}
