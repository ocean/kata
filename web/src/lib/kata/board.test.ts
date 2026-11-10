import { describe, expect, it } from 'vitest'

import {
  boardColumnTitles,
  buildBoard,
  columnFor,
  defaultDoneLimit,
  isEpic,
  planBoardMove,
} from './board'
import type { KataTaskSummary } from './types'

const now = new Date('2026-11-10T12:00:00Z')

function issue(uid: string, overrides: Partial<KataTaskSummary> = {}): KataTaskSummary {
  return {
    id: 1,
    uid,
    project_id: 7,
    project_uid: 'project-example',
    project_name: 'example-project',
    short_id: uid,
    qualified_id: `example-project#${uid}`,
    title: `Task ${uid}`,
    status: 'open',
    metadata: {},
    revision: 3,
    author: 'agent-a',
    labels: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('columnFor', () => {
  it('puts an unclaimed open issue in Open and a closed one in Done', () => {
    expect(columnFor(issue('a'), now)).toBe('open')
    expect(columnFor(issue('b', { status: 'closed' }), now)).toBe('done')
  })

  it('puts an owned open issue in In progress until its claim expires', () => {
    expect(columnFor(issue('a', { owner: 'agent-a' }), now)).toBe('in-progress')
    expect(
      columnFor(
        issue('b', { owner: 'agent-a', assignment_expires_on: '2026-11-10T13:00:00Z' }),
        now,
      ),
    ).toBe('in-progress')
    expect(
      columnFor(
        issue('c', { owner: 'agent-a', assignment_expires_on: '2026-11-10T11:00:00Z' }),
        now,
      ),
    ).toBe('open')
  })

  it('puts anything waiting on a human or on another issue in Needs attention', () => {
    expect(
      columnFor(issue('a', { owner: 'agent-a', metadata: { 'work.attention': 'stuck' } }), now),
    ).toBe('attention')
    expect(columnFor(issue('b', { labels: ['needs-review'] }), now)).toBe('attention')
    expect(
      columnFor(
        issue('c', {
          open_blocked_by: [{ uid: 'u-x', short_id: 'x', qualified_id: 'example-project#x' }],
        }),
        now,
      ),
    ).toBe('attention')
    expect(columnFor(issue('d', { metadata: { 'work.attention': 'ok' } }), now)).toBe('open')
  })

  it('keeps a closed issue in Done whatever signals it still carries', () => {
    expect(
      columnFor(issue('a', { status: 'closed', metadata: { 'work.attention': 'stuck' } }), now),
    ).toBe('done')
  })
})

describe('buildBoard', () => {
  it('always shows the four states in order', () => {
    const board = buildBoard([], { now })
    expect(board.columns.map((column) => [column.id, column.title])).toEqual([
      ['open', 'Open'],
      ['in-progress', 'In progress'],
      ['attention', 'Needs attention'],
      ['done', 'Done'],
    ])
    expect(boardColumnTitles.attention).toBe('Needs attention')
  })

  it('places each issue in the column its state derives', () => {
    const board = buildBoard(
      [
        issue('todo'),
        issue('doing', { owner: 'agent-a' }),
        issue('stuck', { metadata: { 'work.attention': 'stuck' } }),
        issue('shipped', { status: 'closed' }),
      ],
      { now },
    )
    expect(board.columns.map((column) => column.issues.map((i) => i.uid))).toEqual([
      ['todo'],
      ['doing'],
      ['stuck'],
      ['shipped'],
    ])
  })

  it('orders open cards by priority, then comment count, then most recent update', () => {
    const board = buildBoard(
      [
        issue('quiet-new', { priority: 1, comment_count: 0, updated_at: '2026-06-01T00:00:00Z' }),
        issue('busy', { priority: 1, comment_count: 7 }),
        issue('urgent', { priority: 0 }),
        issue('none', {}),
      ],
      { now },
    )
    expect(board.columns[0]!.issues.map((i) => i.uid)).toEqual([
      'urgent',
      'busy',
      'quiet-new',
      'none',
    ])
  })

  it('lists subtasks under their parent within a column', () => {
    const board = buildBoard(
      [
        issue('child', { parent: { uid: 'epic', short_id: 'epic' } }),
        issue('epic', { child_counts: { open: 1, total: 1 } }),
      ],
      { now },
    )
    expect(board.columns[0]!.issues.map((i) => i.uid)).toEqual(['epic', 'child'])
    expect(board.columns[0]!.depths.get('child')).toBe(1)
    expect(isEpic(board.columns[0]!.issues[0]!)).toBe(true)
  })

  it('pages Done locally or reports the server total', () => {
    const closed = Array.from({ length: defaultDoneLimit + 5 }, (_, n) =>
      issue(`c${n}`, {
        status: 'closed',
        closed_at: `2026-01-01T00:${String(n).padStart(2, '0')}:00Z`,
      }),
    )
    expect(buildBoard(closed, { now }).columns[3]!.issues).toHaveLength(defaultDoneLimit)
    const paged = buildBoard(closed, { now, doneTotal: 90 }).columns[3]!
    expect(paged.issues).toHaveLength(defaultDoneLimit + 5)
    expect(paged.total).toBe(90)
  })

  it('shows a pending move in its target column', () => {
    const board = buildBoard([issue('a')], { now, pending: new Map([['a', 'in-progress']]) })
    expect(board.columns[1]!.issues.map((i) => i.uid)).toEqual(['a'])
  })
})

describe('planBoardMove', () => {
  it('claims an unowned card moved to In progress, and releases it moved back to Open', () => {
    expect(planBoardMove(issue('a'), 'in-progress', now)).toEqual({ claim: true })
    expect(planBoardMove(issue('a', { owner: 'agent-a' }), 'open', now)).toEqual({ release: true })
  })

  it('asks for a reason before flagging a card for attention', () => {
    expect(planBoardMove(issue('a', { owner: 'agent-a' }), 'attention', now)).toEqual({
      flagAttention: true,
    })
  })

  it('clears every attention signal when a card leaves Needs attention', () => {
    const waiting = issue('a', {
      owner: 'agent-a',
      labels: ['needs-review', 'bug'],
      metadata: {
        'work.attention': 'needs-human',
        'work.attention_msg': 'Pick one',
        'notify.Y29vcmRpbmF0b3I': { from: 'agent-a', message: 'Decide' },
        other: 'kept',
      },
    })
    expect(planBoardMove(waiting, 'in-progress', now)).toEqual({
      clearAttention: {
        metadata: {
          'work.attention': 'ok',
          'work.attention_msg': null,
          'notify.Y29vcmRpbmF0b3I': null,
        },
        removeLabels: ['needs-review'],
      },
    })
    expect(planBoardMove(waiting, 'open', now)).toEqual({
      clearAttention: {
        metadata: {
          'work.attention': null,
          'work.attention_msg': null,
          'notify.Y29vcmRpbmF0b3I': null,
        },
        removeLabels: ['needs-review'],
      },
      release: true,
    })
  })

  it('claims an unowned card that leaves Needs attention for In progress', () => {
    expect(planBoardMove(issue('a', { labels: ['needs-review'] }), 'in-progress', now)).toEqual({
      clearAttention: { metadata: {}, removeLabels: ['needs-review'] },
      claim: true,
    })
  })

  it('refuses to move a card that is only blocked by another open issue', () => {
    const blocked = issue('a', {
      open_blocked_by: [{ uid: 'u-x', short_id: 'x', qualified_id: 'example-project#x' }],
    })
    expect(planBoardMove(blocked, 'open', now)).toEqual({ blockedBy: ['x'] })
    expect(planBoardMove(blocked, 'in-progress', now)).toEqual({ blockedBy: ['x'] })
    expect(planBoardMove(blocked, 'done', now)).toEqual({ close: true })
  })

  it('closes through the completion form and reopens into the target state', () => {
    expect(planBoardMove(issue('a', { owner: 'agent-a' }), 'done', now)).toEqual({ close: true })
    const closed = issue('b', { status: 'closed', owner: 'agent-a' })
    expect(planBoardMove(closed, 'open', now)).toEqual({ reopen: true, release: true })
    expect(planBoardMove(closed, 'in-progress', now)).toEqual({ reopen: true })
    expect(planBoardMove(issue('c', { status: 'closed' }), 'in-progress', now)).toEqual({
      reopen: true,
      claim: true,
    })
    expect(planBoardMove(issue('d', { status: 'closed' }), 'attention', now)).toEqual({
      reopen: true,
      flagAttention: true,
    })
  })

  it('does nothing when the card is already in the target column', () => {
    expect(planBoardMove(issue('a'), 'open', now)).toBeUndefined()
    expect(planBoardMove(issue('b', { status: 'closed' }), 'done', now)).toBeUndefined()
  })
})
