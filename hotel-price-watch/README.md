# ホテル価格ウォッチャー（仙台向け）

指定した**特定ホテル**の価格を、**複数サイトを横断的に**、**定期的に**チェックし、
設定した**閾値以下**になったら **Slack** に通知する仕組みです。

- 「いろんなサイトを1画面に集約している比較サイト（＝Googleホテル）を時間軸で定期チェックする」
  という考え方で作っています。楽天だけに縛られません。
- 価格の履歴は `data/history.jsonl` に蓄積されるので、後から「いつ安かったか」の傾向も追えます。
- 定期実行は GitHub Actions の cron（既定：毎日 09:00 JST）。

```
比較サイト(Googleホテル/楽天) ──取得──▶ watch.py ──閾値以下?──▶ Slack通知
                                          └──記録──▶ data/history.jsonl
```

---

## データ源（プラガブル）

| ソース名 | 内容 | 必要な鍵 | 費用 |
|---|---|---|---|
| `serpapi_google_hotels` | **メイン**。Googleホテル経由で Booking / Expedia / 楽天 / Agoda / じゃらん等の料金を横断取得 | `SERPAPI_KEY` | 無料枠 250検索/月（[serpapi.com](https://serpapi.com/)） |
| `rakuten` | 楽天トラベルのみ。鍵不要のメインが無くても動く無料の下支え | `RAKUTEN_APP_ID` | 完全無料（[楽天ウェブサービス](https://webservice.rakuten.co.jp/)） |

`config.yaml` の `sources:` に並べた順で問い合わせ、**取れた中の最安**を採用します。
どちらか片方だけでも動きます（両方の鍵が未設定だと価格は取得できません）。

> **無料枠の目安**：SerpApi は 1回の実行で「ホテル数 × 宿泊日数」回の検索を使います。
> 例）ホテル3件 × 週次6日 = 18検索/日 × 30日 ≈ 540検索/月 → 無料枠(250)超過。
> 無料枠に収めるには、ホテル数・`weeks_ahead`・実行頻度（cron）を調整してください。
> （例：ホテル2件 × 4日 = 8検索/日 ≈ 240/月 に収まる）

---

## セットアップ

### 1. 鍵を用意する

- **Slack Webhook（必須）**：Slack で Incoming Webhook を作成し `https://hooks.slack.com/...` を取得
- **SerpApi キー（推奨）**：[serpapi.com](https://serpapi.com/) に無料登録して API Key を取得
- **楽天 App ID（任意）**：[楽天ウェブサービス](https://webservice.rakuten.co.jp/)でアプリ登録し applicationId を取得

### 2. GitHub Secrets に登録

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で登録：

| Secret 名 | 値 |
|---|---|
| `SLACK_WEBHOOK_URL` | Slack の Webhook URL |
| `SERPAPI_KEY` | SerpApi の API Key |
| `RAKUTEN_APP_ID` | 楽天の applicationId |

### 3. 監視するホテルと閾値を設定

`config.yaml` を編集します。
- `hotels[].name` … 監視したいホテルの正式名称
- `hotels[].threshold_jpy` … この額（1泊）以下で通知
- `dates` … 監視する宿泊日の決め方（`weekly` / `rolling` / `fixed`）

### 4. 定期実行を有効化

`.github/workflows/hotel-price-watch.yml` が cron を担います。

> ⚠️ **GitHub の仕様**：`schedule`（cron）はデフォルトブランチでのみ動きます。
> このワークフローを cron で動かすには、**デフォルトブランチ（main 等）にマージ**してください。
> マージ前でも **Actions タブ → hotel-price-watch → Run workflow**（`workflow_dispatch`）で手動実行できます。

---

## ローカルでの動作確認

```bash
cd hotel-price-watch
pip install -r requirements.txt

# 取得だけ試す（履歴もSlackも触らない）
python watch.py --dry-run

# 本番同様に実行（鍵は環境変数で渡す）
export SLACK_WEBHOOK_URL=... SERPAPI_KEY=... RAKUTEN_APP_ID=...
python watch.py
```

---

## 通知の抑制

`config.yaml` の `alerts`：
- `renotify_after_hours`: 同一ホテル・同一宿泊日の**再通知間隔**（既定24h）。ただし前回より安くなればすぐ通知。
- `only_on_new_low`: `true` にすると「閾値以下」かつ「**過去最安を更新**」した時だけ通知。

---

## 新しいサイトを足したいとき

1. `sources/` に `fetch(hotel, checkin, checkout, locale) -> Quote | None` を実装したファイルを追加
2. `sources/__init__.py` の `REGISTRY` に名前を登録
3. `config.yaml` の `sources:` に名前を追記

`Quote` は `source / price_jpy / vendor / link / hotel_name` を持つだけの単純な型です（`sources/base.py`）。

---

## ファイル構成

```
hotel-price-watch/
├── watch.py                 # 本体（取得→判定→履歴→通知）
├── config.yaml              # 監視ホテル・閾値・日程・通知設定
├── config.example.yaml      # 設定の雛形
├── requirements.txt
├── sources/                 # 価格取得ソース（プラガブル）
│   ├── base.py              #   Quote 型・ホテル名照合
│   ├── serpapi_hotels.py    #   Googleホテル横断（メイン）
│   └── rakuten.py           #   楽天トラベル（無料の下支え）
├── notify/
│   └── slack.py             # Slack 通知
└── data/
    ├── history.jsonl        # 価格履歴（実行時に追記）
    └── state.json           # 再通知抑制用の状態
```
