# 既存リポジトリ調査と方針決定（2026-10-31）

`gh repo list Y-Kanekoo --limit 200` と `~/Projects` を調査した。

| 既存リポジトリ | 内容 | 判断 |
| --- | --- | --- |
| jstqb-fl-quiz（public） | Next.js 16 + localStorage の JSTQB FL（V4.0）クイズ 400問 | JSTQB のみ・Cloudflare 非対応・SRS/定着チェックなし。問題は未検証のため取り込まない（将来、検証パイプライン経由での取り込み候補） |
| jstqb-study-app（public） | Expo（Web/iOS/Android）+ Supabase の JSTQB 学習アプリ | Supabase 依存で Cloudflare 無料運用方針と合わない。JSTQB のみ |
| qa-fl-jstqb-jstqb-10-1（private） | 静的 PWA | 小規模・JSTQB のみ |
| testcase-manager / qa-radar ほか | 学習・試験とは別目的 | 対象外 |

**決定: 新規モノレポ `Y-Kanekoo/cert-study`（public）を作成する。**

理由:
1. 3試験（FE・AP・JSTQB）を共通コード＋試験ごとのコンテンツで扱う構成が必要で、既存はどれも単一試験向け。
2. 運用先が Cloudflare Workers + D1（無料枠）で、既存の Next.js/Expo/Supabase 構成からの移行コストが新規作成より大きい。
3. 中核機能（間隔反復・定着チェック・弱点分析）がいずれの既存アプリにも無い。

公開範囲: 個人データ（学習履歴）は D1 にのみ保存し、リポジトリには含まない。問題はオリジナルなので public とした（GitHub Actions の無料枠も使える）。
