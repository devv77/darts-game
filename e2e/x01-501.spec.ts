import { test, expect } from '@playwright/test';
import { signInLocal, startMatch, expectTurn, quickScore } from './helpers';

test('501 single-leg: pass-and-play to a double-out win', async ({ page }) => {
  await signInLocal(page, 'Tester');
  await startMatch(page, { mode: '501', opponents: ['Opponent'] });

  // Tester drives down to 41 on quick scores; Opponent throws 26s in between.
  // 501 - 180 - 180 - 100 = 41.
  await expectTurn(page, 'Tester');
  await quickScore(page, 180);
  await expectTurn(page, 'Opponent');
  await quickScore(page, 26);

  await expectTurn(page, 'Tester');
  await quickScore(page, 180);
  await expectTurn(page, 'Opponent');
  await quickScore(page, 26);

  await expectTurn(page, 'Tester');
  await quickScore(page, 100);
  await expectTurn(page, 'Opponent');
  await quickScore(page, 26);

  // Tester is on 41 — quick entry can't check out (no provable double), so
  // finish dart-by-dart: S9 (→32) then D16 (→0).
  await expectTurn(page, 'Tester');
  await page.getByRole('button', { name: 'Switch to Dart-by-Dart' }).click();

  const pad = page.locator('.dart-by-dart');
  // Single is the default multiplier — throw S9.
  await pad.locator('.number-grid').getByRole('button', { name: '9', exact: true }).click();
  // Switch to Double and throw D16 to land on zero.
  await pad.getByRole('button', { name: 'Double', exact: true }).click();
  await pad.locator('.number-grid').getByRole('button', { name: '16', exact: true }).click();

  // The pad recognises the finish before we confirm.
  await expect(pad).toContainText('Game shot!');
  await pad.getByRole('button', { name: 'Confirm Turn' }).click();

  // Win → post-match review banner.
  await expect(page.locator('.review-banner')).toContainText('Tester Wins!');
});
