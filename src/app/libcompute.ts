export type TrackerRow = {
  id: string
  bn: string
  equipmentType: string
  onHand: number
  dailyAttritionPct: number

  // Legacy single-field support (kept for compatibility)
  destroyedManual?: number

  // New: daily manual destroyed (D1..D5)
  destroyedByDay?: number[] // length 5 recommended
}

export type ComputedRow = TrackerRow & {
  destroyedAttrition: number
  destroyed: number // final destroyed (max of manual + attrition if enabled)
  remaining: number
  combatPowerPct: number
  daysTo25Pct: number | null

  // Helpful UI fields
  destroyedManualActive: number // sum applied through selected day
  destroyedManualTotal: number // sum of all D1..D5
}

export type BnSummary = {
  bn: string
  onHand: number
  remaining: number
  destroyed: number
  combatPowerPct: number
  daysTo25Pct: number | null
}

export type GroupKey = "165_BCG" | "OTHER"

export type GroupSummary = {
  group: GroupKey
  onHand: number
  remaining: number
  destroyed: number
  combatPowerPct: number
  daysTo25Pct: number | null
}

const BCG_165_BNS = new Set([
  "1651",
  "1652",
  "1653",
  "1654",
  "1657",
  "1658",
  "1659",
])

// OS/SS must be under 165 per your requirement
const OS_SS_ALIASES = new Set([
  "OS/SS",
  "OSSS",
  "OS-SS",
  "OS & SS",
  "OS AND SS",
])

function normalizeBn(raw: unknown) {
  // normalize spaces, case, and common variants so matching is stable
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")

  // normalize common OS/SS variants to a single canonical token
  if (OS_SS_ALIASES.has(s)) return "OS/SS"

  return s
}

function groupForBn(rawBn: unknown): GroupKey {
  const bn = normalizeBn(rawBn)
  if (bn === "OS/SS") return "165_BCG"
  if (BCG_165_BNS.has(bn)) return "165_BCG"
  return "OTHER"
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function safeNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Compound attrition model:
// remaining = start * (1 - p)^day
function remainingAfterDays(start: number, dailyPct: number, day: number) {
  const p = safeNum(dailyPct) / 100
  const d = Math.max(0, Math.floor(safeNum(day)))
  if (start <= 0) return 0
  if (p <= 0) return start
  if (p >= 1) return 0
  return start * Math.pow(1 - p, d)
}

function daysToReachFraction(dailyPct: number, targetFraction: number): number | null {
  const p = safeNum(dailyPct) / 100

  if (targetFraction <= 0) return 0
  if (targetFraction >= 1) return null
  if (p <= 0) return null
  if (p >= 1) return 0

  const d = Math.log(targetFraction) / Math.log(1 - p)
  if (!Number.isFinite(d) || d < 0) return null
  return Math.ceil(d)
}

function normalizeDestroyedByDay(arr?: number[]) {
  const base = Array.isArray(arr) ? arr : []
  const out = [0, 0, 0, 0, 0].map((_, i) =>
    clamp(Math.round(safeNum(base[i])), 0, Number.MAX_SAFE_INTEGER)
  )
  return out
}

export function computeRows(
  rows: TrackerRow[],
  opts?: { day?: number; useAttrition?: boolean; manualWins?: boolean }
) {
  // Day is 1..5 (no Day 0)
  const dayRaw = Math.floor(safeNum(opts?.day ?? 1))
  const day = clamp(dayRaw, 1, 5)

  const useAttrition = opts?.useAttrition ?? true

  // If true: destroyed = max(manual, attrition) (your UI uses true)
  // If false: destroyed = attrition (when enabled)
  const manualWins = opts?.manualWins ?? true

  const computedRows: ComputedRow[] = rows.map((row) => {
    const onHand = Math.max(0, Math.floor(safeNum(row.onHand)))

    // Manual destroyed (daily) is applied through selected day:
    // Day 1 uses D1, Day 5 uses D1..D5
    let destroyedManualActive = 0
    let destroyedManualTotal = 0

    if (row.destroyedByDay && Array.isArray(row.destroyedByDay)) {
      const byDay = normalizeDestroyedByDay(row.destroyedByDay)
      destroyedManualTotal = byDay.reduce((s, v) => s + v, 0)
      destroyedManualActive = byDay.slice(0, day).reduce((s, v) => s + v, 0)
    } else {
      // Legacy single manual destroyed value (assumed "already confirmed")
      destroyedManualTotal = Math.max(0, Math.floor(safeNum(row.destroyedManual ?? 0)))
      destroyedManualActive = destroyedManualTotal
    }

    const manual = clamp(destroyedManualActive, 0, onHand)

    let destroyedAttrition = 0
    if (useAttrition) {
      const rem = remainingAfterDays(onHand, row.dailyAttritionPct, day)
      destroyedAttrition = clamp(Math.round(onHand - rem), 0, onHand)
    }

    const destroyed = useAttrition
      ? manualWins
        ? Math.max(manual, destroyedAttrition)
        : destroyedAttrition
      : manual

    const remaining = Math.max(0, onHand - destroyed)
    const combatPowerPct = onHand > 0 ? (remaining / onHand) * 100 : 0
    const daysTo25Pct = onHand > 0 ? daysToReachFraction(row.dailyAttritionPct, 0.25) : null

    return {
      ...row,
      bn: normalizeBn(row.bn), // important: canonicalize BN here
      onHand,
      destroyedManual: manual, // keep this field meaningful for downstream display/compat
      destroyedAttrition,
      destroyed,
      remaining,
      combatPowerPct,
      daysTo25Pct,
      destroyedManualActive: manual,
      destroyedManualTotal: clamp(destroyedManualTotal, 0, onHand),
    }
  })

  // BN rollup (by exact canonical BN)
  const bnMap = new Map<string, BnSummary>()

  for (const r of computedRows) {
    const bn = normalizeBn(r.bn)
    if (!bn) continue

    const existing =
      bnMap.get(bn) ??
      ({
        bn,
        onHand: 0,
        remaining: 0,
        destroyed: 0,
        combatPowerPct: 0,
        daysTo25Pct: null,
      } satisfies BnSummary)

    existing.onHand += r.onHand
    existing.remaining += r.remaining
    existing.destroyed += r.destroyed
    bnMap.set(bn, existing)
  }

  const bnSummaries: BnSummary[] = Array.from(bnMap.values()).map((s) => {
    const combatPowerPct = s.onHand > 0 ? (s.remaining / s.onHand) * 100 : 0

    // Weighted attrition estimate for BN days-to-25
    const bnRows = computedRows.filter((r) => normalizeBn(r.bn) === s.bn)
    const totalWeight = bnRows.reduce((sum, r) => sum + r.onHand, 0)
    const weightedAttrition =
      totalWeight > 0
        ? bnRows.reduce((sum, r) => sum + safeNum(r.dailyAttritionPct) * r.onHand, 0) / totalWeight
        : 0

    const daysTo25Pct = s.onHand > 0 ? daysToReachFraction(weightedAttrition, 0.25) : null

    return { ...s, combatPowerPct, daysTo25Pct }
  })

  bnSummaries.sort((a, b) => a.bn.localeCompare(b.bn))

  // Group rollups (165_BCG vs OTHER)
  const groupMap = new Map<GroupKey, GroupSummary>()
  groupMap.set("165_BCG", {
    group: "165_BCG",
    onHand: 0,
    remaining: 0,
    destroyed: 0,
    combatPowerPct: 0,
    daysTo25Pct: null,
  })
  groupMap.set("OTHER", {
    group: "OTHER",
    onHand: 0,
    remaining: 0,
    destroyed: 0,
    combatPowerPct: 0,
    daysTo25Pct: null,
  })

  for (const r of computedRows) {
    const g = groupForBn(r.bn)
    const existing = groupMap.get(g)!
    existing.onHand += r.onHand
    existing.remaining += r.remaining
    existing.destroyed += r.destroyed
  }

  const groupSummaries: GroupSummary[] = Array.from(groupMap.values()).map((g) => {
    g.combatPowerPct = g.onHand > 0 ? (g.remaining / g.onHand) * 100 : 0

    // Weighted attrition estimate for group days-to-25 (weights by onHand)
    const groupRows = computedRows.filter((r) => groupForBn(r.bn) === g.group)
    const totalWeight = groupRows.reduce((sum, r) => sum + r.onHand, 0)
    const weightedAttrition =
      totalWeight > 0
        ? groupRows.reduce((sum, r) => sum + safeNum(r.dailyAttritionPct) * r.onHand, 0) / totalWeight
        : 0

    g.daysTo25Pct = g.onHand > 0 ? daysToReachFraction(weightedAttrition, 0.25) : null
    return g
  })

  groupSummaries.sort((a, b) => a.group.localeCompare(b.group))

  return { computedRows, bnSummaries, groupSummaries, day }
}