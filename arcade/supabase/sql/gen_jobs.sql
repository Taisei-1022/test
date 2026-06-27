-- 生成ジョブ（非同期生成）。Supabase の SQL Editor で1回実行してください。
-- 未実行でもアプリは動きます（その場合は従来の同期ストリーミングにフォールバック）。
create table if not exists public.gen_jobs (
  id         uuid primary key default gen_random_uuid(),
  token      text,                       -- 端末トークン（誰のジョブか）
  result     jsonb,                      -- 完了時に生成結果 or {error,...} を格納（null=処理中）
  created_at timestamptz not null default now()
);

-- RLS を有効化し、ポリシーは作らない＝service_role（Edge Function）だけがアクセス可能。
-- クライアントは必ず generate 関数（job=...）経由でのみ状態を取得する。
alter table public.gen_jobs enable row level security;

-- 古いジョブの掃除（任意）：必要なら pg_cron 等で定期実行。
--   delete from public.gen_jobs where created_at < now() - interval '1 day';
