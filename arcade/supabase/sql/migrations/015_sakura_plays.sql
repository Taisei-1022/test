-- さくらに、各ゲームを「人間の1位を超えない範囲で」遊ばせて、ランキングをにぎやかにする（2026-10-03 運営指示）。
-- 人間らしさ：さくらごとに遊ぶ量（ほぼ遊ばない／ほどほど／ハマっている）を固定し、ゲームごとに参加するかどうか・回数・点数・時間帯をばらつかせる。
-- 人間の記録が1件もないゲームは、さくらが1位になってしまうので触らない。
do $$
declare
  g record; b record; hb numeric; lvl int; p_join numeric; k int; i int; sc numeric; t timestamptz;
begin
  -- 既存のさくらの記録が人間の1位を超えていたら、下げておく
  for g in
    select s.game_id, (case when s.game_id = 'reflex' or gm.score_type = 'low' then 'low' else 'high' end) as typ
    from (select distinct game_id from public.scores) s left join public.games gm on gm.id::text = s.game_id
  loop
    if g.typ = 'low' then
      select min(score) into hb from public.scores where game_id = g.game_id and (user_id is null or user_id not in (select user_id from public.bots)) and player not in ('selftest','接続確認');
      if hb is not null then update public.scores set score = ceil(hb * (1.05 + random() * 0.4))
        where game_id = g.game_id and user_id in (select user_id from public.bots) and score <= hb; end if;
    else
      select max(score) into hb from public.scores where game_id = g.game_id and (user_id is null or user_id not in (select user_id from public.bots)) and player not in ('selftest','接続確認');
      if hb is not null and hb > 1 then update public.scores set score = floor(hb * (0.5 + random() * 0.45))
        where game_id = g.game_id and user_id in (select user_id from public.bots) and score >= hb; end if;
    end if;
  end loop;

  for g in
    select id, typ from (
      select unnest(array['matsushima','city','train','railway','reflex','dodge','royale','burger','pingpong']) as id,
             null::text as typ0
      union all
      select id::text, score_type from public.games where published and not hidden
    ) x(id, typ0) cross join lateral (select case when x.id = 'reflex' or x.typ0 = 'low' then 'low' else 'high' end as typ) y
  loop
    if g.typ = 'low' then
      select min(score) into hb from public.scores where game_id = g.id and (user_id is null or user_id not in (select user_id from public.bots)) and player not in ('selftest','接続確認');
    else
      select max(score) into hb from public.scores where game_id = g.id and (user_id is null or user_id not in (select user_id from public.bots)) and player not in ('selftest','接続確認');
    end if;
    if hb is null or (g.typ = 'high' and hb < 2) then continue; end if;   -- 人間の記録がない／低すぎるゲームは触らない

    for b in select bt.user_id, bt.name from public.bots bt loop
      -- 遊ぶ量はさくらごとに固定：0=ほぼ遊ばない 1=ほどほど 2=ハマっている
      lvl := (('x' || substr(md5(b.user_id::text), 1, 2))::bit(8)::int) % 3;
      p_join := case lvl when 0 then 0.12 when 1 then 0.32 else 0.55 end;
      if random() > p_join then continue; end if;
      k := case lvl when 0 then 1 when 1 then 1 + floor(random() * 3)::int else 2 + floor(power(random(), 2) * 12)::int end;
      for i in 1..k loop
        if g.typ = 'low' then
          sc := ceil(hb * (1.08 + power(random(), 0.8) * 1.6));
        else
          sc := floor(hb * (0.12 + power(random(), 0.6) * 0.8));   -- 1位の12〜92%（上の方ほど少ない）
          if sc >= hb then sc := hb - 1; end if;
        end if;
        -- 時間帯：夜（19〜25時）が多め、たまに昼と深夜
        t := date_trunc('day', now() - (random() * interval '60 days'))
             + (case when random() < 0.6 then interval '10 hours' + random() * interval '6 hours'      -- 日本時間 19〜25時（UTC 10〜16時）
                     when random() < 0.7 then interval '3 hours' + random() * interval '6 hours'       -- 日本時間 12〜18時
                     else interval '16 hours' + random() * interval '4 hours' end);                     -- 日本時間 深夜1〜5時
        if t > now() then t := t - interval '1 day'; end if;
        insert into public.scores (game_id, player, score, user_id, created_at) values (g.id, b.name, sc, b.user_id, t);
      end loop;
    end loop;
  end loop;
end $$;

-- 確認：さくらが1位になっているゲームの数（0のはず）と、追加後のさくらの記録数
with best as (
  select distinct on (s.game_id) s.game_id, s.user_id
  from public.scores s left join public.games gm on gm.id::text = s.game_id
  order by s.game_id, case when s.game_id = 'reflex' or gm.score_type = 'low' then s.score else -s.score end, s.created_at
)
select (select count(*) from best where user_id in (select user_id from public.bots)) as bot_first_places,
       (select count(*) from public.scores where user_id in (select user_id from public.bots)) as bot_scores;
