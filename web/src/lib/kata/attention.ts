// "Needs attention": open issues where an agent or a person is waiting on a
// human. Every signal is already in the snapshot: agents' work.attention
// metadata, `kata notify` requests stored as notify.* metadata, and the
// needs-review label the default agent contract asks agents to leave.

import type { KataTaskGroup, KataTaskSummary } from './types'

export type AttentionKind = 'stuck' | 'needs-human' | 'request' | 'needs-review'

export interface AttentionReason {
  kind: AttentionKind
  text: string
}

export const needsReviewLabel = 'needs-review'

// Most urgent first; groups and reasons follow this order.
const attentionOrder: readonly AttentionKind[] = ['stuck', 'needs-human', 'request', 'needs-review']

const groupTitles: Record<AttentionKind, string> = {
  stuck: 'Stuck',
  'needs-human': 'Needs a human',
  request: 'Requests',
  'needs-review': 'Needs review',
}

export const attentionBadgeLabels: Record<AttentionKind, string> = {
  stuck: 'Stuck',
  'needs-human': 'Needs you',
  request: 'Request',
  'needs-review': 'Review',
}

const notifyPrefix = 'notify.'

/** Why an open issue needs attention, most urgent first; empty when it does not. */
export function attentionReasons(issue: KataTaskSummary): AttentionReason[] {
  if (issue.status !== 'open') return []
  const reasons: AttentionReason[] = []
  const metadata = issue.metadata
  const attention = metadata['work.attention']
  const message = textValue(metadata['work.attention_msg'])
  if (attention === 'stuck') {
    reasons.push({ kind: 'stuck', text: message ? `Stuck: ${message}` : 'Stuck' })
  } else if (attention === 'needs-human') {
    reasons.push({
      kind: 'needs-human',
      text: message ? `Needs a human: ${message}` : 'Needs a human',
    })
  }
  for (const key of Object.keys(metadata).sort()) {
    if (!key.startsWith(notifyPrefix)) continue
    const request = notifyRequest(key.slice(notifyPrefix.length), metadata[key])
    if (request) reasons.push({ kind: 'request', text: request })
  }
  if (issue.labels?.includes(needsReviewLabel)) {
    reasons.push({ kind: 'needs-review', text: 'Needs review' })
  }
  return reasons
}

export function hasAttention(issue: KataTaskSummary): boolean {
  return attentionReasons(issue).length > 0
}

/** Groups open issues by their most urgent reason, in urgency order. */
export function buildAttentionGroups(issues: readonly KataTaskSummary[]): KataTaskGroup[] {
  const groups = new Map<AttentionKind, KataTaskSummary[]>()
  for (const issue of issues) {
    const first = attentionReasons(issue)[0]
    if (!first) continue
    const group = groups.get(first.kind) ?? []
    group.push(issue)
    groups.set(first.kind, group)
  }
  return attentionOrder
    .filter((kind) => groups.has(kind))
    .map((kind) => ({
      id: `attention-${kind}`,
      title: groupTitles[kind],
      issues: [...groups.get(kind)!].sort(byPriorityThenTitle),
    }))
}

function notifyRequest(encodedRecipient: string, value: unknown): string | undefined {
  const recipient = decodeRecipient(encodedRecipient)
  if (!recipient || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const fields = value as Record<string, unknown>
  const message = textValue(fields.message)
  if (!message) return undefined
  const from = textValue(fields.from)
  const teammate = textValue(fields.teammate)
  const sender = from ? (teammate ? `${from}/${teammate}` : from) : undefined
  return `Request to ${recipient}${sender ? ` from ${sender}` : ''}: ${message}`
}

// Recipients are stored as unpadded base64url of the UTF-8 handle.
function decodeRecipient(encoded: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
    const handle = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
    return handle || undefined
  } catch {
    return undefined
  }
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function byPriorityThenTitle(a: KataTaskSummary, b: KataTaskSummary): number {
  const ap = a.priority ?? Number.MAX_SAFE_INTEGER
  const bp = b.priority ?? Number.MAX_SAFE_INTEGER
  if (ap !== bp) return ap - bp
  return a.title.localeCompare(b.title) || a.uid.localeCompare(b.uid)
}
