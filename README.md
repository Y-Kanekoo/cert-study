# cert-study

基本情報技術者試験（FE）、応用情報技術者試験（AP）、JSTQB Foundation Level の学習・復習・定着確認を行う Web アプリです。共通コードから試験ごとに独立した Cloudflare Worker を生成します。

| アプリ | Worker 名 | 対象 |
| --- | --- | --- |
| FE | `fe-study` | 科目 A・B |
| AP | `ap-study` | 科目 A・B |
| JSTQB FL | `jstqb-study` | Foundation Level |

## 機能

- シラバスのツリー閲覧、トピック別練習、難易度・未回答・誤答による絞り込み
- 即時解説と選択肢ごとの理由、セルフ採点
- SM-2 による復習、3・7・14・30 日後の定着チェック
- タイマー・見直しフラグ付き模擬試験、分野別結果、合否目安
- 弱点分析、分野別正答率、スコア推移、定着率
- D1 保存またはローカル保存、履歴の取り込み・書き出し・リセット

## ローカル開発

Node.js 24 以降を使います。依存を入れた後、次を実行してください。

```sh
npm ci
npm run check
npx wrangler dev --env fe --local
```

`npm run check` はコンテンツ検証、lint・型検査、テスト、3 試験分のビルドを順に実行します。`dist/<exam>/worker.js` は単一の ES module です。`wrangler.toml` の各環境はビルド済みファイルを `main` とし、Wrangler 4 の `no_bundle = true` を設定しています。ローカル D1 は Wrangler が管理します。

現時点では問題バンクに検証済み問題がなく、画面には 0 問と表示されます。サンプル問題は `test/fixtures` にのみあります。

## デプロイ準備

1. `npx wrangler login` でログインし、`npx wrangler d1 create cert-study` で D1 を作成します。
2. 作成された ID を `wrangler.toml` の各 `database_id` に設定します。
3. `npm run build` を実行します。
4. `npx wrangler d1 migrations apply cert-study --remote` でマイグレーションを適用します。
5. 32 バイト以上のランダムなトークンを手元で用意し、`printf %s "$TOKEN" | shasum -a 256` で SHA-256 を計算します。得られたハッシュを各環境の `TOKEN_SHA256` 変数に設定します。トークンの平文を Worker やリポジトリには置きません。
6. `npx wrangler deploy --env fe`、`--env ap`、`--env jstqb` で各 Worker をデプロイします。

アプリ側では設定画面から平文トークンを入力します。`/#token=...` から一度だけ取り込むこともできます。ブラウザはトークンを試験別の localStorage に保存します。Worker の `TOKEN_SHA256` が空なら進捗 API は 503 を返し、アプリはローカルモードで動きます。ローカル履歴は、接続後に設定画面の「サーバーへ取り込み」から移せます。

## 問題を追加する

`content/<exam>/questions/*.json` に配列として追加します。形式は `content/schema/question.schema.json`、分類は各試験の `syllabus.json` の末端 ID を参照してください。初期状態は `draft` とし、独立したレビューを経て `verified` にした問題だけが配信されます。手順は [問題作成ガイド](docs/CONTENT_GUIDE.md) を参照してください。

```sh
npm run validate
npm run review:blind -- fe
npm run review:compare -- fe answers.json
```

答えを伏せたファイルは `.cache/blind/<exam>.json` に生成されます。照合用 JSON は `{ "問題ID": 0 }` の形式で、数値は元の選択肢の位置（0〜3）です。

## 制約と出典

AP 科目 B は長文記述式の本試験と同等ではなく、短い事例と自由記述のセルフ採点で代替します。模擬試験は収録済みの検証済み問題から構成し、足りない場合は出題数が少なくなります。合否は正答率による目安です。

採用したシラバスと版、著作権方針は [出典一覧](docs/SOURCES.md) を参照してください。問題文と解説はオリジナルです。
