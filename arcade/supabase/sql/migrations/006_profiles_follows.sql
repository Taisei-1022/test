-- ③ @ID＋表示名、④ フォロー。何度流しても壊れない。

-- プロフィール（公開情報だけ。メールアドレスは持たない）。書き込みはサーバー経由だけ（ルール確認のため）。
create table if not exists public.profiles (
  user_id           uuid primary key,
  handle            text not null unique check (handle ~ '^[a-z][a-z0-9_]{2,14}$'),
  display_name      text not null check (char_length(display_name) between 1 and 20),
  bio               text not null default '' check (char_length(bio) <= 160),
  created_at        timestamptz not null default now(),
  handle_changed_at timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select using (true);

-- 予約ID（誰も取れない）。2026-10-03 運営レビュー済み。
create table if not exists public.reserved_handles (handle text primary key);
alter table public.reserved_handles enable row level security;
insert into public.reserved_handles(handle) values
  ('admin'),('administrator'),('root'),('system'),('official'),('staff'),('team'),('support'),('help'),('info'),('contact'),
  ('mod'),('moderator'),('owner'),('operator'),('unei'),('security'),
  ('api'),('app'),('www'),('mail'),('me'),('you'),('mypage'),('settings'),('account'),('login'),('logout'),('signup'),
  ('search'),('explore'),('follow'),('following'),('followers'),('ranking'),('leaderboard'),('play'),('create'),('games'),
  ('game'),('new'),('popular'),('trending'),('about'),('terms'),('privacy'),('guide'),('faq'),('guidelines'),('report'),
  ('notice'),('news'),
  ('billing'),('payment'),('shop'),('store'),('premium'),('pro'),('plus'),('gift'),
  ('null'),('undefined'),('noname'),('guest'),('anonymous'),('unknown'),('test'),('user'),('everyone'),('all'),
  ('google'),('apple'),('nintendo'),('sony'),('playstation'),('microsoft'),('xbox'),('pokemon'),('mario'),('sega'),
  ('capcom'),('bandai'),('namco'),('konami'),('squareenix'),('youtube'),('tiktok'),('twitter'),('instagram'),('line'),
  ('discord'),('openai'),('anthropic'),('claude'),('chatgpt'),('deepseek'),('supabase'),('stripe')
on conflict do nothing;

-- 運営（公式）のプロフィール。作者不明の作品はこの持ち物になっている。
insert into public.profiles(user_id, handle, display_name, bio)
  values ('00000000-0000-0000-0000-00000000a0a0', 'vappa', 'Vappa公式', 'Vappa運営の公式アカウントです。')
  on conflict (user_id) do nothing;

-- フォロー（誰が誰をフォローしているかは公開）。本人だけが自分のフォローを追加・解除できる。
create table if not exists public.follows (
  follower   uuid not null,
  followee   uuid not null,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee_idx on public.follows(followee);
alter table public.follows enable row level security;
drop policy if exists "read follows" on public.follows;
create policy "read follows" on public.follows for select using (true);
drop policy if exists "add follow" on public.follows;
create policy "add follow" on public.follows for insert with check (auth.uid() is not null and follower = auth.uid());
drop policy if exists "remove follow" on public.follows;
create policy "remove follow" on public.follows for delete using (auth.uid() is not null and follower = auth.uid());

select (select count(*) from public.reserved_handles) as reserved, (select count(*) from public.profiles) as profiles;
