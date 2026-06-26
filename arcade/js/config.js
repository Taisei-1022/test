/* 共有ランキングの設定
   - Supabase の「Project URL」と「anon public キー」を入れると共有ランキングになる。
   - 空のままなら端末内(localStorage)で動作する（フォールバック）。
   - ⚠️ service_role キーは絶対に入れない（anon public のみ）。 */
window.ARCADE_CONFIG = {
  supabaseUrl: "",   // 例: https://abcd1234.supabase.co
  supabaseKey: ""    // anon public キー
};
