import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BoardColumnsEditor from './BoardColumnsEditor.svelte'

type Props = ComponentProps<typeof BoardColumnsEditor>

function renderEditor(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    columns: ['in-progress', 'review'],
    suggestions: ['bug', 'blocked', 'review'],
    savedWhere: 'Saved to example-project for everyone who opens its board.',
    onSave: vi.fn(async () => true),
    onClose: vi.fn(),
    ...overrides,
  }
  render(BoardColumnsEditor, { props })
  return { props, dialog: screen.getByRole('dialog', { name: 'Board columns' }) }
}

function listedColumns(dialog: HTMLElement): string[] {
  return within(within(dialog).getByRole('list', { name: 'Label columns' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('data-label') ?? '')
}

describe('BoardColumnsEditor', () => {
  afterEach(() => cleanup())

  it('saves a new label column added with Enter at the end of the list', async () => {
    const { props, dialog } = renderEditor()

    const input = within(dialog).getByRole('combobox', { name: 'New column label' })
    await fireEvent.input(input, { target: { value: ' blocked ' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save columns' }))

    expect(props.onSave).toHaveBeenCalledWith(['in-progress', 'review', 'blocked'])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('reorders and removes columns before saving', async () => {
    const { props, dialog } = renderEditor()

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Move review earlier' }))
    expect(listedColumns(dialog)).toEqual(['review', 'in-progress'])
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove in-progress' }))
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save columns' }))

    expect(props.onSave).toHaveBeenCalledWith(['review'])
  })

  it('refuses a label that is already a column', async () => {
    const { dialog } = renderEditor()

    const input = within(dialog).getByRole('combobox', { name: 'New column label' })
    await fireEvent.input(input, { target: { value: 'review' } })
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Add column' }))

    expect(listedColumns(dialog)).toEqual(['in-progress', 'review'])
    expect(within(dialog).getByText('review is already a column.')).toBeTruthy()
  })

  it('suggests only labels that are not columns yet', () => {
    const { dialog } = renderEditor()

    const options = [...dialog.querySelectorAll('datalist option')].map((option) =>
      option.getAttribute('value'),
    )
    expect(options).toEqual(['bug', 'blocked'])
  })

  it('stays open and keeps the draft when saving fails', async () => {
    const { props, dialog } = renderEditor({ onSave: vi.fn(async () => false) })

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove review' }))
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save columns' }))

    expect(props.onClose).not.toHaveBeenCalled()
    expect(listedColumns(dialog)).toEqual(['in-progress'])
  })
})
