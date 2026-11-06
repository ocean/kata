// Board layout: open issues sit in user-configured label columns, closed
// issues in Done. Kata stores only open/closed, so columns between those two
// are labels; moving a card swaps the column label the issue carries.

export const boardColumnsMetadataKey = 'board_columns'
export const defaultBoardColumns: readonly string[] = Object.freeze(['in-progress'])
export const defaultDoneLimit = 30

export type BoardColumnID = 'open' | 'done' | `label:${string}`

export interface BoardIssue {
  uid: string
  status: 'open' | 'closed'
  labels?: readonly string[] | undefined
  priority?: number | undefined
  updated_at: string
  closed_at?: string | undefined
  parent?: { uid: string } | undefined
  child_counts?: { open: number; total: number } | undefined
}

export interface BoardColumn<T extends BoardIssue> {
  id: BoardColumnID
  kind: 'open' | 'label' | 'done'
  title: string
  label?: string
  /** Cards in display order: each parent is followed by its children in this column. */
  issues: T[]
  /** Nesting depth of each card: 0 for top level, 1 for a child, and so on. */
  depths: Map<string, number>
  /** Issues that belong in the column, including any Done hides past its limit. */
  total: number
}

export interface Board<T extends BoardIssue> {
  columns: BoardColumn<T>[]
}

export interface BoardMovePlan {
  addLabel?: string
  removeLabels: string[]
  reopen: boolean
  close: boolean
}

export function labelColumnID(label: string): BoardColumnID {
  return `label:${label}`
}

export function normalizeBoardColumns(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const label = value.trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    result.push(label)
  }
  return result
}

export function boardColumnsFromMetadata(metadata: Record<string, unknown> | undefined): string[] {
  const value = metadata?.[boardColumnsMetadataKey]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return [...defaultBoardColumns]
  }
  return normalizeBoardColumns(value)
}

/**
 * Columns for a board that spans projects: every project's label columns, in
 * project order, each label at its first position. An empty catalog falls back
 * to the default columns.
 */
export function unionBoardColumns(
  projectMetadata: readonly (Record<string, unknown> | undefined)[],
): string[] {
  if (projectMetadata.length === 0) return [...defaultBoardColumns]
  return normalizeBoardColumns(
    projectMetadata.flatMap((metadata) => boardColumnsFromMetadata(metadata)),
  )
}

export function buildBoard<T extends BoardIssue>(
  issues: readonly T[],
  labels: readonly string[],
  options: {
    doneLimit?: number
    pending?: ReadonlyMap<string, BoardColumnID>
    /** Closed issues the server counted; Done then shows every closed issue given. */
    doneTotal?: number | undefined
  } = {},
): Board<T> {
  const columnLabels = normalizeBoardColumns(labels)
  const open: BoardColumn<T> = {
    id: 'open',
    kind: 'open',
    title: 'Open',
    issues: [],
    depths: new Map(),
    total: 0,
  }
  const labelColumns = columnLabels.map<BoardColumn<T>>((label) => ({
    id: labelColumnID(label),
    kind: 'label',
    title: label,
    label,
    issues: [],
    depths: new Map(),
    total: 0,
  }))
  const done: BoardColumn<T> = {
    id: 'done',
    kind: 'done',
    title: 'Done',
    issues: [],
    depths: new Map(),
    total: 0,
  }
  const columns = [open, ...labelColumns, done]
  const byID = new Map(columns.map((column) => [column.id, column]))

  for (const issue of issues) {
    const pending = options.pending?.get(issue.uid)
    const target = (pending && byID.get(pending)) || byID.get(columnFor(issue, columnLabels))!
    target.issues.push(issue)
  }

  for (const column of columns) {
    column.issues.sort(column.kind === 'done' ? byClosedDesc : byPriorityThenUpdated)
    nestChildren(column)
    column.total = column.issues.length
  }
  if (options.doneTotal !== undefined) {
    done.total = Math.max(options.doneTotal, done.issues.length)
  } else {
    const limit = options.doneLimit ?? defaultDoneLimit
    if (done.issues.length > limit) done.issues = done.issues.slice(0, limit)
  }
  return { columns }
}

/** True when an issue has subtasks, which the board shows as an epic. */
export function isEpic(issue: BoardIssue): boolean {
  return (issue.child_counts?.total ?? 0) > 0
}

// Reorders an already sorted column so each card's children in the same
// column follow it directly, keeping the sort order among siblings.
function nestChildren<T extends BoardIssue>(column: BoardColumn<T>): void {
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

export function columnFor(issue: BoardIssue, labels: readonly string[]): BoardColumnID {
  if (issue.status === 'closed') return 'done'
  const issueLabels = new Set(issue.labels ?? [])
  const label = labels.find((candidate) => issueLabels.has(candidate))
  return label === undefined ? 'open' : labelColumnID(label)
}

export function planBoardMove(
  issue: BoardIssue,
  target: BoardColumnID,
  labels: readonly string[],
): BoardMovePlan | undefined {
  if (columnFor(issue, labels) === target) return undefined
  if (target === 'done') return { removeLabels: [], reopen: false, close: true }

  const targetLabel = target === 'open' ? undefined : target.slice('label:'.length)
  const current = issue.labels ?? []
  const plan: BoardMovePlan = {
    removeLabels: current.filter((label) => labels.includes(label) && label !== targetLabel),
    reopen: issue.status === 'closed',
    close: false,
  }
  if (targetLabel !== undefined && !current.includes(targetLabel)) plan.addLabel = targetLabel
  return plan
}

function byPriorityThenUpdated(a: BoardIssue, b: BoardIssue): number {
  const pa = a.priority ?? Number.POSITIVE_INFINITY
  const pb = b.priority ?? Number.POSITIVE_INFINITY
  if (pa !== pb) return pa - pb
  return b.updated_at.localeCompare(a.updated_at)
}

function byClosedDesc(a: BoardIssue, b: BoardIssue): number {
  return (b.closed_at ?? b.updated_at).localeCompare(a.closed_at ?? a.updated_at)
}
