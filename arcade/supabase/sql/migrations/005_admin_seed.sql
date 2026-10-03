-- 運営アカウントの登録：最初にログインしたアカウント（＝運営本人。2026-10-03 に確認済み）
insert into public.admins(user_id)
  select id from auth.users order by created_at asc limit 1
  on conflict do nothing;
select (select count(*) from public.admins) as admins, (select count(*) from auth.users) as users,
       (select count(*) from public.admins a join auth.users u on u.id = a.user_id
         where u.created_at = (select min(created_at) from auth.users)) as admin_is_first_user;
