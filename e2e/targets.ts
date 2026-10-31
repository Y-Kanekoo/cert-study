import type { ExamId, Progress } from '../src/shared/types';

export const exams: ExamId[] = ['fe', 'ap', 'jstqb'];
export const isProd = process.env.E2E_TARGET === 'prod';
export const testToken = isProd ? (process.env.E2E_TOKEN ?? '') : 'e2e-test-token-0123456789abcdef0123456789';
export const baseURL = (exam: ExamId): string =>
  isProd
    ? `https://${exam}-study.ykanekoo.workers.dev`
    : `http://127.0.0.1:${{ fe: 8781, ap: 8782, jstqb: 8783 }[exam]}`;
export const hasData = (progress: Progress): boolean =>
  progress.attempts.length > 0 ||
  progress.sessions.length > 0 ||
  progress.srs.length > 0 ||
  progress.retentionChecks.length > 0;
