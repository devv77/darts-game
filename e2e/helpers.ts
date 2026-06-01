import { type Page, expect } from '@playwright/test';

/** Sign in via the self-hosted passwordless local form, land on the home picker. */
export async function signInLocal(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Enter your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  // Sign-in is complete once the session is stored and the mode picker renders.
  await expect(page.getByRole('heading', { name: 'Play a Match' })).toBeVisible();
}

/**
 * From the home picker, set up a single-device match: the signed-in user is the
 * first player, each name in `opponents` is created + selected as a guest, then
 * the bull-throw is skipped so play order is exactly [you, ...opponents].
 */
export async function startMatch(
  page: Page,
  opts: { mode: '501' | '301' | 'cricket'; opponents: string[] },
): Promise<void> {
  await page.goto(`/setup?mode=${opts.mode}`);
  for (const name of opts.opponents) {
    await page.getByPlaceholder('Add local player (guest)').fill(name);
    await page.locator('form.inline-form').getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('.player-select-btn', { hasText: name }).click();
  }
  await page.getByRole('button', { name: new RegExp(`Start ${opts.mode} Game`, 'i') }).click();
  // 2+ players trigger the bull-throw overlay; skip it for a deterministic order.
  await page.getByRole('button', { name: 'Skip bull throw' }).click();
  await expect(page).toHaveURL(/\/game\?id=\d+/);
}

/** Assert (waiting) that it is `name`'s turn. */
export async function expectTurn(page: Page, name: string): Promise<void> {
  await expect(page.locator('.current-turn-info')).toContainText(`${name}'s turn`);
}

/** Enter a score on the X01 quick numpad and submit it. */
export async function quickScore(page: Page, score: number): Promise<void> {
  const pad = page.locator('.numpad-keys');
  for (const digit of String(score)) {
    await pad.getByRole('button', { name: digit, exact: true }).click();
  }
  await pad.getByRole('button', { name: 'OK', exact: true }).click();
}

type Mult = 'Single' | 'Double' | 'Treble';

/**
 * Enter one cricket turn. Each dart is [multiplier, target] where target is a
 * number string ('20'…'15') or 'Bull'. Use cricketMisses() for whiffed turns.
 */
export async function cricketTurn(
  page: Page,
  darts: Array<[Mult, string]>,
): Promise<void> {
  const input = page.locator('#cricket-input');
  for (const [mult, target] of darts) {
    await input.locator('.multiplier-toggle').getByRole('button', { name: mult, exact: true }).click();
    await input.locator('.cricket-input-grid').getByRole('button', { name: target, exact: true }).click();
  }
  await input.getByRole('button', { name: 'Confirm Turn' }).click();
}

/** Throw three misses and confirm (used to pass the turn back). */
export async function cricketMisses(page: Page): Promise<void> {
  const input = page.locator('#cricket-input');
  for (let i = 0; i < 3; i++) {
    await input.locator('.cricket-input-grid').getByRole('button', { name: 'Miss', exact: true }).click();
  }
  await input.getByRole('button', { name: 'Confirm Turn' }).click();
}
