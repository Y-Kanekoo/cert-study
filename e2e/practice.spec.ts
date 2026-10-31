import type { Question } from '../src/shared/types';
import {
  answerCurrent,
  contentFor,
  currentQuestion,
  expect,
  openExam,
  progressFor,
  resetExam,
  screenshot,
  test,
} from './fixtures';
import { exams } from './targets';

async function filteredPractice(
  page: import('@playwright/test').Page,
  question: Question,
  count = 1,
): Promise<void> {
  await page.getByRole('link', { name: '練習' }).click();
  await page.locator('[name="topic"]').selectOption(question.topic);
  await page.locator('[name="difficulty"]').selectOption(String(question.difficulty));
  await page.locator('[name="count"]').fill(String(count));
  await page.getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.question')).toBeVisible();
}

for (const exam of exams) {
  test.describe(`${exam} 練習・復習・分析`, () => {
    test.beforeEach(async ({ request }) => resetExam(request, exam));

    test('トピック・難易度・誤答・未回答フィルターと即時解説', async ({ page, request }, testInfo) => {
      const content = await contentFor(request, exam);
      const candidate = content.questions.find(
        (q) =>
          q.type === 'mcq' &&
          content.questions
            .filter((item) => item.topic === q.topic && item.difficulty === q.difficulty)
            .every((item) => item.type === 'mcq'),
      )!;
      await openExam(page, exam);
      await filteredPractice(page, candidate);
      const q = await currentQuestion(page, content);
      expect(q.topic).toBe(candidate.topic);
      expect(q.difficulty).toBe(candidate.difficulty);
      await page.locator('#uncertain').check();
      await answerCurrent(page, content, 'wrong');
      await expect(page.locator('.feedback')).toContainText('不正解');
      await expect(page.locator('.feedback')).toContainText(q.explanation);
      for (const note of q.choiceNotes ?? []) await expect(page.locator('.feedback')).toContainText(note);
      await expect(page.locator(`[data-choice="${q.answer}"]`)).toHaveClass(/correct/);
      await screenshot(page, exam, 'practice-feedback', testInfo.project.name);
      await expect.poll(async () => (await progressFor(request, exam)).attempts.length).toBe(0);
      await page.locator('#next').click();
      await page.locator('#end-run').click();
      await page.locator('[name="wrong"]').check();
      await page.locator('[name="topic"]').selectOption(q.topic);
      await page.locator('[name="difficulty"]').selectOption(String(q.difficulty));
      await page.getByRole('button', { name: '開始' }).click();
      expect((await currentQuestion(page, content)).id).toBe(q.id);
      await answerCurrent(page, content, 'correct');
      await expect(page.locator('.feedback')).toContainText('正解');
      await expect(page.locator(`[data-choice="${q.answer}"]`)).toHaveClass(/correct/);
      await page.locator('#next').click();
      await page.locator('#end-run').click();
      await page.locator('[name="unanswered"]').check();
      await page.getByRole('button', { name: '開始' }).click();
      const next = await currentQuestion(page, content);
      expect(next.id).not.toBe(q.id);
    });

    test('SM-2 の期限到来と復習実行', async ({ page, request }) => {
      const content = await contentFor(request, exam);
      await page.clock.install({ time: new Date('2026-10-31T00:00:00.000Z') });
      await openExam(page, exam, true);
      await filteredPractice(
        page,
        content.questions.find((q) => q.type === 'mcq')!,
      );
      const q = await answerCurrent(page, content, 'wrong');
      await expect.poll(async () => (await progressFor(request, exam)).srs.length).toBe(1);
      const firstDue = (await progressFor(request, exam)).srs[0].dueAt;
      await page.clock.fastForward(2 * 86400000);
      await page.getByRole('link', { name: '復習' }).click();
      await expect(page.getByText(/期限が来た問題: [1-9]/)).toBeVisible();
      await page.locator('#start-review').click();
      expect((await currentQuestion(page, content)).id).toBe(q.id);
      await answerCurrent(page, content, 'correct');
      await expect.poll(async () => (await progressFor(request, exam)).attempts.length).toBe(2);
      expect(Date.parse((await progressFor(request, exam)).srs[0].dueAt)).toBeGreaterThan(
        Date.parse(firstDue),
      );
    });

    test('3日間隔の定着チェックと分析の定着率', async ({ page, request }, testInfo) => {
      const content = await contentFor(request, exam);
      await page.clock.install({ time: new Date('2026-10-31T00:00:00.000Z') });
      await openExam(page, exam, true);
      await filteredPractice(
        page,
        content.questions.find((q) => q.type === 'mcq')!,
      );
      await answerCurrent(page, content, 'correct');
      await page.getByRole('link', { name: '設定' }).click();
      await page.locator('#gap').selectOption('3');
      await page.clock.fastForward(4 * 86400000);
      await page.getByRole('link', { name: '定着チェック' }).click();
      await expect(page.getByText(/4?最後に正解してから3日以上経過: [1-9]/)).toBeVisible();
      await page.locator('#start-retention').click();
      await answerCurrent(page, content, 'correct');
      await expect(page.locator('.feedback')).toHaveCount(0);
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#submit').click();
      await expect(page.getByRole('heading', { name: '結果' })).toBeVisible();
      await expect.poll(async () => (await progressFor(request, exam)).retentionChecks.length).toBe(1);
      await page.getByRole('link', { name: '分析' }).click();
      await expect(page.getByText(/3日: 100%（1問）/)).toBeVisible();
      await screenshot(page, exam, 'analytics-retention', testInfo.project.name);
    });

    test('誤答から弱点トピックを表示し練習へ移動', async ({ page, request }) => {
      const content = await contentFor(request, exam);
      const q = content.questions.find((item) => item.type === 'mcq')!;
      await openExam(page, exam);
      for (let i = 0; i < 2; i++) {
        await filteredPractice(page, q);
        await answerCurrent(page, content, 'wrong');
        await page.locator('#next').click();
        await page.locator('#end-run').click();
      }
      await page.getByRole('link', { name: '分析' }).click();
      await expect(page.getByRole('heading', { name: '弱点トピック' })).toBeVisible();
      await expect(page.locator('[data-weak]')).not.toHaveCount(0);
      await expect(page.getByRole('heading', { name: '大分類別正答率' })).toBeVisible();
      await page.locator('[data-weak]').first().click();
      await expect(page.locator('[name="topic"]')).not.toHaveValue('');
    });
  });
}

test.describe('形式別の練習', () => {
  test.beforeEach(async ({ request }) => {
    await resetExam(request, 'fe');
    await resetExam(request, 'ap');
    await resetExam(request, 'jstqb');
  });

  test('JSTQB 複数選択の件数制御・正誤', async ({ page, request }) => {
    const content = await contentFor(request, 'jstqb');
    const target = content.questions.find((q) => q.type === 'multi')!;
    await openExam(page, 'jstqb');
    for (const result of ['correct', 'wrong'] as const) {
      await filteredPractice(page, target, 100);
      for (let i = 0; i < 100; i++) {
        const q = await currentQuestion(page, content);
        if (q.type === 'multi') {
          await expect(page.locator('#multi-answer')).toBeDisabled();
          await page.locator(`[data-multi="${q.answers![0]}"]`).check();
          await expect(page.locator('#multi-answer')).toBeDisabled();
          await page.locator(`[data-multi="${q.answers![0]}"]`).uncheck();
          await answerCurrent(page, content, result);
          await expect(page.locator('.feedback')).toContainText(result === 'correct' ? '正解' : '不正解');
          await expect(page.locator('.choice.correct')).toHaveCount(q.answers!.length);
          break;
        }
        await answerCurrent(page, content, 'correct');
        await page.locator('#next').click();
      }
      await page.getByRole('link', { name: 'ホーム' }).click();
    }
  });

  test('AP 科目B 記述の模範解答と自己採点', async ({ page, request }) => {
    const content = await contentFor(request, 'ap');
    const target = content.questions.find(
      (q) =>
        q.type === 'self' &&
        content.questions
          .filter((item) => item.topic === q.topic && item.difficulty === q.difficulty)
          .every((item) => item.type === 'self'),
    )!;
    await openExam(page, 'ap');
    await filteredPractice(page, target);
    const q = await currentQuestion(page, content);
    await expect(page.locator('#next')).toBeDisabled();
    await page.locator('#self-text').fill('自分の記述回答');
    await page.locator('#self-reveal').click();
    await expect(page.locator('.feedback')).toContainText(q.modelAnswer!);
    for (const point of q.rubric ?? []) await expect(page.locator('.feedback')).toContainText(point);
    await expect(page.locator('#next')).toBeDisabled();
    await page.locator('[data-score="2"]').click();
    await expect(page.locator('#next')).toBeEnabled();
  });

  test('FE 科目B 擬似言語を等幅で表示', async ({ page, request }) => {
    const content = await contentFor(request, 'fe');
    const target = content.questions.find((q) => q.section === 'B' && q.code)!;
    await openExam(page, 'fe');
    await filteredPractice(page, target, 100);
    for (let i = 0; i < 100; i++) {
      const q = await currentQuestion(page, content);
      if (q.code) {
        await expect(page.locator('pre.code')).toContainText(q.code);
        expect(
          await page.locator('pre.code').evaluate((element) => getComputedStyle(element).fontFamily),
        ).toMatch(/mono/i);
        return;
      }
      await answerCurrent(page, content, 'correct');
      await page.locator('#next').click();
    }
    throw new Error('擬似言語の問題が表示されませんでした');
  });
});
