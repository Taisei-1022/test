-- AI生成のレート制限（コスト/不正対策）
-- Supabase の SQL Editor に1回貼って実行してください。
-- これを実行すると、generate Edge Function 側の上限チェックが有効になります。
-- （未実行でもアプリは動きます＝その間は無制限・無防備。実行すると保護が効きます。）

create table if not exists public.ai_usage (
  bucket  text primary key,        -- 例: 'u:bld:<token>:2026-06-26' / 'i:req:<ip>:...' / 'g:bld:...'
  n       int  not null default 0, -- 当日のカウント
  last_at timestamptz              -- 直近リクエスト時刻（クールダウン用）
);
alter table public.ai_usage enable row level security;  -- 直接アクセスは不可（下の関数経由のみ）

-- 上限チェック＋加算をアトミックに行う。allowed=false なら理由を返す。
create or replace function public.ai_gate(
  ub text, ib text, gb text,           -- user / ip / global のバケットキー
  umax int, imax int, gmax int,        -- それぞれの上限
  cooldown int                         -- userバケットへのクールダウン秒（0で無効）
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare un int; ic int; gc int; ula timestamptz;
begin
  select n, last_at into un, ula from ai_usage where bucket = ub for update;
  un := coalesce(un, 0);
  select n into ic from ai_usage where bucket = ib for update; ic := coalesce(ic, 0);
  select n into gc from ai_usage where bucket = gb for update; gc := coalesce(gc, 0);

  if cooldown > 0 and ula is not null and now() < ula + make_interval(secs => cooldown) then
    return jsonb_build_object('allowed', false, 'reason', 'cooldown',
      'retry_sec', ceil(extract(epoch from (ula + make_interval(secs => cooldown) - now()))));
  end if;
  if un >= umax then return jsonb_build_object('allowed', false, 'reason', 'user_daily',   'limit', umax); end if;
  if ic >= imax then return jsonb_build_object('allowed', false, 'reason', 'ip_daily',     'limit', imax); end if;
  if gc >= gmax then return jsonb_build_object('allowed', false, 'reason', 'global_daily', 'limit', gmax); end if;

  insert into ai_usage(bucket, n, last_at) values (ub, 1, now())
    on conflict (bucket) do update set n = ai_usage.n + 1, last_at = now();
  insert into ai_usage(bucket, n) values (ib, 1) on conflict (bucket) do update set n = ai_usage.n + 1;
  insert into ai_usage(bucket, n) values (gb, 1) on conflict (bucket) do update set n = ai_usage.n + 1;
  return jsonb_build_object('allowed', true, 'remaining', greatest(umax - (un + 1), 0));
end $$;

revoke all on function public.ai_gate(text,text,text,int,int,int,int) from public, anon, authenticated;
grant  execute on function public.ai_gate(text,text,text,int,int,int,int) to service_role;

-- 古い当日以外の行を掃除したい時（任意・手動）:
--   delete from public.ai_usage where bucket !~ (to_char(current_date,'YYYY-MM-DD'));
