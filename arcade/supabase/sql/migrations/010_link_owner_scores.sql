-- 運営本人（最初にログインしたアカウント）のログイン前の記録を、本人のアカウントに結びつける（2026-10-03 本人確認済み）
update public.scores set user_id = (select user_id from public.admins a join auth.users u on u.id = a.user_id order by u.created_at limit 1)
  where user_id is null and player in ('たいこちゃん', 'たいこちゃんだよ', 'た');

-- さくらの名前で残っている記録も、さくらのアカウントに結びつける（未紐づけ分の再確認）
update public.scores s set user_id = b.user_id from public.bots b where s.player = b.name and s.user_id is null;

-- ランキングの1位表示（feed_stats）も、アカウントに結びついた記録は「今の表示名」で返す
create or replace function public.feed_stats()
returns table(
  game_id text,
  plays bigint, d_today bigint, d_week bigint, d_year bigint,
  hi_score int, hi_player text,
  lo_score int, lo_player text
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
  named as (
    select s.game_id, s.score, s.created_at, coalesce(p.display_name, s.player) as player
    from scores s left join profiles p on p.user_id = s.user_id
  ),
  hi as (select distinct on (game_id) game_id, score as hi_score, player as hi_player from named order by game_id, score desc, created_at asc),
  lo as (select distinct on (game_id) game_id, score as lo_score, player as lo_player from named order by game_id, score asc, created_at asc)
  select a.game_id, a.plays, a.d_today, a.d_week, a.d_year, hi.hi_score, hi.hi_player, lo.lo_score, lo.lo_player
  from agg a left join hi using (game_id) left join lo using (game_id);
$$;
revoke all on function public.feed_stats() from public;
grant execute on function public.feed_stats() to anon, authenticated, service_role;

select (select count(*) from public.scores where user_id = (select user_id from public.admins limit 1)) as owner_scores,
       (select count(*) from public.scores s join public.bots b on b.name = s.player where s.user_id is null) as bot_unlinked;
