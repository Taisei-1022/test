-- games テーブルの追加カラム。Supabase の SQL Editor で1回実行してください。
-- 未実行でもアプリは動きます（その列は自動で外して保存/取得＝その機能だけ無効）。
alter table public.games add column if not exists category  text;
alter table public.games add column if not exists published boolean not null default true;
alter table public.games add column if not exists chat      text;   -- 会話履歴（JSON文字列）
alter table public.games add column if not exists updated_at timestamptz not null default now();  -- 最終更新時（新着順の並び替え用）
