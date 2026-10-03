-- 作品ごとの点数の種類と単位（取り込んだゲームは「秒・小さいほど良い」などを持つ）。未設定なら従来どおり「点・大きいほど良い」。
alter table public.games add column if not exists score_type text check (score_type in ('high', 'low'));
alter table public.games add column if not exists score_unit text check (char_length(score_unit) <= 6);
select count(*) from public.games;
