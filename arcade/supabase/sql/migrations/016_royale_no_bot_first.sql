-- 人間の記録が1件もないゲーム（royale）では、さくらが1位になってしまうので、さくらの記録を外す
delete from public.scores where game_id = 'royale' and user_id in (select user_id from public.bots)
  and not exists (select 1 from public.scores s where s.game_id = 'royale' and (s.user_id is null or s.user_id not in (select user_id from public.bots)));
select count(*) as royale_rows from public.scores where game_id = 'royale';
