import { test, expect } from '@playwright/test';
import { signInLocal, startMatch, expectTurn, cricketTurn, cricketMisses } from './helpers';

test('cricket: pass-and-play, close every number and win on points', async ({ page }) => {
  await signInLocal(page, 'CricketHero');
  await startMatch(page, { mode: 'cricket', opponents: ['CricketFoe'] });

  // Hero closes 20/19/18, then 17/16/15, then the bull — Foe whiffs throughout.
  // Closing exactly (3 marks) scores no points, so both finish on 0: 0 >= 0 wins.
  await expectTurn(page, 'CricketHero');
  await cricketTurn(page, [['Treble', '20'], ['Treble', '19'], ['Treble', '18']]);

  await expectTurn(page, 'CricketFoe');
  await cricketMisses(page);

  await expectTurn(page, 'CricketHero');
  await cricketTurn(page, [['Treble', '17'], ['Treble', '16'], ['Treble', '15']]);

  await expectTurn(page, 'CricketFoe');
  await cricketMisses(page);

  // Close the bull: double-bull (2 marks) + single-bull (1 mark) = 3 → closed.
  await expectTurn(page, 'CricketHero');
  await cricketTurn(page, [['Double', 'Bull'], ['Single', 'Bull'], ['Single', 'Miss']]);

  await expect(page.locator('.review-banner')).toContainText('CricketHero Wins!');
});
