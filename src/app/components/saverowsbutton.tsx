"use client";

import React, { useMemo, useState } from "react";
import { createClient } from "@/app/lib/supabase/client";
import type { TrackerRow } from "../libcompute";

function normalizeDestroyedByDay(arr?: number[]) {
  const base = Array.isArray(arr) ? arr : [];
  const out = [0, 0, 0, 0, 0].map((_, i) =>
    Math.max(0, Math.floor(Number(base[i] || 0)))
  );
  return out;
}

export default function SaveRowsButton({
  rows,
  day,
}: {
  rows: TrackerRow[];
  day: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    setSaving(true);

    try {
      // Ensure we have a session (you already guard auth on the page,
      // but this keeps the button self-contained)
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Not signed in.");

      const payload = rows
        .map((r) => {
          const bn = String(r.bn || "").trim();
          const equipment = String(r.equipmentType || "").trim();
          if (!bn && !equipment) return null;

          const d = normalizeDestroyedByDay(r.destroyedByDay);

          return {
            day: Number(day) || 1,
            bn,
            equipment_type: equipment,
            on_hand: Math.max(0, Math.floor(Number(r.onHand) || 0)),
            destroyed_d1: d[0],
            destroyed_d2: d[1],
            destroyed_d3: d[2],
            destroyed_d4: d[3],
            destroyed_d5: d[4],
            daily_attrition_pct: Number(r.dailyAttritionPct) || 0,
          };
        })
        .filter(Boolean) as any[];

      if (payload.length === 0) {
        setMsg("No usable rows to save.");
        return;
      }

      // APPEND save (insert) — does not overwrite existing saved data
      const { error } = await supabase.from("bda_rows").insert(payload);

      if (error) throw new Error(error.message);

      setMsg(`Saved ${payload.length} rows.`);
      // You can refresh the page to force server component to re-read latest
      // but in Next App Router, router.refresh() must be called from a component with useRouter.
      // We'll keep it simple: user can see success message; optional add below if you want.
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <button onClick={save} disabled={saving} style={{ padding: "8px 12px" }}>
        {saving ? "Saving…" : "Save to Supabase"}
      </button>
      {msg ? <div style={{ fontFamily: "monospace", opacity: 0.9 }}>{msg}</div> : null}
    </div>
  );
}