-- 確認（読むだけ）：Googleログインの利用者数と、引き継がれた作品数。メールアドレス等は出さない（ログは公開されうるため）
select (select count(*) from auth.users) as users,
       (select count(*) from auth.identities where provider = 'google') as google_logins,
       (select max(last_sign_in_at) from auth.users) as last_sign_in,
       (select count(*) from public.games where user_id is not null) as games_with_user;
