import { describe, expect, it } from 'vitest'

import {
  boardColumnsFromMetadata,
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
