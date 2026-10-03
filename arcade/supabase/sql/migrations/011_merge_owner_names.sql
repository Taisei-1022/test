-- 運営本人の記録の名前を「たいこちゃん」に統一（2026-10-03 本人の指示）
update public.scores set player = 'たいこちゃん'
  where player in ('たいこちゃんだよ', 'た')
    and user_id = (select a.user_id from public.admins a join auth.users u on u.id = a.user_id order by u.created_at limit 1);
select (select count(*) from public.scores where player in ('たいこちゃんだよ', 'た')) as left_rows,
       (select count(*) from public.scores where player = 'たいこちゃん') as taiko_rows;
