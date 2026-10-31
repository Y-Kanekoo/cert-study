import {
  aggregateTopics,
  composeMock,
  mockTypes,
  retentionRates,
  scoreHistory,
  selectRetention,
  weakTopics,
} from '../shared/study';
import { dueQueue, updateSrs } from '../shared/sm2';
import { isCorrectChoice, selectedIndices } from '../shared/grading';
import { inSubtree, topicMap } from '../shared/content';
import {
  emptyProgress,
  type Attempt,
  type ExamConfig,
  type Progress,
  type Question,
  type Session,
  type Syllabus,
} from '../shared/types';
import { choiceLabel, homeStats, remainingMs } from './logic';

type Content = { exam: ExamConfig; syllabus: Syllabus; questions: Question[] };
type RunMode = 'practice' | 'review' | 'retention' | 'mock';
type Answer = { choice?: number | null; selfText?: string; selfScore?: number; elapsedMs: number };
type Run = {
  mode: RunMode;
  questions: Question[];
  current: number;
  answers: Record<string, Answer>;
  drafts: Record<string, number>;
  orders: Record<string, number[]>;
  flags: Set<string>;
  uncertain: Set<string>;
  startedAt: string;
  questionAt: number;
  gapDays?: number;
  mockId?: string;
  minutes?: number;
  passRatio?: number;
  stage: 'answering' | 'grading' | 'result';
  gradingIndex: number;
  feedback?: string;
};

const root = document.getElementById('app');
if (!root) throw new Error('画面の初期化に失敗しました');
let content: Content;
let progress: Progress = emptyProgress();
let mode: 'local' | 'server' = 'local';
let banner = '';
let run: Run | null = null;
let tick: ReturnType<typeof setInterval> | null = null;
const esc = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
const $ = <T extends Element = Element>(selector: string): T | null => document.querySelector<T>(selector);
const pct = (value: number | null): string => (value === null ? '—' : `${Math.round(value * 100)}%`);
const now = (): string => new Date().toISOString();
const qs = (): URLSearchParams => new URLSearchParams(location.hash.slice(1).split('?')[1] ?? '');
const page = (): string => location.hash.slice(1).split('?')[0] || 'home';
const baseKey = (): string => `cert-study:${content.exam.exam}`;
const tokenKey = (): string => `${baseKey()}:token`;
const localKey = (): string => `${baseKey()}:progress`;
const gapKey = (): string => `${baseKey()}:gap`;
const gap = (): number => {
  const value = Number(localStorage.getItem(gapKey()));
  return [3, 7, 14, 30].includes(value) ? value : 7;
};
const saveLocal = (): void => localStorage.setItem(localKey(), JSON.stringify(progress));
function localProgress(): Progress {
  try {
    const data = JSON.parse(localStorage.getItem(localKey()) ?? 'null') as Partial<Progress> | null;
    return data
      ? {
          attempts: data.attempts ?? [],
          srs: data.srs ?? [],
          sessions: data.sessions ?? [],
          retentionChecks: data.retentionChecks ?? [],
        }
      : emptyProgress();
  } catch {
    return emptyProgress();
  }
}
function token(): string {
  return localStorage.getItem(tokenKey()) ?? '';
}
async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  extra?: Record<string, string>,
): Promise<T> {
  const storedToken = content ? token() : '';
  const response = await fetch(path, {
    method,
    headers: {
      ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({ error: '通信に失敗しました' }))) as { error?: string };
    throw new Error(data.error ?? '通信に失敗しました');
  }
  return (await response.json()) as T;
}
async function connect(): Promise<void> {
  if (!token()) {
    mode = 'local';
    progress = localProgress();
    banner = 'ローカルモードです。履歴はこの端末に保存されます。';
    return;
  }
  try {
    await api('/api/auth/check');
    progress = await api<Progress>('/api/progress');
    mode = 'server';
    banner = '';
  } catch (error) {
    mode = 'local';
    progress = localProgress();
    banner =
      error instanceof Error && error.message === '認証が設定されていません'
        ? 'サーバー認証が未設定のため、ローカルモードで保存しています。'
        : 'サーバーに接続できないため、ローカルモードで保存しています。トークンを確認してください。';
  }
}
async function persistAttempts(attempts: Attempt[]): Promise<void> {
  if (mode === 'server') {
    try {
      await api('/api/attempts', 'POST', attempts);
      progress = await api<Progress>('/api/progress');
      return;
    } catch {
      mode = 'local';
      progress = localProgress();
      banner = '保存に失敗したため、以降の履歴はこの端末に保存します。';
    }
  }
  for (const attempt of attempts) {
    progress.attempts.push(attempt);
    const index = progress.srs.findIndex((state) => state.questionId === attempt.questionId);
    const previous = index < 0 ? undefined : progress.srs[index];
    const quality = !attempt.correct
      ? 1
      : attempt.lowConfidence || attempt.selfScore === 1
        ? 3
        : attempt.elapsedMs <= 15000
          ? 5
          : 4;
    const state = updateSrs(previous, attempt.questionId, quality, attempt.createdAt);
    if (index < 0) progress.srs.push(state);
    else progress.srs[index] = state;
    if (attempt.mode === 'retention')
      progress.retentionChecks.push({
        questionId: attempt.questionId,
        gapDays: attempt.gapDays ?? 7,
        correct: attempt.correct,
        createdAt: attempt.createdAt,
      });
  }
  saveLocal();
}
async function persistAttempt(attempt: Attempt): Promise<void> {
  await persistAttempts([attempt]);
}
async function persistSession(session: Session): Promise<void> {
  if (mode === 'server') {
    try {
      await api('/api/sessions', 'POST', session);
      progress = await api<Progress>('/api/progress');
      return;
    } catch {
      mode = 'local';
      progress = localProgress();
      banner = '保存に失敗したため、以降の履歴はこの端末に保存します。';
    }
  }
  progress.sessions.push(session);
  saveLocal();
}
function navigate(target: string): void {
  location.hash = target;
  render();
}
function nav(): string {
  const items = [
    ['home', 'ホーム'],
    ['syllabus', 'シラバス'],
    ['practice', '練習'],
    ['review', '復習'],
    ['retention', '定着チェック'],
    ['mock', '模擬試験'],
    ['analytics', '分析'],
    ['settings', '設定'],
  ];
  return `<nav class="nav" aria-label="メイン">${items.map(([id, title]) => `<a href="#${id}" ${page() === id ? 'aria-current="page"' : ''}>${title}</a>`).join('')}</nav>`;
}
function shell(body: string): void {
  root!.innerHTML = `<div class="shell"><header class="top"><h1>${esc(content.exam.appTitle)}</h1><span class="muted">${esc(content.exam.shortName)}</span></header>${nav()}${banner ? `<div class="banner" role="status">${esc(banner)}</div>` : ''}<main>${body}</main></div>`;
}
function home(): void {
  const stats = homeStats(progress, new Date());
  const source = content.syllabus.source;
  shell(
    `<h2>学習ダッシュボード</h2><div class="grid cards"><div class="card"><span>今日の復習</span><strong>${stats.due}問</strong></div><div class="card"><span>定着率</span><strong>${pct(stats.retentionRate)}</strong></div><div class="card"><span>解答数</span><strong>${stats.answered}問</strong></div><div class="card"><span>正答率</span><strong>${pct(stats.accuracy)}</strong></div><div class="card"><span>連続学習日数</span><strong>${stats.streak}日</strong></div></div><div class="actions"><button class="btn" data-go="practice">練習</button><button class="btn" data-go="review">復習</button><button class="btn" data-go="retention">定着チェック</button><button class="btn secondary" data-go="mock">模擬試験</button><button class="btn secondary" data-go="syllabus">シラバス</button><button class="btn secondary" data-go="analytics">分析</button></div><p class="source">基準: <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name)} ${esc(source.version)}（公式PDF）</a></p>${content.questions.length ? '' : '<p class="panel">検証済みの問題はまだありません。シラバスは閲覧できます。</p>'}`,
  );
  bindGo();
}
function bindGo(): void {
  document
    .querySelectorAll<HTMLElement>('[data-go]')
    .forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go ?? 'home')));
}
function syllabus(): void {
  const stats = new Map(
    aggregateTopics(content.syllabus, content.questions, progress.attempts, progress.retentionChecks).map(
      (s) => [s.id, s],
    ),
  );
  const nodeHtml = (node: Syllabus['tree'][number]): string => {
    const s = stats.get(node.id);
    const children = node.children?.length
      ? `<div class="tree">${node.children.map(nodeHtml).join('')}</div>`
      : '';
    return `<details ${!node.children?.length ? 'open' : ''}><summary>${esc(node.title)}<span class="stats">${s?.questionCount ?? 0}問・正答率 ${pct(s?.accuracy ?? null)}</span></summary><button class="btn secondary" data-topic="${esc(node.id)}" ${s?.questionCount ? '' : 'disabled'}>このトピックを練習</button>${children}</details>`;
  };
  shell(`<h2>シラバス</h2><div class="panel">${content.syllabus.tree.map(nodeHtml).join('')}</div>`);
  document
    .querySelectorAll<HTMLButtonElement>('[data-topic]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        navigate(`practice?topic=${encodeURIComponent(button.dataset.topic ?? '')}`),
      ),
    );
}
function practice(): void {
  if (run?.mode === 'practice') {
    renderRun();
    return;
  }
  const params = qs();
  const topics = [...topicMap(content.syllabus).entries()].map(([id, path]) => ({
    id,
    title: path.map((n) => n.title).join(' / '),
  }));
  const options = `<option value="">すべて</option>${topics.map((t) => `<option value="${esc(t.id)}" ${params.get('topic') === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}`;
  shell(
    `<h2>練習</h2><form class="form panel" id="practice-form"><label>トピック<select name="topic">${options}</select></label><label>難易度<select name="difficulty"><option value="">すべて</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label><label class="inline"><input type="checkbox" name="unanswered">未回答のみ</label><label class="inline"><input type="checkbox" name="wrong">間違えた問題のみ</label><label>問題数<input type="number" name="count" min="1" max="100" value="10"></label><button class="btn" type="submit">開始</button></form>`,
  );
  $('#practice-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const map = topicMap(content.syllabus);
    const topic = String(data.get('topic') ?? '');
    const difficulty = Number(data.get('difficulty'));
    const answered = new Set(progress.attempts.map((a) => a.questionId));
    const latest = new Map(progress.attempts.map((a) => [a.questionId, a]));
    const wrong = new Set([...latest.values()].filter((a) => !a.correct).map((a) => a.questionId));
    const pool = content.questions.filter(
      (q) =>
        inSubtree(q, topic, map) &&
        (!difficulty || q.difficulty === difficulty) &&
        (!data.has('unanswered') || !answered.has(q.id)) &&
        (!data.has('wrong') || wrong.has(q.id)),
    );
    startRun('practice', shuffle(pool).slice(0, Math.min(100, Number(data.get('count')) || 10)));
  });
}
function review(): void {
  if (run?.mode === 'review') {
    renderRun();
    return;
  }
  const ids = new Set(content.questions.map((q) => q.id));
  const due = dueQueue(progress.srs, now()).filter((s) => ids.has(s.questionId));
  shell(
    `<h2>復習</h2><div class="panel"><p>期限が来た問題: ${due.length}問</p><button class="btn" id="start-review" ${due.length ? '' : 'disabled'}>復習を始める</button></div>`,
  );
  $('#start-review')?.addEventListener('click', () =>
    startRun('review', due.map((s) => content.questions.find((q) => q.id === s.questionId)!).filter(Boolean)),
  );
}
function retention(): void {
  if (run?.mode === 'retention') {
    renderRun();
    return;
  }
  const pool = selectRetention(progress.srs, content.questions, gap(), now());
  shell(
    `<h2>定着チェック</h2><div class="panel"><p>最後に正解してから${gap()}日以上経過: ${pool.length}問</p><p class="muted">解説は終了後に表示します。</p><button class="btn" id="start-retention" ${pool.length ? '' : 'disabled'}>開始</button></div>`,
  );
  $('#start-retention')?.addEventListener('click', () => startRun('retention', pool, { gapDays: gap() }));
}
function mock(): void {
  if (run?.mode === 'mock') {
    renderRun();
    return;
  }
  shell(
    `<h2>模擬試験</h2><div class="grid two">${content.exam.mockExams
      .map((config) => {
        const count = content.questions.filter(
          (q) => q.section === config.section && mockTypes(config).includes(q.type),
        ).length;
        return `<div class="panel"><h3>${esc(config.name)}</h3><p>制限時間 ${config.minutes}分・収録 ${count}問</p><button class="btn" data-mock="${esc(config.id)}" ${count ? '' : 'disabled'}>開始</button></div>`;
      })
      .join('')}</div>`,
  );
  document.querySelectorAll<HTMLButtonElement>('[data-mock]').forEach((button) =>
    button.addEventListener('click', () => {
      const config = content.exam.mockExams.find((m) => m.id === button.dataset.mock);
      if (config)
        startRun('mock', composeMock(content.questions, config, content.syllabus), {
          mockId: config.id,
          minutes: config.minutes,
          passRatio: config.passRatio,
        });
    }),
  );
}
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function startRun(modeValue: RunMode, questions: Question[], options: Partial<Run> = {}): void {
  if (!questions.length) {
    alert('出題できる問題がありません');
    return;
  }
  const orders: Record<string, number[]> = {};
  for (const q of questions)
    if (q.type !== 'self')
      orders[q.id] = shuffle(Array.from({ length: q.choices?.length ?? 0 }, (_, index) => index));
  run = {
    mode: modeValue,
    questions,
    current: 0,
    answers: {},
    drafts: {},
    orders,
    flags: new Set(),
    uncertain: new Set(),
    startedAt: now(),
    questionAt: Date.now(),
    stage: 'answering',
    gradingIndex: 0,
    ...options,
  };
  if (modeValue === 'mock') {
    tick = setInterval(() => {
      if (run?.mode === 'mock' && run.stage === 'answering') {
        const left = remainingMs(run.startedAt, run.minutes ?? 0, Date.now());
        const timer = $('#timer');
        if (timer) timer.textContent = `残り時間 ${formatTime(left)}`;
        if (left === 0) void submitRun();
      }
    }, 1000);
  }
  renderRun();
}
function formatTime(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function selected(q: Question): Answer | undefined {
  return run?.answers[q.id];
}
function isCorrect(q: Question, answer: Answer | undefined): boolean {
  return q.type === 'self' ? (answer?.selfScore ?? 0) >= 1 : isCorrectChoice(q, answer?.choice);
}
function correctChoices(q: Question, order: number[]): string {
  const indices = q.type === 'multi' ? (q.answers ?? []) : [q.answer ?? -1];
  return indices
    .map((index) => `${choiceLabel(order.indexOf(index))}. ${esc(q.choices?.[index])}`)
    .join('、');
}
function renderRun(): void {
  if (!run) return;
  if (run.stage === 'result') {
    renderResult();
    return;
  }
  if (run.stage === 'grading') {
    renderGrading();
    return;
  }
  const q = run.questions[run.current];
  const answer = selected(q);
  const draftChoice = run.drafts[q.id] ?? answer?.choice;
  const immediate = run.mode === 'practice' || run.mode === 'review';
  const feedback = immediate && run.feedback;
  const order = run.orders[q.id] ?? [];
  const choiceHtml =
    q.type === 'mcq'
      ? `<div class="choices">${order.map((original, i) => `<button class="choice ${answer?.choice === original ? 'selected' : ''} ${feedback && original === q.answer ? 'correct' : ''} ${feedback && answer?.choice === original && original !== q.answer ? 'wrong' : ''}" data-choice="${original}" ${feedback ? 'disabled' : ''}>${choiceLabel(i)}. ${esc(q.choices?.[original])}</button>`).join('')}</div>`
      : q.type === 'multi'
        ? `<fieldset class="choices multi-choices" ${feedback ? 'disabled' : ''}><legend>（${q.answers?.length ?? 0} つ選択）</legend>${order.map((original, i) => `<label class="choice ${selectedIndices(draftChoice, q.choices?.length ?? 0).includes(original) ? 'selected' : ''} ${feedback && q.answers?.includes(original) ? 'correct' : ''} ${feedback && selectedIndices(draftChoice, q.choices?.length ?? 0).includes(original) && !q.answers?.includes(original) ? 'wrong' : ''}"><input type="checkbox" data-multi="${original}" ${selectedIndices(draftChoice, q.choices?.length ?? 0).includes(original) ? 'checked' : ''}>${choiceLabel(i)}. ${esc(q.choices?.[original])}</label>`).join('')}</fieldset>${!feedback ? `<button class="btn" id="multi-answer" ${selectedIndices(draftChoice, q.choices?.length ?? 0).length === q.answers?.length ? '' : 'disabled'}>解答</button>` : ''}`
        : `<label class="form">回答<textarea id="self-text" rows="5" ${feedback ? 'disabled' : ''}>${esc(answer?.selfText ?? '')}</textarea></label>${immediate && !feedback ? '<button class="btn" id="self-reveal">模範解答を表示</button>' : ''}`;
  const notes =
    feedback && q.type !== 'self' && q.choiceNotes
      ? `<ul>${order.map((original, i) => `<li>${choiceLabel(i)}. ${esc(q.choices?.[original])}: ${esc(q.choiceNotes?.[original])}</li>`).join('')}</ul>`
      : '';
  const correctChoice = q.type !== 'self' && feedback ? `<p>正解: ${correctChoices(q, order)}</p>` : '';
  const selfFeedback =
    q.type === 'self' && feedback
      ? `<p>模範解答: ${esc(q.modelAnswer)}</p><ul>${q.rubric?.map((point) => `<li>${esc(point)}</li>`).join('') ?? ''}</ul>${answer?.selfScore === undefined ? '<div class="actions"><button class="btn secondary" data-score="0">できなかった</button><button class="btn secondary" data-score="1">一部できた</button><button class="btn secondary" data-score="2">できた</button></div>' : ''}`
      : '';
  const palette =
    run.mode === 'mock'
      ? `<div class="palette" aria-label="問題一覧">${run.questions.map((item, i) => `<button data-index="${i}" class="${i === run!.current ? 'active' : ''} ${run!.answers[item.id] ? 'answered' : ''} ${run!.flags.has(item.id) ? 'flagged' : ''}" aria-label="${i + 1}問目">${i + 1}</button>`).join('')}</div>`
      : '';
  shell(
    `<div class="panel"><div class="inline"><span>${run.current + 1} / ${run.questions.length}</span>${run.mode === 'mock' ? `<span class="timer" id="timer" role="timer" aria-label="残り時間">残り時間 ${formatTime(remainingMs(run.startedAt, run.minutes ?? 0, Date.now()))}</span>` : ''}</div><p class="muted">${esc(q.topic)}・難易度 ${q.difficulty}</p><p class="question">${esc(q.question)}</p>${q.code ? `<pre class="code">${esc(q.code)}</pre>` : ''}${choiceHtml}${q.type !== 'self' && !feedback ? `<label class="inline"><input type="checkbox" id="uncertain" ${run.uncertain.has(q.id) ? 'checked' : ''}>自信なし</label>` : ''}${feedback ? `<div class="feedback"><strong>${esc(run.feedback)}</strong>${correctChoice}<p>${esc(q.explanation)}</p>${notes}${selfFeedback}</div>` : ''}<div class="actions">${run.mode === 'mock' ? `<button class="btn secondary" id="flag">${run.flags.has(q.id) ? '見直し解除' : '見直しに追加'}</button>` : ''}${immediate ? `<button class="btn" id="next" ${!answer || (q.type === 'multi' && !feedback) || (q.type === 'self' && answer.selfScore === undefined) ? 'disabled' : ''}>${run.current + 1 === run.questions.length ? '結果を見る' : '次の問題'}</button>` : `<button class="btn secondary" id="prev" ${run.current === 0 ? 'disabled' : ''}>前へ</button><button class="btn secondary" id="next" ${run.current + 1 === run.questions.length ? 'disabled' : ''}>次へ</button><button class="btn" id="submit">提出する</button>`}</div>${palette}</div>`,
  );
  $('#uncertain')?.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).checked) run!.uncertain.add(q.id);
    else run!.uncertain.delete(q.id);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) =>
    button.addEventListener('click', () => {
      const original = Number(button.dataset.choice);
      if (immediate) void answerImmediate(q, { choice: original, elapsedMs: Date.now() - run!.questionAt });
      else {
        run!.answers[q.id] = { choice: original, elapsedMs: Date.now() - run!.questionAt };
        renderRun();
      }
    }),
  );
  document.querySelectorAll<HTMLInputElement>('[data-multi]').forEach((input) =>
    input.addEventListener('change', () => {
      const index = Number(input.dataset.multi);
      const previous = run!.drafts[q.id] ?? run!.answers[q.id]?.choice ?? 0;
      const choice = input.checked ? previous | (1 << index) : previous & ~(1 << index);
      run!.drafts[q.id] = choice;
      delete run!.answers[q.id];
      renderRun();
    }),
  );
  $('#multi-answer')?.addEventListener('click', () => {
    const choice = run!.drafts[q.id] ?? run!.answers[q.id]?.choice;
    if (selectedIndices(choice, q.choices?.length ?? 0).length !== q.answers?.length) return;
    const committed = { choice, elapsedMs: Date.now() - run!.questionAt };
    if (immediate) void answerImmediate(q, committed);
    else {
      run!.answers[q.id] = committed;
      renderRun();
    }
  });
  $('#self-reveal')?.addEventListener('click', () => {
    const text = ($<HTMLTextAreaElement>('#self-text')?.value ?? '').trim();
    if (!text) {
      alert('回答を入力してください');
      return;
    }
    run!.answers[q.id] = { selfText: text, elapsedMs: Date.now() - run!.questionAt };
    if (immediate) run!.feedback = '自己評価してください';
    renderRun();
  });
  if (!immediate && q.type === 'self')
    $('#self-text')?.addEventListener('input', (event) => {
      const text = (event.target as HTMLTextAreaElement).value;
      run!.answers[q.id] = { selfText: text, elapsedMs: Date.now() - run!.questionAt };
    });
  document.querySelectorAll<HTMLButtonElement>('[data-score]').forEach((button) =>
    button.addEventListener('click', () => {
      const score = Number(button.dataset.score);
      const previous = run!.answers[q.id];
      run!.answers[q.id] = { ...previous, selfScore: score, elapsedMs: previous.elapsedMs };
      void saveImmediate(q);
    }),
  );
  $('#flag')?.addEventListener('click', () => {
    if (run!.flags.has(q.id)) run!.flags.delete(q.id);
    else run!.flags.add(q.id);
    renderRun();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-index]').forEach((button) =>
    button.addEventListener('click', () => {
      run!.current = Number(button.dataset.index);
      run!.questionAt = Date.now();
      renderRun();
    }),
  );
  $('#prev')?.addEventListener('click', () => {
    run!.current--;
    run!.questionAt = Date.now();
    renderRun();
  });
  $('#next')?.addEventListener('click', () => {
    if (run!.current + 1 === run!.questions.length) void submitRun();
    else {
      run!.current++;
      run!.questionAt = Date.now();
      run!.feedback = undefined;
      renderRun();
    }
  });
  $('#submit')?.addEventListener('click', () => {
    if (confirm('提出して採点しますか？')) void submitRun();
  });
}
async function answerImmediate(q: Question, answer: Answer): Promise<void> {
  if (!run) return;
  run.answers[q.id] = answer;
  run.feedback = isCorrect(q, answer) ? '正解' : '不正解';
  renderRun();
  await saveImmediate(q);
}
async function saveImmediate(q: Question): Promise<void> {
  const answer = run!.answers[q.id];
  await persistAttempt(makeAttempt(q, answer));
  if (q.type === 'self') run!.feedback = answer.selfScore === 0 ? '不正解' : '正解';
  renderRun();
}
function makeAttempt(q: Question, answer: Answer | undefined): Attempt {
  const correct = isCorrect(q, answer);
  return {
    questionId: q.id,
    mode: run!.mode,
    correct,
    choice: q.type !== 'self' ? (answer?.choice ?? null) : null,
    selfScore: q.type === 'self' ? (answer?.selfScore ?? 0) : null,
    lowConfidence: run!.uncertain.has(q.id),
    gapDays: run!.mode === 'retention' ? run!.gapDays : null,
    elapsedMs: Math.max(0, Math.min(86400000, answer?.elapsedMs ?? 0)),
    createdAt: now(),
  };
}
async function submitRun(): Promise<void> {
  if (!run || run.stage !== 'answering') return;
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
  if (run.mode === 'mock' || run.mode === 'retention') {
    const self = run.questions.filter((q) => q.type === 'self' && run!.answers[q.id]?.selfText);
    if (self.length) {
      run.stage = 'grading';
      run.gradingIndex = 0;
      renderRun();
      return;
    }
    await persistAttempts(run.questions.map((q) => makeAttempt(q, run!.answers[q.id])));
  }
  const correct = run.questions.filter((q) => {
    const a = run!.answers[q.id];
    return isCorrect(q, a);
  }).length;
  const session: Session = {
    kind: run.mode === 'mock' ? 'mock' : 'practice',
    mockId: run.mockId ?? null,
    startedAt: run.startedAt,
    finishedAt: now(),
    total: run.questions.length,
    correct,
    scoreRatio: correct / run.questions.length,
    passed: run.mode === 'mock' ? correct / run.questions.length >= (run.passRatio ?? 0.6) : null,
    detail: { mode: run.mode, questionIds: run.questions.map((q) => q.id), flaggedIds: [...run.flags] },
  };
  await persistSession(session);
  run.stage = 'result';
  renderRun();
}
function renderGrading(): void {
  const self = run!.questions.filter((q) => q.type === 'self' && run!.answers[q.id]?.selfText);
  const q = self[run!.gradingIndex];
  if (!q) {
    void finishGrading();
    return;
  }
  shell(
    `<h2>自己評価 ${run!.gradingIndex + 1}/${self.length}</h2><div class="panel"><p class="question">${esc(q.question)}</p><h3>あなたの回答</h3><p>${esc(run!.answers[q.id].selfText)}</p><h3>模範解答</h3><p>${esc(q.modelAnswer)}</p><h3>採点観点</h3><ul>${q.rubric?.map((point) => `<li>${esc(point)}</li>`).join('') ?? ''}</ul><div class="actions"><button class="btn secondary" data-grade="0">できなかった</button><button class="btn secondary" data-grade="1">一部できた</button><button class="btn secondary" data-grade="2">できた</button></div></div>`,
  );
  document.querySelectorAll<HTMLButtonElement>('[data-grade]').forEach((button) =>
    button.addEventListener('click', () => {
      run!.answers[q.id].selfScore = Number(button.dataset.grade);
      run!.gradingIndex++;
      renderRun();
    }),
  );
}
async function finishGrading(): Promise<void> {
  await persistAttempts(run!.questions.map((q) => makeAttempt(q, run!.answers[q.id])));
  run!.stage = 'answering';
  await submitRunAfterGrading();
}
async function submitRunAfterGrading(): Promise<void> {
  const current = run!;
  const correct = current.questions.filter((q) => {
    const a = current.answers[q.id];
    return isCorrect(q, a);
  }).length;
  await persistSession({
    kind: current.mode === 'mock' ? 'mock' : 'practice',
    mockId: current.mockId ?? null,
    startedAt: current.startedAt,
    finishedAt: now(),
    total: current.questions.length,
    correct,
    scoreRatio: correct / current.questions.length,
    passed: current.mode === 'mock' ? correct / current.questions.length >= (current.passRatio ?? 0.6) : null,
    detail: {
      mode: current.mode,
      questionIds: current.questions.map((q) => q.id),
      flaggedIds: [...current.flags],
    },
  });
  current.stage = 'result';
  renderRun();
}
function renderResult(): void {
  const current = run!;
  const correct = current.questions.filter((q) => {
    const a = current.answers[q.id];
    return isCorrect(q, a);
  }).length;
  const map = topicMap(content.syllabus);
  const majors = content.syllabus.tree
    .map((node) => {
      const items = current.questions.filter((q) => map.get(q.topic)?.[0]?.id === node.id);
      const hits = items.filter((q) => {
        const a = current.answers[q.id];
        return isCorrect(q, a);
      }).length;
      return items.length
        ? `<li>${esc(node.title)}: ${hits}/${items.length}（${pct(hits / items.length)}）</li>`
        : '';
    })
    .join('');
  shell(
    `<h2>結果</h2><div class="panel"><p class="result ${correct / current.questions.length >= (current.passRatio ?? 0.6) ? 'good' : 'bad'}">${correct}/${current.questions.length}問正解（${pct(correct / current.questions.length)}）</p>${current.mode === 'mock' ? `<p>合否目安: ${correct / current.questions.length >= (current.passRatio ?? 0.6) ? '合格圏' : '要復習'}</p>` : ''}<h3>分野別</h3><ul>${majors}</ul><h3>解答と解説</h3><ol>${current.questions
      .map((q) => {
        const a = current.answers[q.id];
        const hit = isCorrect(q, a);
        return `<li><strong>${esc(q.question)}</strong><p class="${hit ? 'good' : 'bad'}">${hit ? '正解' : '不正解'}${q.type !== 'self' ? `・正解: ${correctChoices(q, current.orders[q.id] ?? [])}` : ''}</p><p>${esc(q.explanation)}</p>${q.type !== 'self' && q.choiceNotes ? `<ul>${(current.orders[q.id] ?? []).map((original, i) => `<li>${choiceLabel(i)}. ${esc(q.choices?.[original])}: ${esc(q.choiceNotes?.[original])}</li>`).join('')}</ul>` : ''}</li>`;
      })
      .join('')}</ol><button class="btn" id="end-run">戻る</button></div>`,
  );
  $('#end-run')?.addEventListener('click', () => {
    const target = current.mode;
    run = null;
    navigate(target);
  });
}
function analytics(): void {
  const stats = aggregateTopics(
    content.syllabus,
    content.questions,
    progress.attempts,
    progress.retentionChecks,
  );
  const weak = weakTopics(stats);
  const majors = stats.filter((s) => s.level === 0);
  const rates = retentionRates(progress.retentionChecks);
  const scores = scoreHistory(progress.sessions);
  const points = scores
    .map((s, i) => `${scores.length === 1 ? 50 : 5 + (i * 90) / (scores.length - 1)},${95 - s.score * 90}`)
    .join(' ');
  shell(
    `<h2>分析</h2><div class="grid two"><section class="panel"><h3>弱点トピック</h3>${weak.length ? `<ul class="list">${weak.map((s) => `<li>${esc(s.title)}・直近 ${pct(s.recentAccuracy)} <button class="btn secondary" data-weak="${esc(s.id)}">練習</button></li>`).join('')}</ul>` : '<p>分析に必要な解答がまだありません。</p>'}</section><section class="panel"><h3>大分類別正答率</h3>${majors.map((s) => `<div>${esc(s.title)} ${pct(s.accuracy)}<progress value="${s.accuracy ?? 0}" max="1">${pct(s.accuracy)}</progress></div>`).join('')}</section><section class="panel"><h3>模擬試験スコア推移</h3>${scores.length ? `<svg viewBox="0 0 100 100" role="img" aria-label="模擬試験スコア推移"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2"/><line x1="5" y1="95" x2="95" y2="95" stroke="currentColor"/></svg><p>最新 ${pct(scores.at(-1)?.score ?? null)}</p>` : '<p>模擬試験の履歴はありません。</p>'}</section><section class="panel"><h3>定着率</h3>${rates.map((r) => `<p>${r.gapDays}日: ${r.total ? pct(r.rate) : '—'}（${r.total}問）</p>`).join('')}</section></div>`,
  );
  document
    .querySelectorAll<HTMLButtonElement>('[data-weak]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        navigate(`practice?topic=${encodeURIComponent(button.dataset.weak ?? '')}`),
      ),
    );
}
function settings(): void {
  const local = localProgress();
  shell(
    `<h2>設定</h2><div class="grid two"><section class="panel"><h3>サーバー接続</h3><form class="form" id="token-form"><label>アクセストークン<input name="token" type="password" autocomplete="off" placeholder="${token() ? '保存済み' : 'トークンを入力'}"></label><button class="btn" type="submit">保存して接続</button></form><p>現在: ${mode === 'server' ? 'サーバー保存' : 'ローカル保存'}</p><button class="btn secondary" id="import" ${mode === 'server' && (local.attempts.length || local.sessions.length) ? '' : 'disabled'}>サーバーへ取り込み（${local.attempts.length}件）</button></section><section class="panel"><h3>学習設定</h3><label class="form">定着チェックの間隔<select id="gap">${[3, 7, 14, 30].map((value) => `<option value="${value}" ${gap() === value ? 'selected' : ''}>${value}日</option>`).join('')}</select></label><div class="actions"><button class="btn secondary" id="export">履歴を JSON で書き出す</button><button class="btn danger" id="reset">履歴をリセット</button></div></section><section class="panel"><h3>出典・版</h3><p>${esc(content.syllabus.source.name)} ${esc(content.syllabus.source.version)}</p><p><a href="${esc(content.syllabus.source.url)}" target="_blank" rel="noopener noreferrer">原典を見る</a></p><p><a href="/sources.md" target="_blank" rel="noopener noreferrer">出典一覧</a></p></section></div>`,
  );
  $('#token-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget as HTMLFormElement).get('token') ?? '').trim();
    if (value) localStorage.setItem(tokenKey(), value);
    void connect().then(render);
  });
  $('#gap')?.addEventListener('change', (event) =>
    localStorage.setItem(gapKey(), (event.target as HTMLSelectElement).value),
  );
  $('#import')?.addEventListener('click', () => {
    void (async () => {
      try {
        await api('/api/import', 'POST', { attempts: local.attempts, sessions: local.sessions });
        localStorage.removeItem(localKey());
        progress = await api<Progress>('/api/progress');
        banner = 'ローカル履歴を取り込みました。';
        render();
      } catch (error) {
        alert(error instanceof Error ? error.message : '取り込みに失敗しました');
      }
    })();
  });
  $('#export')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${content.exam.exam}-progress.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  $('#reset')?.addEventListener('click', () => {
    if (!confirm('すべての学習履歴を削除します。よろしいですか？')) return;
    void (async () => {
      if (mode === 'server') {
        try {
          await api('/api/progress', 'DELETE', undefined, { 'X-Confirm': 'reset' });
        } catch (error) {
          alert(error instanceof Error ? error.message : '削除に失敗しました');
          return;
        }
      }
      localStorage.removeItem(localKey());
      progress = emptyProgress();
      render();
    })();
  });
}
function render(): void {
  if (!content) return;
  const route = page();
  if (run && route !== run.mode) {
    if (tick) clearInterval(tick);
    tick = null;
    run = null;
  }
  switch (route) {
    case 'syllabus':
      syllabus();
      break;
    case 'practice':
      practice();
      break;
    case 'review':
      review();
      break;
    case 'retention':
      retention();
      break;
    case 'mock':
      mock();
      break;
    case 'analytics':
      analytics();
      break;
    case 'settings':
      settings();
      break;
    default:
      home();
  }
}
async function init(): Promise<void> {
  try {
    const pendingToken = location.hash.startsWith('#token=')
      ? decodeURIComponent(location.hash.slice(7))
      : null;
    if (pendingToken !== null) history.replaceState(null, '', `${location.pathname}${location.search}#home`);
    content = await api<Content>('/api/content');
    if (pendingToken !== null) localStorage.setItem(tokenKey(), pendingToken);
    await connect();
    render();
    window.addEventListener('hashchange', render);
  } catch {
    root!.textContent = 'コンテンツを読み込めませんでした。再読み込みしてください。';
  }
}
void init();
