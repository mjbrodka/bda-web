"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

import { createClient } from "@/app/lib/supabase/client";
import { computeRows, type TrackerRow } from "./libcompute";

function normalizeKey(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[%]/g, "%");
}

function getCell(row: any, keys: string[]) {
  const map = new Map<string, any>();
  for (const k of Object.keys(row || {})) map.set(normalizeKey(k), row[k]);
  for (const want of keys) {
    const v = map.get(normalizeKey(want));
    if (v !== undefined) return v;
  }
  return undefined;
}

function clampInt(n: any, min: number, max: number) {
  const x = Math.floor(Number(n) || 0);
  return Math.max(min, Math.min(max, x));
}

function normalizeDestroyedByDay(arr?: number[]) {
  const base = Array.isArray(arr) ? arr : [];
  return [0, 0, 0, 0, 0].map((_, i) => Math.max(0, Math.floor(Number(base[i] || 0))));
}

/**
 * Infer constant daily attrition % that matches the cumulative destroyed-through-day.
 * Compound model: remaining = onHand*(1-p)^day
 */
function inferDailyAttritionPct(onHand: number, destroyedByDay: number[], day: number) {
  const oh = Math.max(0, Math.floor(Number(onHand) || 0));
  const d = clampInt(day, 1, 5);
  if (oh <= 0) return 0;

  const byDay = normalizeDestroyedByDay(destroyedByDay);
  const cumDestroyed = byDay.slice(0, d).reduce((s, v) => s + v, 0);
  const remaining = Math.max(0, oh - cumDestroyed);

  const frac = remaining / oh;
  if (frac <= 0) return 100;
  if (frac >= 1) return 0;

  const p = 1 - Math.pow(frac, 1 / d);
  return Math.max(0, Math.min(100, p * 100));
}

function newRow(day: number): TrackerRow {
  const destroyedByDay = [0, 0, 0, 0, 0];
  return {
    id: crypto.randomUUID(),
    bn: "",
    equipmentType: "",
    onHand: 0,
    destroyedByDay,
    dailyAttritionPct: inferDailyAttritionPct(0, destroyedByDay, day),
  };
}

type TrackerState = {
  day: number;
  useAttrition: boolean;
  rows: TrackerRow[];
};

const DEFAULT_STATE: TrackerState = {
  day: 1,
  useAttrition: true,
  rows: [
    {
      id: "1",
      bn: "1651",
      equipmentType: "Type 96 MBT",
      onHand: 44,
      destroyedByDay: [0, 1, 0, 0, 0],
      dailyAttritionPct: inferDailyAttritionPct(44, [0, 1, 0, 0, 0], 1),
    },
    {
      id: "2",
      bn: "1651",
      equipmentType: "Type 99 MBT",
      onHand: 33,
      destroyedByDay: [0, 0, 2, 0, 0],
      dailyAttritionPct: inferDailyAttritionPct(33, [0, 0, 2, 0, 0], 1),
    },
    {
      id: "3",
      bn: "1652",
      equipmentType: "Type 96 MBT",
      onHand: 44,
      destroyedByDay: [1, 0, 0, 0, 0],
      dailyAttritionPct: inferDailyAttritionPct(44, [1, 0, 0, 0, 0], 1),
    },
  ],
};

export default function Home() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [day, setDay] = useState<number>(DEFAULT_STATE.day);
  const [useAttrition, setUseAttrition] = useState<boolean>(DEFAULT_STATE.useAttrition);
  const [rows, setRows] = useState<TrackerRow[]>(DEFAULT_STATE.rows);

  const [isDragging, setIsDragging] = useState(false);

  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");

  // ---- LOAD on mount ----
  useEffect(() => {
    (async () => {
      setStatus("Loading…");

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      const authed = !!authData?.user && !authErr;
      setIsAuthed(authed);

      if (!authed) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .from("global_tracker_state")
        .select("state")
        .eq("id", 1)
        .maybeSingle();

      if (error) {
        setStatus(`Load failed: ${error.message}`);
        return;
      }

      if (!data?.state) {
        setStatus("No global state yet.");
        return;
      }

      const st = data.state as Partial<TrackerState>;
      const nextDay = clampInt(st.day ?? 1, 1, 5);
      const nextUse = Boolean(st.useAttrition ?? true);
      const nextRows = Array.isArray(st.rows) ? (st.rows as TrackerRow[]) : [];

      const normalizedRows = nextRows.map((r) => {
        const byDay = normalizeDestroyedByDay(r.destroyedByDay);
        const onHand = Number((r as any).onHand) || 0;
        return {
          ...r,
          id: (r as any).id || crypto.randomUUID(),
          bn: String((r as any).bn || ""),
          equipmentType: String((r as any).equipmentType || ""),
          onHand,
          destroyedByDay: byDay,
          dailyAttritionPct: inferDailyAttritionPct(onHand, byDay, nextDay),
        };
      });

      setDay(nextDay);
      setUseAttrition(nextUse);
      setRows(normalizedRows);
      setStatus("Loaded global tracker.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- compute ----
  const { bnSummaries, computedRows } = useMemo(
    () => computeRows(rows, { day, useAttrition, manualWins: true }),
    [rows, day, useAttrition]
  );

  const bcgTotals = useMemo(() => {
    const onHand = computedRows.reduce((s, r) => s + (Number(r.onHand) || 0), 0);
    const remaining = computedRows.reduce((s, r) => s + (Number(r.remaining) || 0), 0);
    const destroyed = computedRows.reduce((s, r) => s + (Number(r.destroyed) || 0), 0);
    const combatPowerPct = onHand > 0 ? (remaining / onHand) * 100 : 0;
    return { onHand, remaining, destroyed, combatPowerPct };
  }, [computedRows]);

  const bcgRemPct = bcgTotals.onHand > 0 ? (bcgTotals.remaining / bcgTotals.onHand) * 100 : 0;
  const bcgDesPct = bcgTotals.onHand > 0 ? (bcgTotals.destroyed / bcgTotals.onHand) * 100 : 0;

  // ---- setters that keep attrition inference consistent ----
  function setDayAndRecalc(nextDay: number | string) {
    const d = clampInt(nextDay, 1, 5);
    setDay(d);
    setRows((prev) =>
      prev.map((r) => {
        const byDay = normalizeDestroyedByDay(r.destroyedByDay);
        const pct = inferDailyAttritionPct(r.onHand, byDay, d);
        return { ...r, destroyedByDay: byDay, dailyAttritionPct: pct };
      })
    );
  }

  function updateRow(id: string, patch: Partial<TrackerRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next: TrackerRow = { ...r, ...patch };
        const byDay = normalizeDestroyedByDay(next.destroyedByDay);
        const pct = inferDailyAttritionPct(next.onHand, byDay, day);
        return { ...next, destroyedByDay: byDay, dailyAttritionPct: pct };
      })
    );
  }

  function updateDestroyedByDay(id: string, idx: number, value: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const byDay = normalizeDestroyedByDay(r.destroyedByDay);
        byDay[idx] = Math.max(0, Math.floor(Number(value) || 0));
        const pct = inferDailyAttritionPct(r.onHand, byDay, day);
        return { ...r, destroyedByDay: byDay, dailyAttritionPct: pct };
      })
    );
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  // ---- SAVE ----
  async function saveNow() {
    if (!isAuthed) {
      router.replace("/login");
      return;
    }
    setStatus("Saving…");

    const state: TrackerState = { day, useAttrition, rows };

    const { error } = await supabase.from("global_tracker_state").upsert(
      {
        id: 1,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      setStatus(`Save failed: ${error.message}`);
      return;
    }
    setStatus("Saved (global).");
  }

  // Optional: autosave (debounced)
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!isAuthed) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);

    saveTimer.current = window.setTimeout(() => {
      supabase
        .from("global_tracker_state")
        .upsert(
          { id: 1, state: { day, useAttrition, rows }, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        )
        .then(({ error }) => {
          if (error) setStatus(`Autosave failed: ${error.message}`);
          else setStatus("Autosaved (global).");
        });
    }, 800);

    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [isAuthed, day, useAttrition, rows, supabase]);

  // ---- EXPORT excel ----
  function exportExcel() {
    const header = [
      "BN",
      "Equipment Type",
      "On Hand",
      "Destroyed D1",
      "Destroyed D2",
      "Destroyed D3",
      "Destroyed D4",
      "Destroyed D5",
    ];

    const data = rows.map((r) => {
      const d = normalizeDestroyedByDay(r.destroyedByDay);
      return {
        BN: r.bn ?? "",
        "Equipment Type": r.equipmentType ?? "",
        "On Hand": Number(r.onHand) || 0,
        "Destroyed D1": d[0] || 0,
        "Destroyed D2": d[1] || 0,
        "Destroyed D3": d[2] || 0,
        "Destroyed D4": d[3] || 0,
        "Destroyed D5": d[4] || 0,
      };
    });

    const ws = XLSX.utils.json_to_sheet(data, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BDA");

    const name = `bda_tracker_day${day}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, name);
  }

  // ---- import excel ----
  async function importExcel(file: File, mode: "replace" | "append") {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      alert("Upload a .xlsx Excel file only.");
      return;
    }
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const parsed: TrackerRow[] = json
      .map((r) => {
        const bn = String(getCell(r, ["BN", "Bn", "bn", "Battalion", "Unit"]) ?? "").trim();
        const equipmentType = String(
          getCell(r, ["Equipment Type", "Equipment", "equipment type", "equipment"]) ?? ""
        ).trim();
        const onHand = Number(getCell(r, ["On Hand", "OnHand", "on hand"]) ?? 0) || 0;

        const d1 =
          Number(getCell(r, ["Destroyed D1", "Destroyed Day 1", "D1", "Day 1 Destroyed", "Destroyed 1"]) ?? 0) || 0;
        const d2 =
          Number(getCell(r, ["Destroyed D2", "Destroyed Day 2", "D2", "Day 2 Destroyed", "Destroyed 2"]) ?? 0) || 0;
        const d3 =
          Number(getCell(r, ["Destroyed D3", "Destroyed Day 3", "D3", "Day 3 Destroyed", "Destroyed 3"]) ?? 0) || 0;
        const d4 =
          Number(getCell(r, ["Destroyed D4", "Destroyed Day 4", "D4", "Day 4 Destroyed", "Destroyed 4"]) ?? 0) || 0;
        const d5 =
          Number(getCell(r, ["Destroyed D5", "Destroyed Day 5", "D5", "Day 5 Destroyed", "Destroyed 5"]) ?? 0) || 0;

        const destroyedLegacy = Number(getCell(r, ["Destroyed", "destroyed"]) ?? 0) || 0;

        if (!bn && !equipmentType) return null;

        const dailySum = d1 + d2 + d3 + d4 + d5;
        const destroyedByDay = dailySum > 0 ? [d1, d2, d3, d4, d5] : [destroyedLegacy, 0, 0, 0, 0];
        const byDay = normalizeDestroyedByDay(destroyedByDay);

        return {
          id: crypto.randomUUID(),
          bn,
          equipmentType,
          onHand,
          destroyedByDay: byDay,
          dailyAttritionPct: inferDailyAttritionPct(onHand, byDay, day),
        } as TrackerRow;
      })
      .filter(Boolean) as TrackerRow[];

    if (parsed.length === 0) {
      alert("No usable rows found. Make sure your sheet has BN and Equipment Type columns.");
      return;
    }

    setRows((prev) => (mode === "replace" ? parsed : [...prev, ...parsed]));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) importExcel(file, "replace");
  }

  return (
    <main style={{ padding: 20, maxWidth: 1200 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>BDA Tracker</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontFamily: "monospace", opacity: 0.8 }}>{status}</div>

          <button onClick={saveNow} disabled={!isAuthed}>
            Save
          </button>

          <button onClick={exportExcel} disabled={rows.length === 0}>
            Export (.xlsx)
          </button>
        </div>
      </div>

      {/* Upload */}
      <h2>Upload Excel (.xlsx)</h2>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={onDrop}
        style={{
          border: "2px dashed #666",
          padding: 20,
          marginBottom: 20,
          background: isDragging ? "#222" : "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>Drag & drop .xlsx here</div>

          <label style={{ marginLeft: "auto" }}>
            <input
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importExcel(file, "replace");
                e.currentTarget.value = "";
              }}
            />
            <span style={{ padding: "6px 10px", border: "1px solid #666", cursor: "pointer" }}>Browse…</span>
          </label>

          <button
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".xlsx";
              input.onchange = () => {
                const file = input.files?.[0];
                if (file) importExcel(file, "append");
              };
              input.click();
            }}
          >
            Append
          </button>
        </div>

        <div style={{ marginTop: 8, fontFamily: "monospace", opacity: 0.8 }}>
          Columns expected: BN | Equipment Type | On Hand | Destroyed D1..D5 (or Destroyed)
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ width: 60 }}>Day</div>
          <input type="range" min={1} max={5} value={day} onChange={(e) => setDayAndRecalc(e.target.value)} />
          <div style={{ width: 70, textAlign: "right" }}>Day {day}</div>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={useAttrition} onChange={(e) => setUseAttrition(e.target.checked)} />
          Apply attrition over time
        </label>
      </div>

      {/* BCG Total Bar */}
      <h2>BCG Total Combat Power</h2>
      <div style={{ marginBottom: 18 }}>
        {computedRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No BDA data yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 320px", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>BCG</div>
            <div style={{ height: 18, border: "1px solid #444", display: "flex", overflow: "hidden", background: "#111" }}>
              <div style={{ width: `${bcgRemPct}%`, background: "#1f8f3a" }} />
              <div style={{ width: `${bcgDesPct}%`, background: "#b3261e" }} />
            </div>
            <div style={{ fontFamily: "monospace" }}>
              CP {bcgTotals.combatPowerPct.toFixed(1)}% | Rem {bcgTotals.remaining} | Des {bcgTotals.destroyed}
            </div>
          </div>
        )}
      </div>

      {/* BN Combat Power */}
      <h2>BN Combat Power</h2>
      <div style={{ marginBottom: 10 }}>
        {bnSummaries.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No BN data yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {bnSummaries.map((bn) => {
              const total = bn.onHand || 0;
              const remPct = total > 0 ? (bn.remaining / total) * 100 : 0;
              const desPct = total > 0 ? (bn.destroyed / total) * 100 : 0;
              return (
                <div
                  key={bn.bn}
                  style={{ display: "grid", gridTemplateColumns: "90px 1fr 320px", gap: 10, alignItems: "center" }}
                >
                  <div style={{ fontWeight: 600 }}>{bn.bn}</div>
                  <div style={{ height: 18, border: "1px solid #444", display: "flex", overflow: "hidden", background: "#111" }}>
                    <div style={{ width: `${remPct}%`, background: "#1f8f3a" }} />
                    <div style={{ width: `${desPct}%`, background: "#b3261e" }} />
                  </div>
                  <div style={{ fontFamily: "monospace" }}>
                    CP {bn.combatPowerPct.toFixed(1)}% | Rem {bn.remaining} | Des {bn.destroyed}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Row actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 12 }}>
        <button onClick={() => setRows((p) => [...p, newRow(day)])}>+ Add Row</button>
        <button onClick={() => setRows([])}>Clear</button>
      </div>

      {/* Input Rows */}
      <h2>Input Rows</h2>
      <table border={1} cellPadding={6} style={{ width: "100%", marginBottom: 18 }}>
        <thead>
          <tr>
            <th style={{ width: 90 }}>BN</th>
            <th>Equipment Type</th>
            <th style={{ width: 90 }}>On Hand</th>
            <th style={{ width: 90 }}>D1</th>
            <th style={{ width: 90 }}>D2</th>
            <th style={{ width: 90 }}>D3</th>
            <th style={{ width: 90 }}>D4</th>
            <th style={{ width: 90 }}>D5</th>
            <th style={{ width: 130 }}>Total Destroyed</th>
            <th style={{ width: 140 }}>Daily Attrition %</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = normalizeDestroyedByDay(r.destroyedByDay);
            const totalDestroyed = d.reduce((s, v) => s + v, 0);
            const inferred = inferDailyAttritionPct(r.onHand, d, day);
            return (
              <tr key={r.id}>
                <td>
                  <input value={r.bn} onChange={(e) => updateRow(r.id, { bn: e.target.value })} style={{ width: "100%" }} />
                </td>
                <td>
                  <input
                    value={r.equipmentType}
                    onChange={(e) => updateRow(r.id, { equipmentType: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={r.onHand}
                    onChange={(e) => updateRow(r.id, { onHand: Number(e.target.value) })}
                    style={{ width: "100%" }}
                  />
                </td>
                {[0, 1, 2, 3, 4].map((idx) => (
                  <td key={idx}>
                    <input
                      type="number"
                      min={0}
                      value={d[idx] ?? 0}
                      onChange={(e) => updateDestroyedByDay(r.id, idx, Number(e.target.value))}
                      style={{ width: "100%" }}
                    />
                  </td>
                ))}
                <td style={{ fontFamily: "monospace", textAlign: "right" }}>{totalDestroyed}</td>
                <td style={{ fontFamily: "monospace", textAlign: "right" }}>{inferred.toFixed(2)}%</td>
                <td>
                  <button onClick={() => deleteRow(r.id)}>Delete</button>
                </td>
              </tr>
            );
          })}

          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} style={{ textAlign: "center", opacity: 0.8 }}>
                No rows. Click “Add Row”.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* BN Summary */}
      <h2>BN Summary</h2>
      <table border={1} cellPadding={6} style={{ width: 860, marginBottom: 18 }}>
        <thead>
          <tr>
            <th>BN</th>
            <th>On Hand</th>
            <th>Remaining</th>
            <th>Destroyed</th>
            <th>Combat Power %</th>
            <th>Days to 25%</th>
          </tr>
        </thead>
        <tbody>
          {bnSummaries.map((bn) => (
            <tr key={bn.bn}>
              <td>{bn.bn}</td>
              <td>{bn.onHand}</td>
              <td>{bn.remaining}</td>
              <td>{bn.destroyed}</td>
              <td>{bn.combatPowerPct.toFixed(1)}%</td>
              <td>{bn.daysTo25Pct ?? "N/A"}</td>
            </tr>
          ))}
          {bnSummaries.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", opacity: 0.8 }}>
                No BN data yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* Computed Rows */}
      <h2>Computed Rows</h2>
      <table border={1} cellPadding={6} style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>BN</th>
            <th>Equipment</th>
            <th>On Hand</th>
            <th>Manual (Active)</th>
            <th>Manual (Total)</th>
            <th>Destroyed (Attrition)</th>
            <th>Destroyed (Final)</th>
            <th>Remaining</th>
            <th>Combat Power %</th>
            <th>Days to 25%</th>
          </tr>
        </thead>
        <tbody>
          {computedRows.map((r) => (
            <tr key={r.id}>
              <td>{r.bn || "UNSPECIFIED"}</td>
              <td>{r.equipmentType || "-"}</td>
              <td>{r.onHand}</td>
              <td>{r.destroyedManualActive}</td>
              <td>{r.destroyedManualTotal}</td>
              <td>{r.destroyedAttrition}</td>
              <td>{r.destroyed}</td>
              <td>{r.remaining}</td>
              <td>{r.combatPowerPct.toFixed(1)}%</td>
              <td>{r.daysTo25Pct ?? "N/A"}</td>
            </tr>
          ))}
          {computedRows.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ textAlign: "center", opacity: 0.8 }}>
                No computed rows yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}