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

export type GroupKey = "163_BCG" | "165_BCG" | "OTHER"

export type GroupSummary = {
  group: GroupKey
  onHand: number
  remaining: number
  destroyed: number
  combatPowerPct: number
  daysTo25Pct: number | null
}

/**
 * Canonicalize BN labels so grouping works:
 * - "1651 AR" -> "1651"
 * - "1634 IN" -> "1634"
 * - "165 OS/SS BN", "165 OSSS", "165 OS-SS" -> "165 OS/SS"
 * - "163 OS/SS BN", "163 OSSS", "163 OS-SS" -> "163 OS/SS"
 *
 * Important:
 * - Bare "OS/SS" remains "OS/SS"
 * - Bare "OS/SS" does NOT roll into 163 or 165
 * - This forces the user to specify brigade ownership explicitly
 */
function normalizeBn(raw: unknown) {
  let s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, " ")
  if (!s) return ""

  // Normalize slashes for consistency
  s = s.replace(/\\/g, "/")

  // 1) Brigade-prefixed OS/SS variants
  const prefixedOsSsMatch = s.match(
    /^(\d{3})\s*[- ]?\s*(OS\/SS|OSSS|OS-SS|OS\s*&\s*SS|OS\s+AND\s+SS)(?:\s*BN)?$/i
  )
  if (prefixedOsSsMatch) {
    return `${prefixedOsSsMatch[1]} OS/SS`
  }

  // Catch compact forms with spaces removed:
  // 165OSSS, 165OS/SSBN, 163OSANDSS
  const sNoSpace = s.replace(/\s+/g, "")
  const prefixedCompactMatch = sNoSpace.match(
    /^(\d{3})(OS\/SS|OSSS|OS-SS|OS&SS|OSANDSS)(BN)?$/i
  )
  if (prefixedCompactMatch) {
    return `${prefixedCompactMatch[1]} OS/SS`
  }

  // 2) Bare legacy OS/SS variants
  if (
    sNoSpace === "OS/SS" ||
    sNoSpace === "OS/SSBN" ||
    sNoSpace === "OSSS" ||
    sNoSpace === "OSSSBN" ||
    sNoSpace === "OS-SS" ||
    sNoSpace === "OS-SSBN" ||
    sNoSpace === "OS&SS" ||
    sNoSpace === "OSANDSS" ||
    sNoSpace === "OSANDSSBN"
  ) {
    return "OS/SS"
  }
  if (/^OS\s*[-/&]?\s*SS(\s*BN)?$/i.test(s)) return "OS/SS"

  // 3) Numeric-leading units keep only the leading numeric token
  // "1651 AR" -> "1651"
  // "1632 IN" -> "1632"
  const m = s.match(/^(\d{3,6})\b/)
  if (m) return m[1]

  return s
}

/**
 * Group membership by brigade prefix.
 *
 * Only explicitly prefixed units roll into brigade totals:
 * - 163... -> 163_BCG
 * - 165... -> 165_BCG
 * - bare OS/SS -> OTHER
 */
function groupForBn(rawBn: unknown): GroupKey {
  const bn = normalizeBn(rawBn)
  if (!bn) return "OTHER"
  if (bn.startsWith("163")) return "163_BCG"
  if (bn.startsWith("165")) return "165_BCG"
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
  return [0, 0, 0, 0, 0].map((_, i) =>
    clamp(Math.round(safeNum(base[i])), 0, Number.MAX_SAFE_INTEGER)
  )
}

/**
 * Infer the constant daily attrition rate that would produce the
 * cumulative destroyed-through-day count under the compound model.
 *
 * If onHand = 100 and cumulative destroyed by Day 3 = 27, then:
 * remainingFraction = 73/100
 * p = 1 - remainingFraction^(1/3)
 */
function inferDailyAttritionPctFromDestroyed(
  onHand: number,
  destroyedThroughDay: number,
  day: number
) {
  const start = Math.max(0, Math.floor(safeNum(onHand)))
  const destroyed = clamp(Math.floor(safeNum(destroyedThroughDay)), 0, start)
  const d = clamp(Math.floor(safeNum(day)), 1, 5)

  if (start <= 0 || destroyed <= 0) return 0
  if (destroyed >= start) return 100

  const remainingFraction = (start - destroyed) / start
  const p = 1 - Math.pow(remainingFraction, 1 / d)

  return clamp(p * 100, 0, 100)
}

export function computeRows(
  rows: TrackerRow[],
  opts?: { day?: number; useAttrition?: boolean; manualWins?: boolean }
) {
  // Day is 1..5 (no Day 0)
  const dayRaw = Math.floor(safeNum(opts?.day ?? 1))
  const day = clamp(dayRaw, 1, 5)

  const useAttrition = opts?.useAttrition ?? true

  // If true: destroyed = max(manual, attrition)
  // If false: destroyed = attrition (when enabled)
  const manualWins = opts?.manualWins ?? true

  const computedRows: ComputedRow[] = rows.map((row) => {
    const onHand = Math.max(0, Math.floor(safeNum(row.onHand)))

    // Manual destroyed (daily) is applied through selected day:
    // Day 1 uses D1, Day 5 uses D1..D5 cumulatively
    let destroyedManualActive = 0
    let destroyedManualTotal = 0

    if (row.destroyedByDay && Array.isArray(row.destroyedByDay)) {
      const byDay = normalizeDestroyedByDay(row.destroyedByDay)
      destroyedManualTotal = byDay.reduce((s, v) => s + v, 0)
      destroyedManualActive = byDay.slice(0, day).reduce((s, v) => s + v, 0)
    } else {
      // Legacy single manual destroyed value
      destroyedManualTotal = Math.max(0, Math.floor(safeNum(row.destroyedManual ?? 0)))
      destroyedManualActive = destroyedManualTotal
    }

    const manual = clamp(destroyedManualActive, 0, onHand)

    // Prefer the stored attrition rate if present.
    // Otherwise infer it directly from cumulative D1..D5 destroyed data.
    const effectiveDailyAttritionPct =
      safeNum(row.dailyAttritionPct) > 0
        ? safeNum(row.dailyAttritionPct)
        : inferDailyAttritionPctFromDestroyed(onHand, destroyedManualActive, day)

    let destroyedAttrition = 0
    if (useAttrition) {
      const rem = remainingAfterDays(onHand, effectiveDailyAttritionPct, day)
      destroyedAttrition = clamp(Math.round(onHand - rem), 0, onHand)
    }

    const destroyed = useAttrition
      ? manualWins
        ? Math.max(manual, destroyedAttrition)
        : destroyedAttrition
      : manual

    const remaining = Math.max(0, onHand - destroyed)
    const combatPowerPct = onHand > 0 ? (remaining / onHand) * 100 : 0
    const daysTo25Pct =
      onHand > 0 ? daysToReachFraction(effectiveDailyAttritionPct, 0.25) : null

    return {
      ...row,
      bn: normalizeBn(row.bn),
      onHand,
      dailyAttritionPct: effectiveDailyAttritionPct,
      destroyedManual: manual,
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

  const bnRowsByBn = new Map<string, ComputedRow[]>()
  for (const r of computedRows) {
    const bn = normalizeBn(r.bn)
    if (!bn) continue
    const list = bnRowsByBn.get(bn) ?? []
    list.push(r)
    bnRowsByBn.set(bn, list)
  }

  const bnSummaries: BnSummary[] = Array.from(bnMap.values()).map((s) => {
    const combatPowerPct = s.onHand > 0 ? (s.remaining / s.onHand) * 100 : 0

    const bnRows = bnRowsByBn.get(s.bn) ?? []
    const totalWeight = bnRows.reduce((sum, r) => sum + r.onHand, 0)
    const weightedAttrition =
      totalWeight > 0
        ? bnRows.reduce((sum, r) => sum + safeNum(r.dailyAttritionPct) * r.onHand, 0) / totalWeight
        : 0

    const daysTo25Pct = s.onHand > 0 ? daysToReachFraction(weightedAttrition, 0.25) : null

    return { ...s, combatPowerPct, daysTo25Pct }
  })

  bnSummaries.sort((a, b) => a.bn.localeCompare(b.bn))

  // Group rollups
  const groupMap = new Map<GroupKey, GroupSummary>()
  groupMap.set("163_BCG", {
    group: "163_BCG",
    onHand: 0,
    remaining: 0,
    destroyed: 0,
    combatPowerPct: 0,
    daysTo25Pct: null,
  })
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

  const groupRowsByGroup = new Map<GroupKey, ComputedRow[]>()
  groupRowsByGroup.set("163_BCG", [])
  groupRowsByGroup.set("165_BCG", [])
  groupRowsByGroup.set("OTHER", [])

  for (const r of computedRows) {
    const g = groupForBn(r.bn)

    const existing = groupMap.get(g)!
    existing.onHand += r.onHand
    existing.remaining += r.remaining
    existing.destroyed += r.destroyed

    groupRowsByGroup.get(g)!.push(r)
  }

  const groupSummaries: GroupSummary[] = Array.from(groupMap.values()).map((g) => {
    g.combatPowerPct = g.onHand > 0 ? (g.remaining / g.onHand) * 100 : 0

    const groupRows = groupRowsByGroup.get(g.group) ?? []
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