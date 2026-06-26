/* 共有ランキングの設定
   - Supabase の「Project URL」と「publishable / anon キー」を入れると共有ランキングになる。
   - 空のままなら端末内(localStorage)で動作する（フォールバック）。
   - ⚠️ service_role / secret キーは絶対に入れない（公開鍵のみ）。 */
window.ARCADE_CONFIG = {
  supabaseUrl: "https://httrzepweyxzbkosdoau.supabase.co",
  supabaseKey: "sb_publishable_rieAIjPwD1_O2H4w40I6MQ_kWw1puOC"
};
