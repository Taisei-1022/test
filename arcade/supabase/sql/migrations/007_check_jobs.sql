-- 確認（読むだけ）：直近の生成ジョブの結果（エラー内容と経過記録だけ。会話や作品の中身は出さない）
select created_at, left(token, 12) as who,
       result->>'error' as error, left(result->>'detail', 300) as detail,
       (result->>'pending') as pending,
       case when result ? 'html' then 'has_html' else '' end as html,
       array_to_string(array(select jsonb_array_elements_text(coalesce(result->'diag','[]'::jsonb))), ' | ') as diag
from public.gen_jobs order by created_at desc limit 6;
