import { mkdir, writeFile } from 'node:fs/promises';
import type { Progress } from '../src/shared/types';
import { verifyRestorable } from './backup';
import { baseURL, exams, hasData, isProd, testToken } from './targets';

export default async function globalSetup(): Promise<void> {
  if (!isProd) return;
  if (!testToken) throw new Error('本番 E2E には E2E_TOKEN が必要です');
  await mkdir('e2e-results', { recursive: true });
  await writeFile('e2e-results/active.json', JSON.stringify({ active: false }));
  const backups: { exam: string; data: Progress }[] = [];
  for (const exam of exams) {
    const response = await fetch(`${baseURL(exam)}/api/progress`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    if (!response.ok) throw new Error(`${exam}: 進捗のバックアップに失敗しました (${response.status})`);
    const data = (await response.json()) as Progress;
    await writeFile(`e2e-results/backup-${exam}.json`, JSON.stringify(data, null, 2));
    backups.push({ exam, data });
  }
  if (backups.some(({ data }) => hasData(data)) && process.env.E2E_ALLOW_EXISTING !== '1')
    throw new Error('既存の学習履歴があります。実行には E2E_ALLOW_EXISTING=1 が必要です');
  for (const { exam, data } of backups)
    if (hasData(data)) {
      try {
        verifyRestorable(data);
        const contentResponse = await fetch(`${baseURL(exam as 'fe' | 'ap' | 'jstqb')}/api/content`);
        if (!contentResponse.ok) throw new Error('問題コンテンツを読めません');
        const content = (await contentResponse.json()) as { questions: { id: string }[] };
        const ids = new Set(content.questions.map((question) => question.id));
        if (data.attempts.some((attempt) => !ids.has(attempt.questionId)))
          throw new Error('現在の問題バンクに存在しない解答があります');
      } catch {
        throw new Error(`${exam}: 現行 API では履歴を完全に復元できないため、本番 E2E を中止しました`);
      }
    }
  await writeFile('e2e-results/active.json', JSON.stringify({ active: true }));
  for (const { exam } of backups) {
    const response = await fetch(`${baseURL(exam as 'fe' | 'ap' | 'jstqb')}/api/progress`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${testToken}`, 'X-Confirm': 'reset' },
    });
    if (!response.ok) throw new Error(`${exam}: テスト前の初期化に失敗しました (${response.status})`);
  }
}
