import { expect, test } from './fixtures'

test.use({ trace: 'off' })

test('Needs attention keeps titles readable beside their badge on a phone', async ({
  page,
  kata,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const credentials = await kata.launch(page)
  const issue = await kata.seedIssue(page, credentials, {
    title: 'Design the settings page layout',
    metadata: { 'work.attention': 'stuck', 'work.attention_msg': 'Waiting on a decision' },
  })
  await page.goto(`${kata.origin}/kata?view=attention`)

  await expect(page.getByRole('heading', { name: /^Stuck/, level: 3 })).toBeVisible()
  const row = page.locator(`[data-uid="${issue.uid}"]`)
  await expect(row.locator('.attention-badge')).toHaveText('Stuck')

  // The badge must not squeeze the title into a sliver: on a phone it wraps
  // below the title instead.
  const titleWidth = await row
    .locator('.title-text')
    .evaluate((el) => el.getBoundingClientRect().width)
  expect(titleWidth).toBeGreaterThanOrEqual(120)
})
