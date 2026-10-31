# 問題作成ガイド（コンテンツパイプライン）

1. `content/<exam>/questions/<topic-group>.json` に追加（配列）。スキーマ: `content/schema/question.schema.json`
2. ID は `<exam>-<区分>-<連番>` 形式で一意。既存 ID の変更・再利用は禁止（学習履歴と紐づくため）。
3. `topic` は `content/<exam>/syllabus.json` の末端ノード ID（FE/AP は小分類 `fe-M09-03`、JSTQB は学習目的 `FL-4.2.2`）。
4. 選択式は `mcq`（4択・`answer` に正解位置 0〜3）または `multi`（4〜5択・`answers` に重複なしの昇順インデックスを2個以上）とする。`multi` の問題文には正解数と同じ「Nつ選べ」を書き、`answer` は置かない。`choiceNotes` は選択肢と同数にする。AP 科目Bの事例選択式は `section: "B"` とする。
5. 追加直後は `status: "draft"`。レビュー手順:
   - (a) 作成者とは別のレビュアー（人 or 別エージェント）が**答えを見ずに解き**、正解が一致するか確認（`npm run review:blind` で出題用ファイルを出力できる）
   - (b) 解説と各選択肢の正誤理由が正しいか、出典シラバスの範囲内かを確認
   - (c) 一意に正解が決まること、紛らわしい表現がないことを確認
   - 合格したら `verified`、疑義があれば `flagged` と `reviewNote` に理由
6. `npm run validate` が CI とローカルで通ること。正規化した問題文とコードの完全重複はエラー、連続する3文字の組の Jaccard 類似度 0.7 以上は警告。`npm run stats`（`-- --json` 可）で収録状況を確認する。
7. ブラインド照合の解答 JSON は `mcq` が数値、`multi` が元の位置の数値配列。複数選択は順序を問わず集合で比較する。
8. **禁止**: 過去問題・市販問題集・シラバス本文の転載。数値・状況はオリジナルで作る。
