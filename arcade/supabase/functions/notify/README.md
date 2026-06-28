# Slack 通知（notify）セットアップ

プレイ・ゲーム公開を Slack に通知する Edge Function。Supabase の Database Webhook から呼ばれる。

## 1. Slack の Incoming Webhook URL を取る

1. https://api.slack.com/apps → **Create New App** → **From scratch**
2. アプリ名（例: Vappa通知）とワークスペースを選んで作成
3. 左メニュー **Incoming Webhooks** → トグルを **On**
4. 下の **Add New Webhook to Workspace** → 通知したいチャンネルを選んで **許可する**
5. 表示された **Webhook URL**（`https://hooks.slack.com/services/...`）をコピー

## 2. 関数をデプロイ

```sh
supabase functions deploy notify --no-verify-jwt
```

`--no-verify-jwt` 必須（Database Webhook は JWT を付けないため）。

## 3. Secrets を設定（後からいつでも変更可）

```sh
supabase secrets set SLACK_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
# 任意：
supabase secrets set NOTIFY_PLAYS=on      # off でプレイ通知を停止
supabase secrets set NOTIFY_PUBLISH=on    # off で公開通知を停止
supabase secrets set NOTIFY_SECRET=好きな文字列   # 設定すると検証が有効
```

ダッシュボードなら **Project Settings → Edge Functions → Secrets** から同じことが GUI でできる（再デプロイ不要・即反映）。

## 4. Database Webhook を作る（ダッシュボード）

**Database → Webhooks → Create a new hook**

- **プレイ通知**
  - Table: `scores` / Events: `Insert`
  - Type: `Supabase Edge Functions` → `notify`
  - （NOTIFY_SECRET を設定したら）HTTP Headers に `x-notify-secret: 設定した値`

- **公開通知**
  - Table: `games` / Events: `Insert`, `Update`
  - Type: `Supabase Edge Functions` → `notify`
  - 同上のヘッダ

関数側で「公開（published が false→true かつ HTML あり）」だけを拾うので、下書き作成では通知されない。

## 通知の出方

- 🎮 *プレイヤー名* さんが「ゲーム名」をプレイ（N点）
- ✨ *作者名* さんが「ゲーム名」を公開しました

## 注意（プレイ通知の量）

プレイ通知は **1プレイごと** に飛ぶ。DAU が増えたら `NOTIFY_PLAYS=off` で一旦止めるか、「自己ベスト更新だけ」等に絞る改修を入れる。
