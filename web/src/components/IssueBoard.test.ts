import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dismissFlash } from '@kenn-io/kit-ui'

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
    await waitFor(() => expect(screen.getByText('Moved Triage inbox to in-progress.')).toBeTruthy())
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
    expect(screen.getByText(/Could not move Triage inbox/)).toBeTruthy()
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

describe('IssueBoard after a move', () => {
  afterEach(() => {
    cleanup()
    dismissFlash()
  })

  it('briefly highlights the card where it landed', async () => {
    renderMoving({ ...triage, labels: ['in-progress'] })

    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowRight', altKey: true })

    await waitFor(() =>
      expect(
        within(column('in-progress')).getByRole('button', { name: 'Triage inbox' }).closest('li')!
          .classList,
      ).toContain('just-moved'),
    )
  })

  // The app refreshes the board after a move, so these tests hand the moved
  // card back to the board the way that refresh does.
  function renderMoving(moved: KataTaskSummary) {
    const base: Props = {
      issues: [triage, doing, shipped],
      columns: ['in-progress', 'review'],
      selectedIssueUID: null,
      showProject: false,
      onOpenIssue: vi.fn(),
      onMoveIssue: vi.fn(),
      onCompleteIssue: vi.fn(async () => true),
    }
    const view = render(IssueBoard, { props: base })
    const onMoveIssue = vi.fn(async (issue: KataTaskSummary) => {
      if (onMoveIssue.mock.calls.length === 1) {
        await view.rerender({
          issues: [triage, doing, shipped].map((candidate) =>
            candidate.uid === issue.uid ? moved : candidate,
          ),
        })
      }
      return true
    })
    void view.rerender({ onMoveIssue })
    return onMoveIssue
  }

  it('offers Undo, which moves the card back to the column it came from', async () => {
    const onMoveIssue = renderMoving({ ...doing, labels: ['review', 'bug'] })

    await fireEvent.keyDown(cardButton('Write the parser'), { key: 'ArrowRight', altKey: true })
    await fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(onMoveIssue).toHaveBeenCalledTimes(2)
    expect(onMoveIssue).toHaveBeenLastCalledWith(expect.objectContaining({ uid: 'u-doing' }), {
      addLabel: 'in-progress',
      removeLabels: ['review'],
      reopen: false,
      close: false,
    })
  })

  it('undoes the last move with Ctrl+Z on the board', async () => {
    const onMoveIssue = renderMoving({ ...triage, labels: ['in-progress'] })

    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowRight', altKey: true })
    await screen.findByRole('button', { name: 'Undo' })
    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'z', ctrlKey: true })

    expect(onMoveIssue).toHaveBeenCalledTimes(2)
    expect(onMoveIssue).toHaveBeenLastCalledWith(expect.objectContaining({ uid: 'u-triage' }), {
      removeLabels: ['in-progress'],
      reopen: false,
      close: false,
    })
  })

  it('leaves Ctrl+Z in a text field to the field', async () => {
    const onMoveIssue = renderMoving({ ...triage, labels: ['in-progress'] })
    const field = document.createElement('input')
    document.body.append(field)

    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowRight', altKey: true })
    await screen.findByRole('button', { name: 'Undo' })
    await fireEvent.keyDown(field, { key: 'z', ctrlKey: true })

    expect(onMoveIssue).toHaveBeenCalledOnce()
    field.remove()
  })

  it('does not offer Undo when the move reopened a closed card', async () => {
    renderBoard()
    const transfer = {
      setData: vi.fn(),
      getData: () => 'u-shipped',
      effectAllowed: '',
      dropEffect: '',
    }

    await fireEvent.dragStart(within(column('Done')).getByRole('listitem'), {
      dataTransfer: transfer,
    })
    await fireEvent.dragOver(column('review'), { dataTransfer: transfer })
    await fireEvent.drop(column('review'), { dataTransfer: transfer })

    await screen.findByText('Moved Ship the release to review.')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

describe('IssueBoard column limits', () => {
  afterEach(() => cleanup())

  it('shows count against limit and flags a column over its limit', () => {
    const second = task({
      id: 40,
      uid: 'u-second',
      title: 'Second in progress',
      labels: ['in-progress'],
    })
    renderBoard({ issues: [triage, doing, second], limits: { 'in-progress': 1, review: 4 } })

    const inProgress = column('in-progress')
    expect(inProgress.getAttribute('aria-label')).toBe('in-progress, 2 cards, over its limit of 1')
    expect(inProgress.classList).toContain('over-limit')
    expect(inProgress.style.getPropertyValue('--column-color')).toBe('var(--accent-amber)')
    expect(within(inProgress).getByText('2 / 1')).toBeTruthy()

    const review = column('review')
    expect(review.getAttribute('aria-label')).toBe('review, 0 cards, limit 4')
    expect(review.classList).not.toContain('over-limit')
    expect(within(review).getByText('0 / 4')).toBeTruthy()
  })
})

describe('IssueBoard add card', () => {
  afterEach(() => cleanup())

  it('adds a card to a label column with that label, and stays open for the next one', async () => {
    const onAddCard = vi.fn(async () => true)
    renderBoard({ onAddCard })

    await fireEvent.click(
      within(column('review')).getByRole('button', { name: 'Add card to review' }),
    )
    const input = within(column('review')).getByRole('textbox', { name: 'New card in review' })
    expect(document.activeElement).toBe(input)
    await fireEvent.input(input, { target: { value: '  Write release notes  ' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAddCard).toHaveBeenCalledWith('Write release notes', 'review')
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''))
    expect(
      within(column('review')).getByRole('textbox', { name: 'New card in review' }),
    ).toBeTruthy()
  })

  it('adds a card to Open without a column label', async () => {
    const onAddCard = vi.fn(async () => true)
    renderBoard({ onAddCard })

    await fireEvent.click(within(column('Open')).getByRole('button', { name: 'Add card to Open' }))
    const input = within(column('Open')).getByRole('textbox', { name: 'New card in Open' })
    await fireEvent.input(input, { target: { value: 'Plain task' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAddCard).toHaveBeenCalledWith('Plain task', undefined)
  })

  it('keeps the draft when adding fails, and Escape closes the form', async () => {
    const onAddCard = vi.fn(async () => false)
    renderBoard({ onAddCard })

    await fireEvent.click(within(column('Open')).getByRole('button', { name: 'Add card to Open' }))
    const input = within(column('Open')).getByRole('textbox', { name: 'New card in Open' })
    await fireEvent.input(input, { target: { value: 'Keep me' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onAddCard).toHaveBeenCalledOnce())
    expect((input as HTMLTextAreaElement).value).toBe('Keep me')

    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(within(column('Open')).queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(
      within(column('Open')).getByRole('button', { name: 'Add card to Open' }),
    )
  })

  it('offers no add button on Done or without a create handler', () => {
    renderBoard({ onAddCard: vi.fn(async () => true) })
    expect(within(column('Done')).queryByRole('button', { name: /^Add card/ })).toBeNull()
    cleanup()

    renderBoard()
    expect(screen.queryByRole('button', { name: /^Add card/ })).toBeNull()
  })
})

describe('IssueBoard add card during a refresh', () => {
  afterEach(() => cleanup())

  it('keeps the add form open while moves pause for a snapshot refresh', async () => {
    const view = render(IssueBoard, {
      props: {
        issues: [triage],
        columns: [],
        selectedIssueUID: null,
        showProject: false,
        onOpenIssue: vi.fn(),
        onMoveIssue: vi.fn(async () => true),
        onCompleteIssue: vi.fn(async () => true),
        onAddCard: vi.fn(async () => true),
      },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Add card to Open' }))
    await fireEvent.input(screen.getByRole('textbox', { name: 'New card in Open' }), {
      target: { value: 'Half typed' },
    })

    await view.rerender({ moveBlockedReason: 'Changes are paused while Kata connects.' })

    const input = screen.getByRole('textbox', { name: 'New card in Open' }) as HTMLTextAreaElement
    expect(input.value).toBe('Half typed')
  })
})

describe('IssueBoard comment badge', () => {
  afterEach(() => cleanup())

  it('shows how many comments a comfortable card has', () => {
    renderBoard({ issues: [{ ...triage, comment_count: 3 }, doing] })

    const card = within(column('Open')).getByRole('listitem')
    expect(within(card).getByText('3')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Triage inbox', description: /3 comments/ }),
    ).toBeTruthy()
    expect(
      within(within(column('in-progress')).getByRole('listitem')).queryByText(/comment/),
    ).toBeNull()
  })

  it('uses the singular for one comment and leaves compact cards without a badge', () => {
    renderBoard({ issues: [{ ...triage, comment_count: 1 }] })
    expect(
      screen.getByRole('button', { name: 'Triage inbox', description: /1 comment$/ }),
    ).toBeTruthy()
    cleanup()

    renderBoard({ issues: [{ ...triage, comment_count: 5 }], compact: true })
    expect(within(column('Open')).getByRole('listitem').textContent).not.toContain('5')
  })
})

describe('IssueBoard remote changes', () => {
  afterEach(() => {
    cleanup()
    dismissFlash()
  })

  function setup(props: Partial<Props> = {}) {
    const base: Props = {
      issues: [triage, doing, shipped],
      columns: ['in-progress', 'review'],
      selectedIssueUID: null,
      showProject: false,
      scopeKey: 'project-example',
      onOpenIssue: vi.fn(),
      onMoveIssue: vi.fn(async () => true),
      onCompleteIssue: vi.fn(async () => true),
      ...props,
    }
    return render(IssueBoard, { props: base })
  }

  const cardOf = (title: string) => cardButton(title).closest('li')!

  it('flashes a card someone else moved, and a card someone else added', async () => {
    const view = setup()
    expect(cardOf('Triage inbox').classList).not.toContain('remote-change')

    const added = task({ id: 50, uid: 'u-added', title: 'Added by an agent', labels: ['review'] })
    await view.rerender({
      issues: [{ ...triage, labels: ['review'] }, doing, shipped, added],
    })

    expect(within(column('review')).getByRole('button', { name: 'Triage inbox' })).toBeTruthy()
    expect(cardOf('Triage inbox').classList).toContain('remote-change')
    expect(cardOf('Added by an agent').classList).toContain('remote-change')
    expect(cardOf('Write the parser').classList).not.toContain('remote-change')
  })

  it('flashes nothing when the highlight is turned off', async () => {
    const view = setup({ highlightRemoteChanges: false })

    await view.rerender({ issues: [{ ...triage, labels: ['review'] }, doing, shipped] })

    expect(cardOf('Triage inbox').classList).not.toContain('remote-change')
  })

  it('does not flash a card the viewer moved', async () => {
    const view = setup()
    const onMoveIssue = vi.fn(async () => {
      await view.rerender({ issues: [{ ...triage, labels: ['in-progress'] }, doing, shipped] })
      return true
    })
    await view.rerender({ onMoveIssue })

    await fireEvent.keyDown(cardButton('Triage inbox'), { key: 'ArrowRight', altKey: true })

    await waitFor(() => expect(cardOf('Triage inbox').classList).toContain('just-moved'))
    expect(cardOf('Triage inbox').classList).not.toContain('remote-change')
  })

  it('does not flash a card the viewer added from a column', async () => {
    const view = setup()
    const onAddCard = vi.fn(async (title: string) => {
      const mine = task({ id: 80, uid: 'u-mine', title, labels: ['review'] })
      await view.rerender({ issues: [triage, doing, shipped, mine] })
      return true
    })
    await view.rerender({ onAddCard })

    await fireEvent.click(screen.getByRole('button', { name: 'Add card to review' }))
    const input = screen.getByRole('textbox', { name: 'New card in review' })
    await fireEvent.input(input, { target: { value: 'My own card' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onAddCard).toHaveBeenCalled())
    expect(cardOf('My own card').classList).not.toContain('remote-change')
  })

  it('does not flash when the board switches to another project or filter', async () => {
    const view = setup()
    const other = task({ id: 60, uid: 'u-other', title: 'Other project card' })

    await view.rerender({ scopeKey: 'project-other', issues: [other] })

    expect(cardOf('Other project card').classList).not.toContain('remote-change')
  })

  it('does not flash older closed cards that arrive with the next page of Done', async () => {
    const view = setup()
    const older = task({
      id: 70,
      uid: 'u-older',
      title: 'Closed long ago',
      status: 'closed',
      closed_at: '2026-01-01T00:00:00Z',
    })

    await view.rerender({ issues: [triage, doing, shipped, older] })

    expect(cardOf('Closed long ago').classList).not.toContain('remote-change')
  })
})
