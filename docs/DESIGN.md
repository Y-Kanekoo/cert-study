# 設計書: cert-study

3つの学習＆定着チェック Web アプリ（基本情報 FE / 応用情報 AP / JSTQB FL）を、1つのコードベースから3つの Cloudflare Worker としてデプロイする。

## 1. 構成

```
content/<exam>/syllabus.json   シラバスツリー（大分類→中分類→小分類 / 章→節→学習目的）
content/<exam>/exam.json       試験メタ情報・模擬試験の構成
content/<exam>/questions/*.json 問題バンク（schema: content/schema/question.schema.json）
src/shared/                    型・SM-2・採点・模擬試験の抽出ロジック（純関数、テスト対象）
src/worker/                    Worker（API ルーティング、認証、D1 アクセス、HTML 配信）
src/client/                    フロントエンド（依存なしの TypeScript SPA、esbuild でバンドル）
scripts/validate-content.ts    コンテンツ検証（スキーマ・ID 重複・topic 存在・答え範囲など）
scripts/stats.ts               検証済み・全件の収録状況を集計
scripts/build.ts               dist/<exam>/worker.js を生成（クライアント JS/CSS/HTML と verified 問題を埋め込み）
migrations/                    D1 マイグレーション
wrangler.toml                  env.fe / env.ap / env.jstqb の3環境
```

- 1 Worker = 1 試験。ビルド時に試験を固定（esbuild define `__EXAM__`）し、その試験のコンテンツだけを同梱する。
- 静的アセットは Worker に文字列として埋め込む（単一モジュールで API 経由アップロードもできるようにするため）。
- D1 は1つ（`cert-study`）を3 Worker で共有し、全テーブルに `exam` 列を持たせる。

## 2. 認証（シングルユーザー・無料）

- アクセストークン（32バイト以上のランダム値）をユーザーの手元で生成し、**SHA-256 ハッシュのみ** を Worker の変数 `TOKEN_SHA256` に設定する（平文はサーバー・リポジトリに置かない。ユーザーの手元のファイルと、ブラウザの localStorage にのみ存在する）。
- クライアントは初回にトークンを入力（または `#token=...` 付き URL を開く → localStorage に保存し、URL から即削除）。
- 進捗系 API は `Authorization: Bearer <token>` を必須とし、Worker でハッシュを定数時間比較。
- 問題・シラバスの取得は認証不要（オリジナル教材のため公開可）。ただしトークン未設定時もアプリは「ローカルモード」（localStorage のみ）で動作する。

## 3. API

| Method | Path | 認証 | 内容 |
| --- | --- | --- | --- |
| GET | `/` ほか非 API パス | なし | SPA の HTML |
| GET | `/app.js`, `/app.css`, `/manifest.webmanifest` | なし | 埋め込みアセット |
| GET | `/api/health` | なし | `{ok, exam, questionCount, version}` |
| GET | `/api/content` | なし | `{exam, syllabus, questions}`（verified のみ） |
| GET | `/api/auth/check` | 要 | トークン検証 |
| POST | `/api/attempts` | 要 | 解答記録（複数可）。SRS 状態を更新して返す |
| GET | `/api/progress` | 要 | 問題ごとの SRS 状態・集計・セッション履歴 |
| POST | `/api/sessions` | 要 | 模擬試験・練習セッション結果を保存 |
| POST | `/api/import` | 要 | localStorage の履歴を一括取り込み |
| DELETE | `/api/progress` | 要 | リセット（確認用ヘッダ `X-Confirm: reset` 必須） |

入力は全て検証（questionId がバンクに存在するか、mode 列挙値、数値範囲）。エラーは JSON `{error}`。
複数選択の `choice` は元の選択肢位置をビットにした整数（`1 << index` の和）。未回答は `null` とし、Worker は範囲と `correct` の一致を検証する。

## 4. D1 スキーマ

- `attempts(id, exam, question_id, mode, correct, choice, self_score, elapsed_ms, created_at)`
- `srs_state(exam, question_id, ease, interval_days, repetitions, due_at, lapses, last_result, last_seen_at, first_correct_at)` PK(exam, question_id)
- `sessions(id, exam, kind, mock_id, started_at, finished_at, total, correct, score_ratio, passed, detail_json)`
- `retention_checks(id, exam, question_id, gap_days, correct, created_at)`

## 5. 学習ロジック（src/shared）

- **SM-2 簡易版**: 品質 q（0〜5）。不正解=1（自信なし正解=3、正解=4、即答かつ正解=5）。q<3 で repetitions=0・interval=1日・lapses+1。ease は SM-2 式で更新し下限 1.3。間違えた問題は翌日に復習キューへ。
- **復習キュー**: due_at <= now の問題。間違い回数・期限超過日数で優先順位付け。
- **定着チェック**: 「最後に正解してから N 日以上（既定 7 日、選択式 3/7/14/30）経過した問題」を、ヒント・解説なしで再出題し、`retention_checks` に記録。定着率 = 再テスト正解率（期間別）。
- **集計の場所**: 弱点分析・スコア推移・定着率はクライアントが `/api/progress` の生データ（またはローカル履歴）から計算する。Worker は保存と SRS 更新のみ（D1 の 1 回の呼び出しあたりクエリ数を抑えるため、読み出し 1 回＋書き込みは batch）。
- **弱点分析**: 小分類/学習目的・中分類・大分類ごとに 解答数・正答率・直近10回正答率・定着率 を集計。正答率が低く解答数が十分なトピックを「弱点」として上位表示し、そのトピックの練習へ1タップで移動。
- **模擬試験**: exam.json の構成比（weight もしくは count）に従い、section と `types`（省略時は mcq/multi、セルフ採点は self）で絞った verified 問題から重複なく抽出。不足分は同じ科目・形式の他分野から補う。タイマー付き、途中で解説は出さず最後に採点、分野別スコア表示、合否目安。AP 科目Bは選択式の `ap-B-case` と記述式の `ap-B-self` を分離する。
- **複数選択（type=multi）**: 4〜5択で正解インデックスを昇順配列で持つ。指定数を選んで解答し、集合が完全一致した場合だけ正解。
- **セルフ採点（type=self）**: 自由記述 → 模範解答と採点観点を表示 → 自己評価（0/1/2 = できなかった/一部/できた）。q へ変換（0→1, 1→3, 2→4。2 かつ解答 15 秒以内なら 5。選択式も同じ基準）。

## 6. 画面（日本語・モバイルファースト）

ホーム（今日の復習数、定着率、連続学習日数、各モードへのボタン） / シラバス（ツリー、各ノードの問題数と正答率、そこから練習開始） / 練習（トピック・難易度・未回答のみ等で絞り込み、1問ずつ即時解説） / 復習（SRS 期限到来分） / 定着チェック / 模擬試験（タイマー・見直しフラグ・結果） / 分析（弱点・分野別グラフ・スコア推移） / 設定（トークン、定着チェック間隔、データ書き出し/リセット、出典とバージョン）。

## 7. 制約・方針

- 無料枠のみ（Workers Free + D1 Free）。外部 API・有料 AI API は使わない。
- 応用情報 科目B は長文記述式のため、短い事例の選択式と記述セルフ採点で練習する（本試験同等ではない）。
- コンテンツは `status: verified` のみ配信。不確実な問題は `flagged` にして除外。
