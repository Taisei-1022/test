-- 賑わい演出のプレイヤー（さくら）にも @ID を付ける（2026-10-03 運営判断）。
-- ・ゲームの公開やフォローはしない。ランキングに @ID 付きで並ぶだけ。
-- ・運営が見分けられるよう bots に記録する（公開はしない）。ID はログインユーザーと重ならない固定値。
create table if not exists public.bots (user_id uuid primary key, name text not null unique);
alter table public.bots enable row level security;
with src(name, handle) as (values
  ('ぴこ','pico_08'),
  ('うどん','udon_daisuki'),
  ('みどり','midori_k'),
  ('くま','kumakuma3'),
  ('リク','riku0721'),
  ('なな','nana_nn'),
  ('ハル','haru_bb'),
  ('そら','sora_iro'),
  ('マロン','maron55'),
  ('ゲンキ','genki_desu'),
  ('ぽち','pochi_wan'),
  ('チョコ','choco_mint7'),
  ('ユウ','yuu_0x'),
  ('あお','ao_ao_'),
  ('コーン','corn_pota'),
  ('しお','shio_aji'),
  ('モカ','moka_latte'),
  ('テン','ten10ten'),
  ('リン','rin_rin2'),
  ('かい','kai_umi'),
  ('ニケ','nikeko'),
  ('タロ','taro_p'),
  ('ぷりん','purin_mog'),
  ('みかん','mikan_cc'),
  ('ゆず','yuzu_ponzu'),
  ('らて','latte_art'),
  ('のっち','notchi_n'),
  ('ばや','baya_b'),
  ('きなこ','kinako_m'),
  ('しろ','shiro_neko')
), ids as (select name, handle, md5('vappa-sakura-' || name)::uuid as uid from src)
, b as (insert into public.bots(user_id, name) select uid, name from ids on conflict do nothing)
insert into public.profiles(user_id, handle, display_name, bio, created_at, handle_changed_at)
  select uid, handle, name, '', now() - (random() * interval '60 days'), now() - interval '60 days' from ids
  where not exists (select 1 from public.profiles p where p.handle = ids.handle)
  on conflict (user_id) do nothing;
-- 既存のさくらのスコアを、そのアカウントに紐づける
update public.scores s set user_id = b.user_id from public.bots b where s.player = b.name and s.user_id is null;
select (select count(*) from public.bots) as bots,
       (select count(*) from public.profiles p join public.bots b on b.user_id = p.user_id) as bot_profiles,
       (select count(*) from public.scores where user_id in (select user_id from public.bots)) as bot_scores;
