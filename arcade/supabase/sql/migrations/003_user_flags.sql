-- 運営による警告・利用停止（BAN）の記録。Edge Function（service_role）だけが読み書きする。
create table if not exists public.user_flags (
  user_id    uuid primary key,
  status     text not null default 'ok',     -- ok / warned / banned
  warning    text,                            -- 本人に表示する警告文
  warned_at  timestamptz,
  acked      boolean not null default true,   -- 本人が警告を読んだか
  note       text,                            -- 運営のメモ（本人には見せない）
  updated_at timestamptz not null default now()
);
alter table public.user_flags enable row level security;
select count(*) as user_flags_rows from public.user_flags;
