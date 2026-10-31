import type { MockConfig } from '../src/shared/types';
import { readFileSync } from 'node:fs';
import {
  answerCurrent,
  contentFor,
  expect,
  openExam,
  progressFor,
  resetExam,
  screenshot,
  test,
} from './fixtures';
import { exams } from './targets';

async function startMock(page: import('@playwright/test').Page, config: MockConfig): Promise<void> {
  await page.getByRole('link', { name: '模擬試験' }).click();
  await page.locator(`[data-mock="${config.id}"]`).click();
  await expect(page.locator('#timer')).toBeVisible();
  await expect(page.locator('.palette button')).not.toHaveCount(0);
}

for (const exam of exams) {
  const configs = (
    JSON.parse(readFileSync(`content/${exam}/exam.json`, 'utf8')) as { mockExams: MockConfig[] }
  ).mockExams;
  test.describe(`${exam} 模擬試験`, () => {
    test.beforeEach(async ({ request }) => resetExam(request, exam));

    for (const config of configs) {
      test(`${config.id} タイマー・問題移動・見直し・提出と結果`, async ({ page, request }, testInfo) => {
        const content = await contentFor(request, exam);
        await page.clock.install({ time: new Date('2026-10-31T00:00:00.000Z') });
        await openExam(page, exam, true);
        await startMock(page, config);
        const initial = await page.locator('#timer').textContent();
        await page.clock.fastForward(2000);
        expect(await page.locator('#timer').textContent()).not.toBe(initial);
        await page.locator('#flag').click();
        await expect(page.locator('#flag')).toHaveText('見直し解除');
        await page.locator('#flag').click();
        await expect(page.locator('#flag')).toHaveText('見直しに追加');
        await page.locator('.palette button').nth(1).focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.panel > .inline span').first()).toContainText('2 /');
        await page.locator('#prev').click();
        await expect(page.locator('.panel > .inline span').first()).toContainText('1 /');
        await page.locator('#next').click();
        await page.locator('#prev').click();
        await answerCurrent(page, content, 'correct');
        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#submit').click();
        if (config.selfGraded) {
          await expect(page.getByRole('heading', { name: /自己評価/ })).toBeVisible();
          await expect(page.getByRole('heading', { name: '模範解答' })).toBeVisible();
          await expect(page.getByRole('heading', { name: '採点観点' })).toBeVisible();
          await page.locator('[data-grade="2"]').click();
        }
        await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
        await expect(page.locator('.result')).toContainText('問正解');
        await expect(page.getByText(/合否目安:/)).toBeVisible();
        await expect(page.getByRole('heading', { name: '分野別' })).toBeVisible();
        await expect.poll(async () => (await progressFor(request, exam)).sessions.length).toBe(1);
        await screenshot(page, exam, `mock-${config.id}-result`, testInfo.project.name);
      });
    }

    test('時間切れで自動提出される', async ({ page, request }) => {
      const content = await contentFor(request, exam);
      const config = content.exam.mockExams.find((item) => !item.selfGraded)!;
      await page.clock.install({ time: new Date('2026-10-31T00:00:00.000Z') });
      await openExam(page, exam, true);
      await startMock(page, config);
      await page.clock.fastForward((config.minutes + 1) * 60000);
      await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
      await expect.poll(async () => (await progressFor(request, exam)).sessions.length).toBe(1);
    });

    test('模擬試験2回のスコア推移を SVG に表示', async ({ page, request }, testInfo) => {
      const content = await contentFor(request, exam);
      const config = content.exam.mockExams.find((item) => !item.selfGraded)!;
      await openExam(page, exam, true);
      for (let i = 0; i < 2; i++) {
        await startMock(page, config);
        await answerCurrent(page, content, i === 0 ? 'wrong' : 'correct');
        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#submit').click();
        await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
        await page.locator('#end-run').click();
      }
      await page.getByRole('link', { name: '分析' }).click();
      await expect(page.locator('svg[aria-label="模擬試験スコア推移"] polyline')).toBeVisible();
      const points = await page.locator('svg polyline').getAttribute('points');
      expect(points?.trim().split(' ')).toHaveLength(2);
      await screenshot(page, exam, 'analytics-scores', testInfo.project.name);
    });
  });
}
