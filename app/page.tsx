"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/today");
      else router.replace("/login");
    });
  }, [router]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <p>Loading...</p>
    </main>
  );
}
