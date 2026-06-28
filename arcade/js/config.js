/* 共有ランキングの設定
   - Supabase の「Project URL」と「publishable / anon キー」を入れると共有ランキングになる。
   - 空のままなら端末内(localStorage)で動作する（フォールバック）。
   - ⚠️ service_role / secret キーは絶対に入れない（公開鍵のみ）。 */
window.ARCADE_CONFIG = {
  supabaseUrl: "https://httrzepweyxzbkosdoau.supabase.co",
  supabaseKey: "sb_publishable_rieAIjPwD1_O2H4w40I6MQ_kWw1puOC"
};

/* 急上昇（遊ぶ画面の上部に常設）に出すゲームID。ここを編集すれば差し替えられる。
   先頭から順に表示。seed は "burger" 等の固定ID、生成ゲームはDBのUUID。 */
window.ARCADE_TRENDING = [
  "burger",                                   // バーガータワー（既定）
  "c7cb2ca9-e665-4e90-a1c7-5673dbdd4bba",     // ゴールド・フィッシャー：マーメイドの誘惑
  "ad469fde-bf2b-4b49-95d7-0b62e59c367a",     // パーフェクト駐車
  "db5d1ddd-2b65-4f7c-9fed-8a853617a6c3"      // かつき/えのもとのワクワクトレーラー
];
