-- 現状確認（読むだけ）：games / scores の行レベルセキュリティ設定と列
select tablename, policyname, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname;
