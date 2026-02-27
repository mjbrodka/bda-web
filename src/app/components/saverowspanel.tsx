import { createClient } from "@/app/lib/supabase/server";

type SavedRow = {
  id: string;
  created_at: string;
  day: number;
  bn: string;
  equipment_type: string;
  on_hand: number;
  destroyed_d1: number;
  destroyed_d2: number;
  destroyed_d3: number;
  destroyed_d4: number;
  destroyed_d5: number;
  daily_attrition_pct: number;
};

export default async function SavedRowsPanel() {
  const supabase = await createClient();

  // NOTE: table name + columns must match your DB.
  // If your table is named differently, change it here only.
  const { data, error } = await supabase
    .from("bda_rows")
    .select(
      "id, created_at, day, bn, equipment_type, on_hand, destroyed_d1, destroyed_d2, destroyed_d3, destroyed_d4, destroyed_d5, daily_attrition_pct"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Saved (Supabase)</h2>

      {error ? (
        <pre style={{ whiteSpace: "pre-wrap", border: "1px solid #444", padding: 12 }}>
          {error.message}
        </pre>
      ) : null}

      <pre style={{ whiteSpace: "pre-wrap", border: "1px solid #444", padding: 12, background: "#0f0f0f" }}>
        {JSON.stringify((data ?? []) as SavedRow[], null, 2)}
      </pre>
    </section>
  );
}