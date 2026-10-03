-- いいね（ゲーム単位）。「いつ・誰が」を残す＝週・月ごとの増え方も後から集計できる。
-- liker：ログイン中は 'uid:<ユーザーID>'、未ログインは端末ごとのトークン。同じ人が同じゲームに付けられるのは1回。
-- 書き込みはサーバー経由だけ（回線ごとの回数制限をかけるため）。
create table if not exists public.likes (
  game_id    text not null,
  liker      text not null,
  user_id    uuid,
  created_at timestamptz not null default now(),
  primary key (game_id, liker)
);
create index if not exists likes_created_idx on public.likes(created_at);
create index if not exists likes_user_idx on public.likes(user_id);
alter table public.likes enable row level security;

-- ゲームごとのいいね数（全期間・直近7日・直近30日）
create or replace function public.like_stats()
returns table(game_id text, total bigint, d7 bigint, d30 bigint)
language sql stable security definer set search_path = public as $$
  select game_id, count(*),
         count(*) filter (where created_at >= now() - interval '7 days'),
         count(*) filter (where created_at >= now() - interval '30 days')
  from likes group by game_id;
$$;
revoke all on function public.like_stats() from public;
grant execute on function public.like_stats() to anon, authenticated, service_role;
select count(*) as likes from public.likes;
