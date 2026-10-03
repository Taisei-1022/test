-- サムネイルを画像置き場（Storage）へ。作品一覧には URL だけを載せて軽くする。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('thumbs', 'thumbs', true, 524288, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 524288, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
-- ログインした本人だけが、自分のフォルダ（thumbs/<ユーザーID>/…）に置ける。見るのは誰でも可（公開）。
drop policy if exists "thumbs upload own" on storage.objects;
create policy "thumbs upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'thumbs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "thumbs update own" on storage.objects;
create policy "thumbs update own" on storage.objects for update to authenticated
  using (bucket_id = 'thumbs' and (storage.foldername(name))[1] = auth.uid()::text);
select (select count(*) from storage.buckets where id = 'thumbs') as bucket,
       (select count(*) from public.games where thumb like 'data:%') as data_uri_thumbs;
