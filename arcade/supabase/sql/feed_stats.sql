-- フィード用のまとめ集計（重さ対策）。Supabase の SQL Editor で1回実行してください。
-- これまで「ゲーム1件ごとに2リクエスト＆大量のスコア行」を引いていたのを、
-- この関数1回（=1リクエスト）で全ゲームのプレイ数（今日/週/年/累計）と1位を返すようにする。
-- 未実行でもアプリは動きます（その場合は従来どおり“表示中のカードだけ”個別取得にフォールバック）。

create or replace function public.feed_stats()
returns table(
  game_id text,
  plays bigint, d_today bigint, d_week bigint, d_year bigint,
  hi_score int, hi_player text,   -- 大きいほど良いゲームの1位
  lo_score int, lo_player text    -- 小さいほど良いゲーム(タイム等)の1位
)
language sql stable security definer set search_path = public as $$
  with agg as (
    select game_id,
      count(*) as plays,
      count(*) filter (where created_at >= now() - interval '1 day')   as d_today,
      count(*) filter (where created_at >= now() - interval '7 days')  as d_week,
      count(*) filter (where created_at >= now() - interval '365 days') as d_year
    from scores group by game_id
  ),
  hi as (
    select distinct on (game_id) game_id, score as hi_score, player as hi_player
    from scores order by game_id, score desc, created_at asc
  ),
  lo as (
    select distinct on (game_id) game_id, score as lo_score, player as lo_player
    from scores order by game_id, score asc, created_at asc
  )
  select a.game_id, a.plays, a.d_today, a.d_week, a.d_year,
         hi.hi_score, hi.hi_player, lo.lo_score, lo.lo_player
  from agg a
  left join hi using (game_id)
  left join lo using (game_id);
$$;

revoke all on function public.feed_stats() from public;
grant execute on function public.feed_stats() to anon, authenticated, service_role;
