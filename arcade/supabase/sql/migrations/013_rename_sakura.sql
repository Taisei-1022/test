-- さくらの名前と@IDを、より人間らしいものに全面差し替え（2026-10-03 運営承認）。
-- 記録・フォロー・作品はアカウント（user_id）で結びついているので、そのまま引き継がれる。
create temp table if not exists ren(old_name text, new_name text, new_handle text);
truncate ren;
insert into ren values
  ('ぴこ','ああああ','aaaaa_a'),
  ('うどん','asdf','asdfghjk'),
  ('みどり','ｗ','www_w'),
  ('くま','こ','ko_ko_ko'),
  ('リク','名前考えるのめんどい','mendoi_'),
  ('なな','ななし','nanashi44'),
  ('ハル','おれ','ore_ore'),
  ('そら','user8392','user8392'),
  ('マロン','うんち','unchi_man'),
  ('ゲンキ','おなら王','onara_ou'),
  ('ぽち','ｹﾝﾀ','kenta_0o'),
  ('チョコ','ゅぅ','yuu_ww'),
  ('ユウ','ﾁｮｺﾊﾟﾝ','chocopan_'),
  ('あお','ゆうと(小5)','yuto_shogaku'),
  ('コーン','母です','haha_desu'),
  ('しお','部活おわた','bukatsu_owata'),
  ('モカ','数学赤点','akaten_math'),
  ('テン','まじむり','majimuri'),
  ('リン','ねむすぎ','nemu_sugi'),
  ('かい','誰か一緒にやろ','issho_yaro'),
  ('ニケ','草','kusa_kusa'),
  ('タロ','さいきょう','saikyou_desu'),
  ('ぷりん','世界ランク1位(自称)','jisho_no1'),
  ('みかん','xX_dark_Xx','dark_xx'),
  ('ゆず','たかし','takashi_t'),
  ('らて','ゆな','yuna_xx'),
  ('のっち','mii','mii_0305'),
  ('ばや','ちくわ大明神','chikuwa_dmj'),
  ('きなこ','芽が出たじゃがいも','jagaimo_me'),
  ('しろ','冷蔵庫','reizouko_');
-- @ID の入れ替え：先に仮の@IDにしてから付け直す（入れ替え途中の重複を避ける）
update public.profiles p set handle = 'tmp_' || substr(md5(p.user_id::text), 1, 10)
  from public.bots b join ren r on r.old_name = b.name where p.user_id = b.user_id;
update public.profiles p set handle = r.new_handle, display_name = r.new_name, bio = '', updated_at = now()
  from public.bots b join ren r on r.old_name = b.name where p.user_id = b.user_id;
update public.scores s set player = r.new_name
  from public.bots b join ren r on r.old_name = b.name where s.user_id = b.user_id;
update public.games g set author = r.new_name
  from public.bots b join ren r on r.old_name = b.name where g.user_id = b.user_id;
update public.bots b set name = r.new_name from ren r where r.old_name = b.name;
select (select count(*) from public.bots b join public.profiles p on p.user_id = b.user_id where p.handle like 'tmp\_%') as stuck,
       (select string_agg(p.display_name || '@' || p.handle, ', ') from public.bots b join public.profiles p on p.user_id = b.user_id) as bots;
