import { readFile, writeFile } from 'node:fs/promises';
import type { Progress } from '../src/shared/types';
import { verifyRestorable } from './backup';
import { baseURL, exams, hasData, isProd, testToken } from './targets';

export default async function globalTeardown(): Promise<void> {
  if (!isProd || !testToken) return;
  const state = JSON.parse(await readFile('e2e-results/active.json', 'utf8')) as { active: boolean };
  if (!state.active) return;
  const failures: string[] = [];
  for (const exam of exams) {
    try {
      const url = `${baseURL(exam)}/api/progress`;
      const headers = { Authorization: `Bearer ${testToken}` };
      const reset = await fetch(url, { method: 'DELETE', headers: { ...headers, 'X-Confirm': 'reset' } });
      if (!reset.ok) throw new Error(`${exam}: テスト履歴の削除に失敗しました (${reset.status})`);
      const emptyResponse = await fetch(url, { headers });
      if (!emptyResponse.ok) throw new Error(`${exam}: 削除後の検証に失敗しました`);
      const empty = (await emptyResponse.json()) as Progress;
      if (hasData(empty)) throw new Error(`${exam}: テスト履歴が残っています`);
      const backup = JSON.parse(await readFile(`e2e-results/backup-${exam}.json`, 'utf8')) as Progress;
      if (hasData(backup)) {
        const restore = await fetch(`${baseURL(exam)}/api/import`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ attempts: verifyRestorable(backup), sessions: backup.sessions }),
        });
        if (!restore.ok) throw new Error(`${exam}: バックアップの復元に失敗しました (${restore.status})`);
        const verifiedResponse = await fetch(url, { headers });
        if (!verifiedResponse.ok) throw new Error(`${exam}: 復元後の検証に失敗しました`);
        const verified = (await verifiedResponse.json()) as Progress;
        if (
          verified.attempts.length !== backup.attempts.length ||
          verified.sessions.length !== backup.sessions.length ||
          verified.srs.length !== backup.srs.length ||
          verified.retentionChecks.length !== backup.retentionChecks.length
        )
          throw new Error(`${exam}: バックアップの件数が一致しません`);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${exam}: 復元に失敗しました`);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  await writeFile('e2e-results/active.json', JSON.stringify({ active: false }));
}
