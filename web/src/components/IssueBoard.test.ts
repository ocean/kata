import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { KataTaskSummary } from '../lib/kata/types'
import IssueBoard from './IssueBoard.svelte'

function task(overrides: Partial<KataTaskSummary>): KataTaskSummary {
  return {
    id: 1,
    uid: 'issue-uid',
    project_id: 7,
    project_uid: 'project-example',
    project_name: 'example-project',
    short_id: 'abc1',
    qualified_id: 'example-project#abc1',
    title: 'Untitled',
    status: 'open',
    metadata: {},
    revision: 1,
    author: 'user-a',
    labels: [],
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

const triage = task({ id: 1, uid: 'u-triage', short_id: 'tri1', title: 'Triage inbox' })
const doing = task({
  id: 2,
  uid: 'u-doing',
  short_id: 'doi1',
  title: 'Write the parser',
  labels: ['in-progress', 'bug'],
  priority: 1,
  owner: 'user-b',
})
const shipped = task({
  id: 3,
  uid: 'u-shipped',
  short_id: 'shp1',
  title: 'Ship the release',
  status: 'closed',
  closed_at: '2026-05-03T00:00:00Z',
})

type Props = ComponentProps<typeof IssueBoard>

function renderBoard(overrides: Partial<Props> = {}) {
  const props: Props = {
    issues: [triage, doing, shipped],
    columns: ['in-progress', 'review'],
    selectedIssueUID: null,
    showProject: false,
    onOpenIssue: vi.fn(),
    onMoveIssue: vi.fn(async () => true),
    onCompleteIssue: vi.fn(async () => true),
    ...overrides,
  }
  render(IssueBoard, { props })
  return props
}

function column(name: string): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(`^${name},`) })
}

function cardButton(title: string): HTMLElement {
  return screen.getByRole('button', { name: title })
}

describe('IssueBoard', () => {
  afterEach(() => cleanup())

  it('lays cards out in Open, the label columns, and Done with counts', () => {
    renderBoard()

    expect(
      within(screen.getByRole('region', { name: 'Issue board' }))
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label')),
    ).toEqual(['Open, 1 card', 'in-progress, 1 card', 'review, 0 cards', 'Done, 1 card'])
    expect(within(column('Open')).getByText('Triage inbox')).toBeTruthy()
    expect(within(column('in-progress')).getByText('Write the parser')).toBeTruthy()
    expect(within(column('Done')).getByText('Ship the release')).toBeTruthy()
  })

  it('shows priority, owner, and non-column labels on the card', () => {
    renderBoard()

    const card = within(column('in-progress')).getByRole('listitem')
    expect(within(card).getByText('P1')).toBeTruthy()
    expect(within(card).getByText('user-b')).toBeTruthy()
    expect(within(card).getByText('bug')).toBeTruthy()
    expect(within(card).queryByText('in-progress')).toBeNull()
  })

  it('opens the issue when its card is clicked', async () => {
    const props = renderBoard()

    await fireEvent.click(cardButton('Triage inbox'))

    expect(props.onOpenIssue).toHaveBeenCalledWith(triage)
  })

  it('moves a focused card one column right with Alt+ArrowRight', async () => {
    const props = renderBoard()

    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowRight', altKey: true })

    expect(props.onMoveIssue).toHaveBeenCalledWith(triage, {
      addLabel: 'in-progress',
      removeLabels: [],
      reopen: false,
      close: false,
    })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('in-progress'))
  })

  it('moves a card back to Open by removing its column label', async () => {
    const props = renderBoard()

    await fireEvent.keyDown(cardButton('Write the parser'), { key: 'ArrowLeft', altKey: true })

    expect(props.onMoveIssue).toHaveBeenCalledWith(doing, {
      removeLabels: ['in-progress'],
      reopen: false,
      close: false,
    })
  })

  it('keeps the card in its target column while the move is pending', async () => {
    let finish: (value: boolean) => void = () => {}
    renderBoard({
      onMoveIssue: vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve))),
    })

    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowRight', altKey: true })

    expect(within(column('in-progress')).getByText('Triage inbox')).toBeTruthy()
    finish(false)
    await waitFor(() => expect(within(column('Open')).getByText('Triage inbox')).toBeTruthy())
    expect(screen.getByRole('status').textContent).toContain('Could not move')
  })

  it('asks for a completion note before a card dropped on Done closes', async () => {
    const props = renderBoard()
    const source = within(column('Open')).getByRole('listitem')
    const transfer = {
      setData: vi.fn(),
      getData: () => 'u-triage',
      effectAllowed: '',
      dropEffect: '',
    }

    await fireEvent.dragStart(source, { dataTransfer: transfer })
    await fireEvent.dragOver(column('Done'), { dataTransfer: transfer })
    await fireEvent.drop(column('Done'), { dataTransfer: transfer })

    expect(props.onMoveIssue).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Complete task' })
    await fireEvent.click(within(dialog).getByRole('radio', { name: /Won't do/ }))
    await fireEvent.input(within(dialog).getByRole('textbox'), {
      target: { value: 'No longer needed because the inbox flow was replaced last week.' },
    })
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Complete' }))

    expect(props.onCompleteIssue).toHaveBeenCalledWith(triage, {
      reason: 'wontfix',
      message: 'No longer needed because the inbox flow was replaced last week.',
      evidence: [],
    })
  })

  it('reopens a Done card dragged into a label column', async () => {
    const props = renderBoard()
    const source = within(column('Done')).getByRole('listitem')
    const transfer = {
      setData: vi.fn(),
      getData: () => 'u-shipped',
      effectAllowed: '',
      dropEffect: '',
    }

    await fireEvent.dragStart(source, { dataTransfer: transfer })
    await fireEvent.dragOver(column('review'), { dataTransfer: transfer })
    await fireEvent.drop(column('review'), { dataTransfer: transfer })

    expect(props.onMoveIssue).toHaveBeenCalledWith(shipped, {
      addLabel: 'review',
      removeLabels: [],
      reopen: true,
      close: false,
    })
  })

  it('offers every other column from the card move menu', async () => {
    const props = renderBoard()

    await fireEvent.click(screen.getByRole('button', { name: 'Move Triage inbox' }))
    const menu = screen.getByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['in-progress', 'review', 'Done'])
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'review' }))

    expect(props.onMoveIssue).toHaveBeenCalledWith(triage, {
      addLabel: 'review',
      removeLabels: [],
      reopen: false,
      close: false,
    })
  })

  it('does not move cards and says why when changes are blocked', async () => {
    const props = renderBoard({ moveBlockedReason: 'This credential is read-only.' })

    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowRight', altKey: true })

    expect(props.onMoveIssue).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Move Triage inbox' })).toBeNull()
    expect(within(column('Open')).getByRole('listitem').getAttribute('draggable')).toBe('false')
    expect(screen.getByText('This credential is read-only.')).toBeTruthy()
  })

  it('moves focus between cards and columns with the arrow keys', async () => {
    renderBoard({ issues: [triage, task({ id: 9, uid: 'u-two', title: 'Second open' }), doing] })

    cardButton('Triage inbox').focus()
    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cardButton('Second open'))
    await fireEvent.keyDown(cardButton('Second open'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cardButton('Write the parser'))
  })

  it('shows only the newest Done cards until asked for more', async () => {
    const closed = Array.from({ length: 35 }, (_, n) =>
      task({
        id: 100 + n,
        uid: `u-closed-${n}`,
        title: `Closed ${n}`,
        status: 'closed',
        closed_at: `2026-04-${String((n % 28) + 1).padStart(2, '0')}T00:${String(n).padStart(2, '0')}:00Z`,
      }),
    )
    renderBoard({ issues: closed, columns: [] })

    expect(within(column('Done')).getAllByRole('listitem')).toHaveLength(30)
    expect(column('Done').getAttribute('aria-label')).toBe('Done, 35 cards')
    await fireEvent.click(screen.getByRole('button', { name: 'Show 5 more' }))
    expect(within(column('Done')).getAllByRole('listitem')).toHaveLength(35)
  })
})

describe('IssueBoard epics and subtasks', () => {
  afterEach(() => cleanup())

  const epic = task({
    id: 20,
    uid: 'u-epic',
    short_id: 'epc1',
    title: 'Launch the board',
    priority: 2,
    child_counts: { open: 2, total: 3 },
  })
  const firstChild = task({
    id: 21,
    uid: 'u-child-a',
    short_id: 'cha1',
    title: 'Draw the columns',
    priority: 1,
    parent: { uid: 'u-epic', short_id: 'epc1' },
  })
  const secondChild = task({
    id: 22,
    uid: 'u-child-b',
    short_id: 'chb1',
    title: 'Wire up dragging',
    priority: 3,
    parent: { uid: 'u-epic', short_id: 'epc1' },
  })
  const elsewhereChild = task({
    id: 23,
    uid: 'u-child-c',
    short_id: 'chc1',
    title: 'Review the copy',
    labels: ['in-progress'],
    parent: { uid: 'u-epic', short_id: 'epc1' },
  })
  const loner = task({ id: 24, uid: 'u-loner', title: 'Unrelated chore', priority: 0 })

  function cardTitles(region: HTMLElement): string[] {
    return within(region)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.card-title')?.textContent ?? '')
  }

  it('marks epic cards and lists their subtasks directly underneath, indented', () => {
    renderBoard({ issues: [secondChild, loner, epic, firstChild, elsewhereChild] })

    expect(cardTitles(column('Open'))).toEqual([
      'Unrelated chore',
      'Launch the board',
      'Draw the columns',
      'Wire up dragging',
    ])
    const cards = within(column('Open')).getAllByRole('listitem')
    expect(within(cards[1]!).getByText('Epic')).toBeTruthy()
    expect(within(cards[0]!).queryByText('Epic')).toBeNull()
    expect(cards.map((card) => card.getAttribute('data-depth'))).toEqual(['0', '0', '1', '1'])
  })

  it('names the subtask relationship for screen readers', () => {
    renderBoard({ issues: [epic, firstChild] })

    expect(
      screen.getByRole('button', {
        name: 'Draw the columns',
        description: /^Subtask of Launch the board/,
      }),
    ).toBeTruthy()
  })

  it('shows which epic a subtask belongs to when the epic is in another column', () => {
    renderBoard({ issues: [epic, elsewhereChild] })

    const card = within(column('in-progress')).getByRole('listitem')
    expect(card.getAttribute('data-depth')).toBe('0')
    expect(within(card).getByText('epc1').closest('.card-parent')).toBeTruthy()
  })
})

describe('IssueBoard server-paged Done', () => {
  afterEach(() => cleanup())

  it('reports the server total and asks the server for the next page', async () => {
    const closed = Array.from({ length: 30 }, (_, n) =>
      task({
        id: 200 + n,
        uid: `u-done-${n}`,
        title: `Done ${n}`,
        status: 'closed',
        closed_at: `2026-04-01T00:${String(n).padStart(2, '0')}:00Z`,
      }),
    )
    const onShowMoreDone = vi.fn()
    renderBoard({ issues: closed, columns: [], doneTotal: 75, onShowMoreDone })

    expect(column('Done').getAttribute('aria-label')).toBe('Done, 75 cards')
    expect(within(column('Done')).getAllByRole('listitem')).toHaveLength(30)
    await fireEvent.click(screen.getByRole('button', { name: 'Show 30 more' }))

    expect(onShowMoreDone).toHaveBeenCalledOnce()
  })
})

describe('IssueBoard compact cards', () => {
  afterEach(() => cleanup())

  it('keeps ID, priority, and title on one line and drops the detail row', () => {
    renderBoard({ compact: true })

    const card = within(column('in-progress')).getByRole('listitem')
    expect(within(card).getByText('doi1')).toBeTruthy()
    expect(within(card).getByText('P1')).toBeTruthy()
    expect(within(card).getByText('Write the parser')).toBeTruthy()
    expect(within(card).queryByText('user-b')).toBeNull()
    expect(within(card).queryByText('bug')).toBeNull()
    expect(cardButton('Write the parser')).toBeTruthy()
  })
})

describe('IssueBoard collapsible columns', () => {
  afterEach(() => cleanup())

  it('offers to collapse Done and empty columns but not columns holding cards', async () => {
    const props = renderBoard({ onToggleColumn: vi.fn() })

    expect(within(column('Done')).getByRole('button', { name: 'Collapse Done' })).toBeTruthy()
    expect(within(column('review')).getByRole('button', { name: 'Collapse review' })).toBeTruthy()
    expect(within(column('in-progress')).queryByRole('button', { name: /^Collapse/ })).toBeNull()
    expect(within(column('Open')).queryByRole('button', { name: /^Collapse/ })).toBeNull()

    await fireEvent.click(within(column('Done')).getByRole('button', { name: 'Collapse Done' }))
    expect(props.onToggleColumn).toHaveBeenCalledWith('done')
  })

  it('shows a collapsed column as a strip with its count that still takes drops', async () => {
    const props = renderBoard({ collapsedColumns: ['done'], onToggleColumn: vi.fn() })

    const done = column('Done')
    expect(done.getAttribute('aria-label')).toBe('Done, 1 card')
    expect(within(done).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(done).getByText('1')).toBeTruthy()
    await fireEvent.click(within(done).getByRole('button', { name: 'Expand Done' }))
    expect(props.onToggleColumn).toHaveBeenCalledWith('done')

    const transfer = {
      setData: vi.fn(),
      getData: () => 'u-triage',
      effectAllowed: '',
      dropEffect: '',
    }
    await fireEvent.dragStart(within(column('Open')).getByRole('listitem'), {
      dataTransfer: transfer,
    })
    await fireEvent.dragOver(done, { dataTransfer: transfer })
    await fireEvent.drop(done, { dataTransfer: transfer })
    expect(screen.getByRole('dialog', { name: 'Complete task' })).toBeTruthy()
  })

  it('skips collapsed columns when arrow keys move focus across the board', async () => {
    // A column collapsed while empty stays collapsed after cards arrive.
    const inReview = task({
      id: 30,
      uid: 'u-review',
      title: 'Hidden in review',
      labels: ['review'],
    })
    renderBoard({
      issues: [triage, inReview, doing],
      columns: ['review', 'in-progress'],
      collapsedColumns: ['label:review'],
    })

    cardButton('Triage inbox').focus()
    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cardButton('Write the parser'))
  })
})
