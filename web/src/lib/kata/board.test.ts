import { describe, expect, it } from 'vitest'

import {
  boardColumnsFromMetadata,
  unionBoardColumns,
  boardColumnLimitsFromMetadata,
  buildBoard,
  defaultBoardColumns,
  normalizeBoardColumns,
  planBoardMove,
  type BoardIssue,
} from './board'

function issue(uid: string, overrides: Partial<BoardIssue> = {}): BoardIssue {
  return {
    uid,
    status: 'open',
    labels: [],
    priority: undefined,
    updated_at: '2026-01-01T00:00:00Z',
    closed_at: undefined,
    ...overrides,
  }
}

describe('board column configuration', () => {
  it('reads an ordered label list from project metadata', () => {
    expect(boardColumnsFromMetadata({ board_columns: ['review', 'in-progress'] })).toEqual([
      'review',
      'in-progress',
    ])
  })

  it('falls back to the default columns when metadata holds no usable list', () => {
    expect(boardColumnsFromMetadata({})).toEqual(defaultBoardColumns)
    expect(boardColumnsFromMetadata({ board_columns: 'review' })).toEqual(defaultBoardColumns)
    expect(boardColumnsFromMetadata({ board_columns: [1, 2] })).toEqual(defaultBoardColumns)
    expect(boardColumnsFromMetadata(undefined)).toEqual(defaultBoardColumns)
  })

  it('keeps an explicitly empty list so a board can show only Open and Done', () => {
    expect(boardColumnsFromMetadata({ board_columns: [] })).toEqual([])
  })

  it('trims, drops blanks and duplicates, and keeps the first position', () => {
    expect(normalizeBoardColumns([' review ', '', 'doing', 'review', '  '])).toEqual([
      'review',
      'doing',
    ])
  })
})

describe('buildBoard', () => {
  it('places open issues in their first configured column label, in column order', () => {
    const board = buildBoard(
      [
        issue('a', { labels: ['review', 'doing'] }),
        issue('b', { labels: ['bug'] }),
        issue('c', { labels: ['doing'] }),
      ],
      ['doing', 'review'],
    )

    expect(board.columns.map((column) => [column.id, column.issues.map((i) => i.uid)])).toEqual([
      ['open', ['b']],
      ['label:doing', ['a', 'c']],
      ['label:review', []],
      ['done', []],
    ])
  })

  it('puts every closed issue in Done whatever its labels, newest close first', () => {
    const board = buildBoard(
      [
        issue('old', { status: 'closed', labels: ['doing'], closed_at: '2026-01-01T00:00:00Z' }),
        issue('new', { status: 'closed', closed_at: '2026-03-01T00:00:00Z' }),
      ],
      ['doing'],
    )

    expect(board.columns.at(-1)!.issues.map((i) => i.uid)).toEqual(['new', 'old'])
    expect(board.columns[1]!.issues).toEqual([])
  })

  it('orders open cards by priority, unprioritized last, then most recently updated', () => {
    const board = buildBoard(
      [
        issue('none-new', { updated_at: '2026-05-01T00:00:00Z' }),
        issue('p2', { priority: 2 }),
        issue('none-old', { updated_at: '2026-01-01T00:00:00Z' }),
        issue('p0', { priority: 0 }),
      ],
      [],
    )

    expect(board.columns[0]!.issues.map((i) => i.uid)).toEqual(['p0', 'p2', 'none-new', 'none-old'])
  })

  it('caps Done and reports how many closed issues it holds in total', () => {
    const closed = Array.from({ length: 5 }, (_, n) =>
      issue(`c${n}`, { status: 'closed', closed_at: `2026-01-0${n + 1}T00:00:00Z` }),
    )
    const done = buildBoard(closed, [], { doneLimit: 2 }).columns.at(-1)!

    expect(done.issues.map((i) => i.uid)).toEqual(['c4', 'c3'])
    expect(done.total).toBe(5)
  })

  it('shows a pending move in its target column before the server confirms it', () => {
    const board = buildBoard([issue('a'), issue('b', { labels: ['doing'] })], ['doing'], {
      pending: new Map([
        ['a', 'label:doing'],
        ['b', 'done'],
      ]),
    })

    expect(board.columns.map((column) => column.issues.map((i) => i.uid))).toEqual([
      [],
      ['a'],
      ['b'],
    ])
  })
})

describe('planBoardMove', () => {
  const columns = ['doing', 'review']

  it('adds the target label before removing the column labels the issue had', () => {
    expect(
      planBoardMove(issue('a', { labels: ['bug', 'doing'] }), 'label:review', columns),
    ).toEqual({ addLabel: 'review', removeLabels: ['doing'], reopen: false, close: false })
  })

  it('removes every column label when a card moves back to Open', () => {
    expect(planBoardMove(issue('a', { labels: ['review', 'doing'] }), 'open', columns)).toEqual({
      removeLabels: ['review', 'doing'],
      reopen: false,
      close: false,
    })
  })

  it('closes without touching labels when a card moves to Done', () => {
    expect(planBoardMove(issue('a', { labels: ['doing'] }), 'done', columns)).toEqual({
      removeLabels: [],
      reopen: false,
      close: true,
    })
  })

  it('reopens a closed card and gives it the target column label', () => {
    expect(
      planBoardMove(issue('a', { status: 'closed', labels: ['doing'] }), 'label:review', columns),
    ).toEqual({ addLabel: 'review', removeLabels: ['doing'], reopen: true, close: false })
  })

  it('returns undefined when the card already sits in the target column', () => {
    expect(planBoardMove(issue('a', { labels: ['doing'] }), 'label:doing', columns)).toBeUndefined()
    expect(planBoardMove(issue('a', { status: 'closed' }), 'done', columns)).toBeUndefined()
    expect(planBoardMove(issue('a', { labels: ['bug'] }), 'open', columns)).toBeUndefined()
  })

  it('keeps an extra column label off the plan when the card moves to its own first column', () => {
    // A card labelled doing+review sits in doing; moving it to review must drop doing.
    expect(
      planBoardMove(issue('a', { labels: ['doing', 'review'] }), 'label:review', columns),
    ).toEqual({ removeLabels: ['doing'], reopen: false, close: false })
  })
})

describe('subtasks on the board', () => {
  const child = (uid: string, parent: string, overrides: Partial<BoardIssue> = {}) =>
    issue(uid, { parent: { uid: parent }, ...overrides })

  it('lists children directly under their parent in the same column, by priority', () => {
    const board = buildBoard(
      [
        issue('solo', { priority: 1 }),
        child('epic-b', 'epic', { priority: 3 }),
        issue('epic', { priority: 2, child_counts: { open: 2, total: 2 } }),
        child('epic-a', 'epic', { priority: 0 }),
        issue('late', { priority: 4 }),
      ],
      [],
    )
    const open = board.columns[0]!

    expect(open.issues.map((i) => i.uid)).toEqual(['solo', 'epic', 'epic-a', 'epic-b', 'late'])
    expect([...open.depths.entries()]).toEqual([
      ['solo', 0],
      ['epic', 0],
      ['epic-a', 1],
      ['epic-b', 1],
      ['late', 0],
    ])
  })

  it('nests grandchildren one level deeper', () => {
    const board = buildBoard([issue('root'), child('mid', 'root'), child('leaf', 'mid')], [])

    expect(board.columns[0]!.issues.map((i) => i.uid)).toEqual(['root', 'mid', 'leaf'])
    expect(board.columns[0]!.depths.get('leaf')).toBe(2)
  })

  it('keeps a child top-level when its parent sits in another column', () => {
    const board = buildBoard(
      [issue('epic', { labels: ['doing'] }), child('task', 'epic')],
      ['doing'],
    )

    expect(board.columns[0]!.issues.map((i) => i.uid)).toEqual(['task'])
    expect(board.columns[0]!.depths.get('task')).toBe(0)
  })

  it('nests closed children under a closed parent in Done', () => {
    const board = buildBoard(
      [
        issue('epic', { status: 'closed', closed_at: '2026-01-01T00:00:00Z' }),
        child('task', 'epic', { status: 'closed', closed_at: '2026-01-05T00:00:00Z' }),
        issue('other', { status: 'closed', closed_at: '2026-01-03T00:00:00Z' }),
      ],
      [],
    )

    expect(board.columns.at(-1)!.issues.map((i) => i.uid)).toEqual(['other', 'epic', 'task'])
  })
})

describe('server-paged Done', () => {
  it('shows every closed issue it was given and reports the server total', () => {
    const closed = Array.from({ length: 40 }, (_, n) =>
      issue(`c${n}`, {
        status: 'closed',
        closed_at: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
      }),
    )
    const done = buildBoard(closed, [], { doneTotal: 95 }).columns.at(-1)!

    expect(done.issues).toHaveLength(40)
    expect(done.total).toBe(95)
  })
})

describe('unionBoardColumns', () => {
  it('merges every project board in order, keeping the first position of shared labels', () => {
    expect(
      unionBoardColumns([
        { board_columns: ['doing', 'review'] },
        { board_columns: ['triage', 'review', 'blocked'] },
      ]),
    ).toEqual(['doing', 'review', 'triage', 'blocked'])
  })

  it('counts a project without board settings as the default columns', () => {
    expect(unionBoardColumns([{}, { board_columns: ['review'] }])).toEqual([
      'in-progress',
      'review',
    ])
  })

  it('keeps a project that chose no label columns out of the union', () => {
    expect(unionBoardColumns([{ board_columns: [] }, { board_columns: ['review'] }])).toEqual([
      'review',
    ])
  })

  it('falls back to the default columns when there are no projects', () => {
    expect(unionBoardColumns([])).toEqual(['in-progress'])
  })
})

describe('boardColumnLimitsFromMetadata', () => {
  it('reads whole-number limits for label columns', () => {
    expect(
      boardColumnLimitsFromMetadata({ board_column_limits: { review: 3, 'in-progress': 5 } }),
    ).toEqual({ review: 3, 'in-progress': 5 })
  })

  it('drops limits that are not whole numbers from 1 to 999', () => {
    expect(
      boardColumnLimitsFromMetadata({
        board_column_limits: { a: 0, b: -2, c: 2.5, d: '4', e: 1000, f: 999 },
      }),
    ).toEqual({ f: 999 })
  })

  it('treats missing or malformed metadata as no limits', () => {
    expect(boardColumnLimitsFromMetadata(undefined)).toEqual({})
    expect(boardColumnLimitsFromMetadata({ board_column_limits: [3] })).toEqual({})
    expect(boardColumnLimitsFromMetadata({ board_column_limits: null })).toEqual({})
  })
})
