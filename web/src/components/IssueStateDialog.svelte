<script lang="ts">
  import { Button } from '@kenn-io/kit-ui'
  import CheckIcon from '@lucide/svelte/icons/check'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import type { KataTaskCloseRequest, KataTaskDetail } from '../lib/kata/types'
  import CompleteIssueDialog from './CompleteIssueDialog.svelte'

  interface Props {
    issue: KataTaskDetail
    onCloseIssue: (request: KataTaskCloseRequest) => boolean | Promise<boolean>
    onReopenIssue: () => void | Promise<void>
  }

  let { issue, onCloseIssue, onReopenIssue }: Props = $props()

  let completeOpen = $state(false)
  let pending = $state(false)
  let trackedUID = $state<string | null>(null)

  $effect(() => {
    if (issue.issue.uid === trackedUID) return
    trackedUID = issue.issue.uid
    completeOpen = false
    pending = false
  })

  async function completeIssue(request: KataTaskCloseRequest): Promise<boolean> {
    const ok = await onCloseIssue(request)
    if (ok) completeOpen = false
    return ok
  }

  async function reopenIssue(): Promise<void> {
    if (pending) return
    pending = true
    try {
      await onReopenIssue()
    } finally {
      pending = false
    }
  }
</script>

{#if issue.issue.status === 'closed'}
  <Button
    class="detail-action"
    size="sm"
    label="Reopen"
    disabled={pending}
    onclick={() => void reopenIssue()}
  >
    <RotateCcwIcon size={13} strokeWidth={1.9} />
  </Button>
{:else}
  <Button
    class="detail-action"
    size="sm"
    tone="info"
    surface="solid"
    label="Complete"
    disabled={pending}
    onclick={() => {
      completeOpen = true
    }}
  >
    <CheckIcon size={13} strokeWidth={1.9} />
  </Button>
{/if}

<CompleteIssueDialog
  open={completeOpen}
  title={issue.issue.title}
  qualifiedId={issue.issue.qualified_id}
  onComplete={completeIssue}
  onCancel={() => {
    completeOpen = false
  }}
/>

<style>
  :global(.detail-action) {
    min-width: 98px;
  }

  :global(.detail-action svg) {
    flex: 0 0 auto;
  }
</style>
