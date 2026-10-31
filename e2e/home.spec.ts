import {
  answerCurrent,
  contentFor,
  currentQuestion,
  expect,
  openExam,
  progressFor,
  resetExam,
  screenshot,
  startPractice,
  test,
} from './fixtures';
import { baseURL, exams, testToken } from './targets';
import { isProd } from './targets';
import { mockTypes } from '../src/shared/study';

for (const exam of exams) {
  test.describe(`${exam} 基本画面`, () => {
    test.beforeEach(async ({ request }) => resetExam(request, exam));

    test('トップ表示・件数・ナビゲーション @smoke', async ({ page, request }, testInfo) => {
      const content = await contentFor(request, exam);
      const health = (await (await request.get(`${baseURL(exam)}/api/health`)).json()) as {
        questionCount: number;
      };
      await openExam(page, exam);
      await expect(page).toHaveTitle(content.exam.appTitle);
      await expect(page.getByRole('heading', { name: content.exam.appTitle })).toBeVisible();
      for (const label of ['今日の復習', '定着率', '解答数', '正答率', '連続学習日数'])
        await expect(page.locator('.card').filter({ hasText: label })).toBeVisible();
      await expect(page.locator('.source a')).toHaveAttribute('href', content.syllabus.source.url);
      await expect(page.locator('.source a')).toContainText(content.syllabus.source.version);
      for (const name of ['ホーム', 'シラバス', '練習', '復習', '定着チェック', '模擬試験', '分析', '設定'])
        await expect(page.getByRole('navigation').getByRole('link', { name })).toBeVisible();
      expect(health.questionCount).toBe(content.questions.length);
      await page.getByRole('link', { name: '模擬試験' }).click();
      await expect(page.locator('[data-mock]')).toHaveCount(content.exam.mockExams.length);
      for (const config of content.exam.mockExams) {
        const count = content.questions.filter(
          (question) => question.section === config.section && mockTypes(config).includes(question.type),
        ).length;
        await expect(page.locator(`[data-mock="${config.id}"]`).locator('..')).toContainText(
          `収録 ${count}問`,
        );
      }
      await page.getByRole('link', { name: 'ホーム' }).click();
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth)).toBe(true);
      await screenshot(page, exam, 'home', testInfo.project.name);
    });

    test('シラバスの階層とトピック練習 @smoke', async ({ page, request }, testInfo) => {
      const content = await contentFor(request, exam);
      await openExam(page, exam);
      await page.getByRole('navigation').getByRole('link', { name: 'シラバス' }).click();
      await expect(page.locator('details')).not.toHaveCount(0);
      await page.locator('details > summary').first().click();
      const leaf = content.questions[0].topic;
      const detail = page
        .locator('details')
        .filter({ has: page.locator(`[data-topic="${leaf}"]`) })
        .last();
      await detail.evaluate((element) => {
        let parent = element.parentElement?.closest('details');
        while (parent) {
          parent.open = true;
          parent = parent.parentElement?.closest('details');
        }
      });
      await expect(detail.locator('summary .stats')).toContainText('問');
      await detail.locator(`[data-topic="${leaf}"]`).click();
      await expect(page.locator('[name="topic"]')).toHaveValue(leaf);
      await screenshot(page, exam, 'topic-practice', testInfo.project.name);
    });

    test('ローカル履歴・設定・リロード後の状態保持', async ({ page, request }) => {
      const content = await contentFor(request, exam);
      await openExam(page, exam);
      await startPractice(page);
      await answerCurrent(page, content, 'wrong');
      await expect(page.locator('.feedback')).toContainText('不正解');
      await page.getByRole('link', { name: '設定' }).click();
      await page.locator('#gap').selectOption('3');
      const stored = await page.evaluate(
        (id) =>
          JSON.parse(localStorage.getItem(`cert-study:${id}:progress`) ?? '{}') as { attempts?: unknown[] },
        exam,
      );
      expect(stored.attempts).toHaveLength(1);
      await page.reload();
      await expect(page.locator('#gap')).toHaveValue('3');
      await expect(page.getByText('現在: ローカル保存')).toBeVisible();
      await page.getByRole('link', { name: 'ホーム' }).click();
      await expect(page.locator('.card').filter({ hasText: '解答数' })).toContainText('1問');
    });

    test('トークン URL・サーバー同期・別コンテキスト', async ({ page, request, browser }) => {
      const content = await contentFor(request, exam);
      await openExam(page, exam);
      if (isProd) {
        await page.getByRole('link', { name: '設定' }).click();
        await page.locator('[name="token"]').fill(testToken);
        await page.getByRole('button', { name: '保存して接続' }).click();
      } else {
        await page.evaluate((token) => {
          location.hash = `token=${encodeURIComponent(token)}`;
        }, testToken);
        await page.reload();
        await expect.poll(() => page.evaluate(() => location.hash === '')).toBe(true);
      }
      await expect(page.locator('body')).not.toContainText(testToken);
      await page.getByRole('link', { name: '設定' }).click();
      await expect(page.getByText('現在: サーバー保存')).toBeVisible();
      await startPractice(page);
      await answerCurrent(page, content, 'correct');
      await expect.poll(async () => (await progressFor(request, exam)).attempts.length).toBe(1);
      await page.reload();
      await expect(page.locator('.feedback')).toHaveCount(0);
      const second = await browser.newContext();
      try {
        const other = await second.newPage();
        await other.goto(baseURL(exam));
        await other.evaluate(({ id, token }) => localStorage.setItem(`cert-study:${id}:token`, token), {
          id: exam,
          token: testToken,
        });
        await other.reload();
        await other.getByRole('link', { name: 'ホーム' }).click();
        await expect(other.locator('.card').filter({ hasText: '解答数' })).toContainText('1問');
      } finally {
        await second.close();
      }
    });

    test('設定フォーム・履歴書き出し・取り込み・リセット', async ({ page, request }, testInfo) => {
      const content = await contentFor(request, exam);
      await openExam(page, exam);
      await startPractice(page);
      await answerCurrent(page, content, 'correct');
      await page.getByRole('link', { name: '設定' }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`${exam}-progress.json`);
      const data = JSON.parse(
        await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'),
      ) as { attempts: unknown[]; srs: unknown[]; sessions: unknown[]; retentionChecks: unknown[] };
      expect(data.attempts).toHaveLength(1);
      expect(data.srs).toHaveLength(1);
      expect(data.sessions).toHaveLength(0);
      expect(data.retentionChecks).toHaveLength(0);
      await page.locator('[name="token"]').fill(testToken);
      await page.getByRole('button', { name: '保存して接続' }).click();
      await expect(page.getByText('現在: サーバー保存')).toBeVisible();
      await expect(page.locator('#import')).toBeEnabled();
      await page.locator('#import').click();
      await expect.poll(async () => (await progressFor(request, exam)).attempts.length).toBe(1);
      await screenshot(page, exam, 'settings', testInfo.project.name);
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#reset').click();
      await expect.poll(async () => (await progressFor(request, exam)).attempts.length).toBe(0);
      expect(await page.evaluate((id) => localStorage.getItem(`cert-study:${id}:progress`), exam)).toBeNull();
    });

    test('不正トークンで安全にローカル保存へ戻る', async ({ page }) => {
      await page.goto(`${baseURL(exam)}/#token=wrong`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('トークンを確認');
      await page.getByRole('link', { name: '設定' }).click();
      await expect(page.getByText('現在: ローカル保存')).toBeVisible();
    });

    test('キーボード操作と画面幅', async ({ page, request }) => {
      const content = await contentFor(request, exam);
      await openExam(page, exam);
      await page.keyboard.press('Tab');
      const homeLink = page.getByRole('navigation').getByRole('link', { name: 'ホーム' });
      await expect(homeLink).toBeFocused();
      expect(await homeLink.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('navigation').getByRole('link', { name: 'シラバス' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'シラバス', exact: true })).toBeVisible();
      await page.getByRole('link', { name: '練習' }).click();
      const candidate = content.questions.find(
        (item) =>
          item.type === 'mcq' &&
          content.questions
            .filter((other) => other.topic === item.topic && other.difficulty === item.difficulty)
            .every((other) => other.type === 'mcq'),
      )!;
      await page.locator('[name="topic"]').selectOption(candidate.topic);
      await page.locator('[name="difficulty"]').selectOption(String(candidate.difficulty));
      await page.locator('[name="count"]').fill('1');
      await page.getByRole('button', { name: '開始' }).focus();
      await page.keyboard.press('Space');
      await expect(page.locator('.question')).toBeVisible();
      const question = await currentQuestion(page, content);
      await page.locator('#uncertain').focus();
      await page.keyboard.press('Space');
      await expect(page.locator('#uncertain')).toBeChecked();
      const choice = page.locator(`[data-choice="${question.answer}"]`);
      await choice.focus();
      expect(await choice.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      await page.keyboard.press('Enter');
      await expect(page.locator('.feedback')).toContainText('正解');
      await page.locator('#next').focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('link', { name: '分析' }).click();
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}
