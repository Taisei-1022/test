-- ログイン（Google）・通報・管理画面のための変更。何度流しても壊れない。

-- 1) 作品にログインユーザーと「非表示（通報・運営判断）」を持たせる
alter table public.games add column if not exists user_id uuid;
alter table public.games add column if not exists hidden boolean not null default false;
create index if not exists games_user_id_idx on public.games(user_id);

-- 2) 書き込みの権限を締める
--    これまで：誰でも全作品を更新・削除できた（端末トークンの判定はアプリ側だけ）。
--    これから：ログインして作った作品（user_id あり）は、本人だけが更新・削除できる。
--              ログイン前の作品（user_id なし）は従来どおり（ログイン時に本人へ引き継ぐため）。
drop policy if exists "update games" on public.games;
create policy "update games" on public.games for update
  using (user_id is null or user_id = auth.uid())
  with check ((user_id is null or user_id = auth.uid())
    and char_length(title) <= 40 and char_length(coalesce(html, '')) < 200000);
drop policy if exists "delete games" on public.games;
create policy "delete games" on public.games for delete
  using (user_id is null or user_id = auth.uid());
drop policy if exists "insert games" on public.games;
create policy "insert games" on public.games for insert
  with check ((user_id is null or user_id = auth.uid())
    and char_length(title) <= 40 and char_length(html) < 200000);

-- hidden は運営（service_role）だけが変えられる。作者が自分で戻せないように。
create or replace function public.games_guard_hidden() returns trigger
language plpgsql as $$
begin
  if new.hidden is distinct from old.hidden
     and coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    new.hidden := old.hidden;
  end if;
  return new;
end $$;
drop trigger if exists games_guard_hidden on public.games;
create trigger games_guard_hidden before update on public.games
  for each row execute function public.games_guard_hidden();

-- 3) 通報（Edge Function 経由でのみ読み書き＝ポリシーを作らない）
create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  game_id    text not null,
  reason     text not null,
  detail     text,
  reporter   text not null,          -- 端末トークン or "uid:<ユーザーID>"（同じ人の重複を数えないため）
  status     text not null default 'open',   -- open / done
  created_at timestamptz not null default now()
);
create index if not exists reports_game_idx on public.reports(game_id);
create unique index if not exists reports_once_idx on public.reports(game_id, reporter);
alter table public.reports enable row level security;

-- 確認
select column_name from information_schema.columns where table_schema='public' and table_name='games' order by ordinal_position;
