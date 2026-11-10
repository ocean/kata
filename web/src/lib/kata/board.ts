// Board layout: four columns that each show a state Kata already records, so
// the board adds no workflow vocabulary of its own.
//
//   Open             open, nobody has claimed it
//   In progress      open and claimed (an owner whose claim has not expired)
//   Needs attention  open and waiting on a human (work.attention, notify
//                    requests, the needs-review label) or on another open issue
//   Done             closed
//
// Moving a card performs the matching Kata action: claim, release, flag or
// clear attention, reopen, or close through the completion form.

import { attentionReasons, needsReviewLabel } from './attention'
import type { KataTaskSummary } from './types'

export const defaultDoneLimit = 30

export type BoardColumnID = 'open' | 'in-progress' | 'attention' | 'done'

export const boardColumnOrder: readonly BoardColumnID[] = [
  'open',
  'in-progress',
  'attention',
  'done',
]

export const boardColumnTitles: Record<BoardColumnID, string> = {
  open: 'Open',
  'in-progress': 'In progress',
  attention: 'Needs attention',
  done: 'Done',
}

export interface BoardColumn<T extends KataTaskSummary> {
  id: BoardColumnID
  title: string
  /** Cards in display order: each parent is followed by its children in this column. */
  issues: T[]
  /** Nesting depth of each card: 0 for top level, 1 for a child, and so on. */
  depths: Map<string, number>
  /** Issues that belong in the column, including any Done hides past its limit. */
  total: number
}

export interface Board<T extends KataTaskSummary> {
  columns: BoardColumn<T>[]
}

/** What a move does. An empty plan never happens: no change returns undefined. */
export interface BoardMovePlan {
  /** Close through the completion form, which asks for a reason and evidence. */
  close?: true
  reopen?: true
  /** Take the unowned issue as the viewer. */
  claim?: true
  /** Release the current owner. */
  release?: true
  /** Flag the issue needs-human; the board asks for a one-line reason first. */
  flagAttention?: true
  /** Clear the signals that put the issue in Needs attention. */
  clearAttention?: {
    metadata: Record<string, string | null>
    removeLabels: string[]
  }
  /** The move is refused: the card waits on these open issues. */
  blockedBy?: string[]
}

export function columnFor(issue: KataTaskSummary, now: Date = new Date()): BoardColumnID {
  if (issue.status === 'closed') return 'done'
  if (attentionReasons(issue).length > 0 || openBlockers(issue).length > 0) return 'attention'
  return isClaimed(issue, now) ? 'in-progress' : 'open'
}

export function buildBoard<T extends KataTaskSummary>(
  issues: readonly T[],
  options: {
    now?: Date
    doneLimit?: number
    pending?: ReadonlyMap<string, BoardColumnID>
    /** Closed issues the server counted; Done then shows every closed issue given. */
    doneTotal?: number | undefined
  } = {},
): Board<T> {
  const now = options.now ?? new Date()
  const columns = boardColumnOrder.map<BoardColumn<T>>((id) => ({
    id,
    title: boardColumnTitles[id],
    issues: [],
    depths: new Map(),
    total: 0,
  }))
  const byID = new Map(columns.map((column) => [column.id, column]))
  for (const issue of issues) {
    const target = byID.get(options.pending?.get(issue.uid) ?? columnFor(issue, now))!
    target.issues.push(issue)
  }
  for (const column of columns) {
    column.issues.sort(column.id === 'done' ? byClosedDesc : byPriorityThenUpdated)
    nestChildren(column)
    column.total = column.issues.length
  }
  const done = byID.get('done')!
  if (options.doneTotal !== undefined) {
    done.total = Math.max(options.doneTotal, done.issues.length)
  } else {
    const limit = options.doneLimit ?? defaultDoneLimit
    if (done.issues.length > limit) done.issues = done.issues.slice(0, limit)
  }
  return { columns }
}

export function planBoardMove(
  issue: KataTaskSummary,
  target: BoardColumnID,
  now: Date = new Date(),
): BoardMovePlan | undefined {
  const from = columnFor(issue, now)
  if (from === target) return undefined
  if (target === 'done') return { close: true }

  const plan: BoardMovePlan = {}
  if (from === 'done') plan.reopen = true

  if (from === 'attention' && target !== 'attention') {
    const reasons = attentionReasons(issue)
    const blockers = openBlockers(issue)
    // A card waiting only on another issue moves on when that issue closes.
    if (reasons.length === 0 && blockers.length > 0) return { blockedBy: blockers }
    plan.clearAttention = clearSignals(issue, target)
  }

  const owned = isClaimed(issue, now)
  if (target === 'attention') plan.flagAttention = true
  else if (target === 'in-progress' && !owned) plan.claim = true
  else if (target === 'open' && issue.owner) plan.release = true
  return plan
}

/** True when an issue has subtasks, which the board shows as an epic. */
export function isEpic(issue: KataTaskSummary): boolean {
  return (issue.child_counts?.total ?? 0) > 0
}

export function openBlockers(issue: KataTaskSummary): string[] {
  return (issue.open_blocked_by ?? []).map((blocker) => blocker.short_id)
}

function isClaimed(issue: KataTaskSummary, now: Date): boolean {
  if (!issue.owner) return false
  const expires = issue.assignment_expires_on
  return expires === undefined || Date.parse(expires) > now.getTime()
}

function clearSignals(
  issue: KataTaskSummary,
  target: BoardColumnID,
): NonNullable<BoardMovePlan['clearAttention']> {
  const metadata: Record<string, string | null> = {}
  const attention = issue.metadata['work.attention']
  if (attention === 'stuck' || attention === 'needs-human') {
    // In progress means actively working, which the convention spells "ok".
    metadata['work.attention'] = target === 'in-progress' ? 'ok' : null
    metadata['work.attention_msg'] = null
  }
  for (const key of Object.keys(issue.metadata)) {
    if (key.startsWith('notify.')) metadata[key] = null
  }
  return {
    metadata,
    removeLabels: (issue.labels ?? []).filter((label) => label === needsReviewLabel),
  }
}

// Reorders an already sorted column so each card's children in the same
// column follow it directly, keeping the sort order among siblings.
function nestChildren<T extends KataTaskSummary>(column: BoardColumn<T>): void {
  const inColumn = new Set(column.issues.map((issue) => issue.uid))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const issue of column.issues) {
    const parent = issue.parent?.uid
    if (parent !== undefined && parent !== issue.uid && inColumn.has(parent)) {
      const siblings = children.get(parent) ?? []
      siblings.push(issue)
      children.set(parent, siblings)
    } else {
      roots.push(issue)
    }
  }
  const ordered: T[] = []
  const depths = new Map<string, number>()
  const visit = (issue: T, depth: number): void => {
    if (depths.has(issue.uid)) return
    depths.set(issue.uid, depth)
    ordered.push(issue)
    for (const child of children.get(issue.uid) ?? []) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  // A parent cycle has no root; keep those cards rather than dropping them.
  for (const issue of column.issues) visit(issue, 0)
  column.issues = ordered
  column.depths = depths
}

// Priority first; among equal priorities the most-discussed ("hot") card
// leads, then the most recently updated.
function byPriorityThenUpdated(a: KataTaskSummary, b: KataTaskSummary): number {
  const pa = a.priority ?? Number.POSITIVE_INFINITY
  const pb = b.priority ?? Number.POSITIVE_INFINITY
  if (pa !== pb) return pa - pb
  const comments = (b.comment_count ?? 0) - (a.comment_count ?? 0)
  if (comments !== 0) return comments
  return b.updated_at.localeCompare(a.updated_at)
}

function byClosedDesc(a: KataTaskSummary, b: KataTaskSummary): number {
  return (b.closed_at ?? b.updated_at).localeCompare(a.closed_at ?? a.updated_at)
}
