import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { ExamConfig, ExamId, Progress, Question, Syllabus } from '../src/shared/types';
import { baseURL, isProd, testToken } from './targets';

export type Content = { exam: ExamConfig; syllabus: Syllabus; questions: Question[] };
type ConsoleEntry = { type: string; text: string; url: string };

export const test = base.extend<{ cleanConsole: void }>({
  cleanConsole: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      const warnings: ConsoleEntry[] = [];
      page.on('pageerror', (error) => errors.push(`ページ例外: ${error.message}`));
      page.on('console', (message) => {
        const entry = { type: message.type(), text: message.text(), url: message.location().url };
        if (entry.type === 'warning') warnings.push(entry);
        if (entry.type === 'error') {
          const expected401 =
            testInfo.title.includes('不正トークン') &&
            entry.url.endsWith('/api/auth/check') &&
            /^Failed to load resource: the server responded with a status of 401/.test(entry.text);
          if (!expected401) errors.push(`コンソールエラー: ${entry.text.replaceAll(testToken, '[MASKED]')}`);
        }
      });
      await use();
      if (warnings.length && !isProd)
        await testInfo.attach('console-warnings', {
          body: warnings.map((entry) => `${entry.url}: ${entry.text}`).join('\n'),
          contentType: 'text/plain',
        });
      expect(errors, 'ブラウザーコンソールとページ例外').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function contentFor(request: APIRequestContext, exam: ExamId): Promise<Content> {
  const response = await request.get(`${baseURL(exam)}/api/content`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Content;
}

export async function progressFor(request: APIRequestContext, exam: ExamId): Promise<Progress> {
  const response = await request.get(`${baseURL(exam)}/api/progress`, {
    headers: { Authorization: `Bearer ${testToken}` },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Progress;
}

export async function resetExam(request: APIRequestContext, exam: ExamId): Promise<void> {
  const response = await request.delete(`${baseURL(exam)}/api/progress`, {
    headers: { Authorization: `Bearer ${testToken}`, 'X-Confirm': 'reset' },
  });
  expect(response.ok()).toBeTruthy();
}

export async function openExam(page: Page, exam: ExamId, server = false): Promise<void> {
  await page.goto(baseURL(exam));
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  if (server)
    await page.evaluate(({ id, token }) => localStorage.setItem(`cert-study:${id}:token`, token), {
      id: exam,
      token: testToken,
    });
  await page.reload();
  await expect(page.locator('h1')).toBeVisible();
  if (server) {
    await page.getByRole('link', { name: '設定' }).click();
    await expect(page.getByText('現在: サーバー保存')).toBeVisible();
  }
}

export async function screenshot(page: Page, exam: ExamId, step: string, project: string): Promise<void> {
  const dir = `e2e-results/screenshots/${isProd ? 'prod' : 'local'}/${project}`;
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${exam}-${step}.png`,
    fullPage: true,
    caret: 'initial',
    animations: 'allow',
  });
}

export async function currentQuestion(page: Page, content: Content): Promise<Question> {
  const text = (await page.locator('.question').textContent())?.trim();
  const question = content.questions.find((item) => item.question.trim() === text);
  expect(question, '画面の問題文に対応する公開コンテンツ').toBeDefined();
  return question!;
}

export async function answerCurrent(
  page: Page,
  content: Content,
  result: 'correct' | 'wrong',
): Promise<Question> {
  const question = await currentQuestion(page, content);
  if (question.type === 'mcq') {
    const choice =
      result === 'correct' ? question.answer! : (question.answer! + 1) % (question.choices?.length ?? 4);
    await page.locator(`[data-choice="${choice}"]`).click();
  } else if (question.type === 'multi') {
    const correct = question.answers ?? [];
    const chosen =
      result === 'correct'
        ? correct
        : [
            ...correct.slice(0, -1),
            Array.from({ length: question.choices?.length ?? 0 }, (_, index) => index).find(
              (index) => !correct.includes(index),
            )!,
          ];
    for (const index of chosen) await page.locator(`[data-multi="${index}"]`).check();
    await page.locator('#multi-answer').click();
  } else {
    await page.locator('#self-text').fill(result === 'correct' ? '採点観点を含む回答' : '不十分な回答');
    if (await page.locator('#self-reveal').count()) {
      await page.locator('#self-reveal').click();
      await page.locator(`[data-score="${result === 'correct' ? 2 : 0}"]`).click();
    }
  }
  return question;
}

export async function startPractice(page: Page, count = 1): Promise<void> {
  await page.getByRole('link', { name: '練習' }).click();
  await page.locator('[name="count"]').fill(String(count));
  await page.getByRole('button', { name: '開始' }).click();
  await expect(page.locator('.question')).toBeVisible();
}
