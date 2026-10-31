CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam TEXT NOT NULL,
  question_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  correct INTEGER NOT NULL,
  choice INTEGER,
  self_score INTEGER,
  elapsed_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_exam_question ON attempts(exam, question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam_created ON attempts(exam, created_at);
CREATE TABLE IF NOT EXISTS srs_state (
  exam TEXT NOT NULL,
  question_id TEXT NOT NULL,
  ease REAL NOT NULL,
  interval_days INTEGER NOT NULL,
  repetitions INTEGER NOT NULL,
  due_at TEXT NOT NULL,
  lapses INTEGER NOT NULL,
  last_result INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_correct_at TEXT,
  PRIMARY KEY(exam, question_id)
);
CREATE INDEX IF NOT EXISTS idx_srs_exam_due ON srs_state(exam, due_at);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam TEXT NOT NULL,
  kind TEXT NOT NULL,
  mock_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  total INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  score_ratio REAL NOT NULL,
  passed INTEGER,
  detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exam_finished ON sessions(exam, finished_at);
CREATE TABLE IF NOT EXISTS retention_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam TEXT NOT NULL,
  question_id TEXT NOT NULL,
  gap_days INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retention_exam_gap ON retention_checks(exam, gap_days);
