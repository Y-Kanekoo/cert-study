# テスト（cert-study）

development-hub のテスト標準（https://github.com/Y-Kanekoo/development-hub/blob/main/docs/testing-standard.md）に従います。段階は static → unit → api → e2e の順で、前の段階が失敗したら止めます。

## 段階とコマンド

| 段階 | `.local-ci.yml` の実行内容 |
| --- | --- |
| static | `npm run lint`（ESLint・`tsc --noEmit`・`npm run format:check`）と `node scripts/scan-secrets.mjs`。独立した typecheck ジョブはスキップ |
| unit | `npm run test`（`test/` の Vitest。Worker API と D1 のテストも含む） |
| api | 独立した api ジョブはスキップ |
| e2e | `npm run build` の後に `npx playwright test --grep @smoke` |

まとめて実行: `local-ci run .`（段階の絞り込み: `--stage static,unit`）。`npm run check` は validate・lint・test・build を実行し、秘密情報スキャンと E2E は含みません。

## カバレッジ

- 現在、カバレッジの計測と下限は設定されていません。

## スキップの記録

スキップは `.local-ci.yml` の `skip: true` と `skip_reason` に加えて、この表にも書きます。テストコードに `skip` を追加しません。

| 段階 | 理由 | 解除条件 | 記録日 |
| --- | --- | --- | --- |
| static（typecheck ジョブ） | `package.json` に `typecheck` がない。型検査は `npm run lint` 内の `tsc --noEmit` で実行 | `typecheck` スクリプトを追加して `.local-ci.yml` の skip を解除 | 2026-11-01 |
| api | `package.json` に `test:api` がない。Worker API のテストは `npm run test` に含まれる | `test:api` スクリプトを追加して `.local-ci.yml` の skip を解除 | 2026-11-01 |

## 弱体化の確認（レビュー時）

- [ ] `acv check --base origin/main` が合格（テスト削除・件数減少・skip追加・閾値引き下げなし）
- [ ] 期待値を緩めていない（完全一致を部分一致や存在確認にしていない）
- [ ] カバレッジの除外・`.local-ci.yml` の skip・段階の削除を追加していない（追加したなら理由をこの文書に記録）
- [ ] 外部通信はモックかローカルのフェイクだけ
