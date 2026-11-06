<script lang="ts">
  import { Button, IconButton, NumberInput } from '@kenn-io/kit-ui'
  import { hashColor } from '@kenn-io/kit-ui/utils/color-hash'
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down'
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up'
  import XIcon from '@lucide/svelte/icons/x'

  import { isBoardColumnLimit, maxBoardColumnLimit, normalizeBoardColumns } from '../lib/kata/board'
  import Modal from './Modal.svelte'

  interface Props {
    open: boolean
    columns: readonly string[]
    /** Labels already in use, offered while typing a new column. */
    suggestions: readonly string[]
    /** Where the columns are stored, shown under the list. */
    savedWhere: string
    /** Card limits for label columns, keyed by label. */
    limits?: Readonly<Record<string, number>> | undefined
    onSave: (columns: string[], limits: Record<string, number>) => boolean | Promise<boolean>
    onClose: () => void
  }

  let { open, columns, suggestions, savedWhere, limits = {}, onSave, onClose }: Props = $props()

  const id = $props.id()
  let draft = $state<string[]>([])
  let newLabel = $state('')
  let error = $state('')
  let saving = $state(false)
  // Limit drafts keyed by label; null means no limit.
  let limitDrafts = $state<Record<string, number | null>>({})
  let wasOpen = false

  $effect(() => {
    if (open && !wasOpen) {
      draft = normalizeBoardColumns(columns)
      newLabel = ''
      error = ''
      limitDrafts = Object.fromEntries(draft.map((label) => [label, limits[label] ?? null]))
    }
    wasOpen = open
  })

  let available = $derived(suggestions.filter((label) => !draft.includes(label)))

  function add(): void {
    const label = newLabel.trim()
    if (!label) return
    if (draft.includes(label)) {
      error = `${label} is already a column.`
      return
    }
    draft = [...draft, label]
    newLabel = ''
    error = ''
  }

  function move(index: number, step: -1 | 1): void {
    const target = index + step
    if (target < 0 || target >= draft.length) return
    const next = [...draft]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    draft = next
  }

  function remove(index: number): void {
    draft = draft.filter((_, position) => position !== index)
  }

  function draftLimits(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const label of draft) {
      const limit = limitDrafts[label]
      if (isBoardColumnLimit(limit)) result[label] = limit
    }
    return result
  }

  async function save(): Promise<void> {
    if (saving) return
    saving = true
    try {
      if (await onSave([...draft], draftLimits())) onClose()
    } finally {
      saving = false
    }
  }
</script>

<Modal {open} title="Board columns" onClose={() => !saving && onClose()} width={420}>
  <div class="editor">
    <p class="hint">
      Each column between Open and Done is a label. Moving a card swaps its column label; Done
      closes the issue. A limit is optional: the column's count turns amber when it holds more cards
      than that.
    </p>
    <ol class="columns" aria-label="Board column order">
      <li class="fixed"><span class="dot" style:--dot="var(--text-muted)"></span>Open</li>
      <li class="labels">
        {#if draft.length === 0}
          <p class="empty">No label columns. Add one below.</p>
        {:else}
          <ul aria-label="Label columns">
            {#each draft as label, index (label)}
              <li data-label={label}>
                <span class="dot" style:--dot={hashColor(label)}></span>
                <span class="name">{label}</span>
                <span class="limit">
                  <NumberInput
                    size="sm"
                    min={1}
                    max={maxBoardColumnLimit}
                    step={1}
                    placeholder="No limit"
                    ariaLabel={`Card limit for ${label}`}
                    disabled={saving}
                    value={limitDrafts[label] ?? null}
                    oninput={(value) => {
                      limitDrafts = { ...limitDrafts, [label]: value }
                    }}
                  />
                </span>
                <IconButton
                  size="sm"
                  ariaLabel={`Move ${label} earlier`}
                  title="Move earlier"
                  disabled={index === 0 || saving}
                  onclick={() => move(index, -1)}
                >
                  <ArrowUpIcon size={13} strokeWidth={2} aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  ariaLabel={`Move ${label} later`}
                  title="Move later"
                  disabled={index === draft.length - 1 || saving}
                  onclick={() => move(index, 1)}
                >
                  <ArrowDownIcon size={13} strokeWidth={2} aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="sm"
                  ariaLabel={`Remove ${label}`}
                  title="Remove column"
                  disabled={saving}
                  onclick={() => remove(index)}
                >
                  <XIcon size={13} strokeWidth={2} aria-hidden="true" />
                </IconButton>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
      <li class="fixed"><span class="dot" style:--dot="var(--accent-green)"></span>Done</li>
    </ol>
    <form
      class="add"
      onsubmit={(event) => {
        event.preventDefault()
        add()
      }}
    >
      <input
        aria-label="New column label"
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? 'true' : undefined}
        list={`${id}-labels`}
        placeholder="Label, e.g. review"
        bind:value={newLabel}
        disabled={saving}
        oninput={() => (error = '')}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            add()
          }
        }}
      />
      <datalist id={`${id}-labels`}>
        {#each available as label (label)}
          <option value={label}></option>
        {/each}
      </datalist>
      <Button size="sm" type="submit" label="Add column" disabled={saving || !newLabel.trim()} />
    </form>
    {#if error}<p class="error" id={`${id}-error`} role="alert">{error}</p>{/if}
    <p class="saved">{savedWhere}</p>
  </div>

  {#snippet footer()}
    <Button size="sm" label="Cancel" onclick={onClose} disabled={saving} />
    <Button
      size="sm"
      tone="info"
      surface="solid"
      label={saving ? 'Saving…' : 'Save columns'}
      ariaLabel="Save columns"
      onclick={() => void save()}
      disabled={saving}
    />
  {/snippet}
</Modal>

<style>
  .editor {
    display: grid;
    gap: var(--space-4);
  }

  .hint,
  .saved {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }

  .columns,
  .columns ul {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .columns li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
    padding: 0 var(--space-2) 0 var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    font-size: var(--font-size-sm);
  }

  .columns li.labels {
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .columns li.fixed {
    border-style: dashed;
    background: transparent;
    color: var(--text-muted);
  }

  .dot {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    margin-inline-end: var(--space-2);
    border-radius: var(--radius-dot);
    background: var(--dot);
  }

  .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    margin: 0;
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    text-align: center;
  }

  .limit {
    width: 84px;
    flex: 0 0 auto;
  }

  .add {
    display: flex;
    gap: var(--space-3);
  }

  .add input {
    min-width: 0;
    flex: 1;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
  }

  .add input:focus {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .error {
    margin: 0;
    color: var(--accent-red);
    font-size: var(--font-size-xs);
  }
</style>
