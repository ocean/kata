import { describe, expect, it } from 'vitest'

import { attentionReasons, buildAttentionGroups, needsReviewLabel } from './attention'
import type { KataTaskSummary } from './types'

function task(uid: string, overrides: Partial<KataTaskSummary> = {}): KataTaskSummary {
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
    revision: 1,
    author: 'agent-a',
    labels: [],
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

// `kata notify` stores each request under notify.<unpadded base64url recipient>.
// "coordinator" -> Y29vcmRpbmF0b3I, "lead/reviewer-1" -> bGVhZC9yZXZpZXdlci0x
const coordinatorKey = 'notify.Y29vcmRpbmF0b3I'
const reviewerKey = 'notify.bGVhZC9yZXZpZXdlci0x'

describe('attentionReasons', () => {
  it('reads an agent attention signal with its message', () => {
    expect(
      attentionReasons(
        task('a', {
          metadata: { 'work.attention': 'stuck', 'work.attention_msg': 'CI token expired' },
        }),
      ),
    ).toEqual([{ kind: 'stuck', text: 'Stuck: CI token expired' }])
    expect(attentionReasons(task('b', { metadata: { 'work.attention': 'needs-human' } }))).toEqual([
      { kind: 'needs-human', text: 'Needs a human' },
    ])
  })

  it('ignores attention that is ok, unknown, or on a closed issue', () => {
    expect(attentionReasons(task('a', { metadata: { 'work.attention': 'ok' } }))).toEqual([])
    expect(attentionReasons(task('b', { metadata: { 'work.attention': 'busy' } }))).toEqual([])
    expect(
      attentionReasons(
        task('c', {
          status: 'closed',
          metadata: { 'work.attention': 'stuck' },
          labels: ['needs-review'],
        }),
      ),
    ).toEqual([])
  })

  it('decodes notify requests with their recipient, sender, and message', () => {
    expect(
      attentionReasons(
        task('a', {
          metadata: {
            [coordinatorKey]: { from: 'agent-a', message: 'Please decide on the schema' },
            [reviewerKey]: { from: 'agent-b', teammate: 'tester', message: 'Check the repro' },
          },
        }),
      ),
    ).toEqual([
      { kind: 'request', text: 'Request to coordinator from agent-a: Please decide on the schema' },
      { kind: 'request', text: 'Request to lead/reviewer-1 from agent-b/tester: Check the repro' },
    ])
  })

  it('skips malformed requests', () => {
    expect(
      attentionReasons(
        task('a', {
          metadata: {
            [coordinatorKey]: 'not an object',
            [reviewerKey]: { from: 'agent-b', message: '   ' },
            'notify.!!!': { from: 'agent-c', message: 'bad key' },
          },
        }),
      ),
    ).toEqual([])
  })

  it('treats the needs-review label agents leave as a reason', () => {
    expect(attentionReasons(task('a', { labels: ['bug', needsReviewLabel] }))).toEqual([
      { kind: 'needs-review', text: 'Needs review' },
    ])
  })

  it('lists several reasons most urgent first', () => {
    expect(
      attentionReasons(
        task('a', {
          labels: ['needs-review'],
          metadata: {
            'work.attention': 'needs-human',
            [coordinatorKey]: { from: 'agent-a', message: 'Look here' },
          },
        }),
      ).map((reason) => reason.kind),
    ).toEqual(['needs-human', 'request', 'needs-review'])
  })
})

describe('buildAttentionGroups', () => {
  it('groups open issues by their most urgent reason, in urgency order, and drops the rest', () => {
    const groups = buildAttentionGroups([
      task('review', { labels: ['needs-review'] }),
      task('quiet'),
      task('request', { metadata: { [coordinatorKey]: { from: 'agent-a', message: 'Decide' } } }),
      task('both', { labels: ['needs-review'], metadata: { 'work.attention': 'stuck' } }),
      task('human', { metadata: { 'work.attention': 'needs-human' } }),
    ])

    expect(groups.map((group) => [group.title, group.issues.map((issue) => issue.uid)])).toEqual([
      ['Stuck', ['both']],
      ['Needs a human', ['human']],
      ['Requests', ['request']],
      ['Needs review', ['review']],
    ])
  })

  it('orders issues inside a group by priority', () => {
    const groups = buildAttentionGroups([
      task('low', { priority: 3, metadata: { 'work.attention': 'stuck' } }),
      task('high', { priority: 0, metadata: { 'work.attention': 'stuck' } }),
    ])

    expect(groups[0]!.issues.map((issue) => issue.uid)).toEqual(['high', 'low'])
  })

  it('returns no groups when nothing needs attention', () => {
    expect(buildAttentionGroups([task('quiet')])).toEqual([])
  })
})
