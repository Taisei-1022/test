-- セキュリティ強化（②）。何度流しても壊れない。

-- 1) 運営アカウント（管理画面に入れる人）。Googleログインしたユーザーを登録する。
create table if not exists public.admins (
  user_id    uuid primary key,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- ポリシーなし＝サーバーだけが読める
-- 初回：ログインユーザーがまだ1人（＝運営本人）だけなら、その人を運営に登録
insert into public.admins(user_id)
  select id from auth.users where (select count(*) from auth.users) = 1
  on conflict do nothing;

-- 2) ログイン前に作られた作品（作者不明）は「運営の所有物」にする。
--    運営用の固定ID（誰のログインとも一致しない）＝ブラウザからは誰も書き換えられない。
update public.games set user_id = '00000000-0000-0000-0000-00000000a0a0', owner = 'official'
  where user_id is null;

-- 3) 作品の書き込みは「ログインした本人の作品」だけ（匿名の新規作成・更新・削除を禁止）
drop policy if exists "insert games" on public.games;
create policy "insert games" on public.games for insert
  with check (auth.uid() is not null and user_id = auth.uid()
    and char_length(title) <= 40 and char_length(html) < 200000);
drop policy if exists "update games" on public.games;
create policy "update games" on public.games for update
  using (auth.uid() is not null and user_id = auth.uid())
  with check (user_id = auth.uid() and char_length(title) <= 40 and char_length(coalesce(html, '')) < 200000);
drop policy if exists "delete games" on public.games;
create policy "delete games" on public.games for delete
  using (auth.uid() is not null and user_id = auth.uid());

-- 4) スコアはサーバー（Edge Function）経由でだけ登録できる。ブラウザからの直接登録を禁止。
alter table public.scores add column if not exists user_id uuid;
drop policy if exists "insert scores" on public.scores;

-- 確認
select (select count(*) from public.admins) as admins,
       (select count(*) from public.games where user_id is null) as games_without_owner,
       (select count(*) from public.games where user_id = '00000000-0000-0000-0000-00000000a0a0') as official_games,
       (select count(*) from pg_policies where schemaname='public' and tablename='scores') as score_policies;
