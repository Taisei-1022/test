/* Googleログイン（Supabase Auth）。パスワードは扱わない。
   - login(): Google の画面へ移動 → auth.html に戻ってきてトークンを保存 → 元の画面へ。
   - 遊ぶだけならログイン不要。作る時だけ必須（必須かどうかはサーバーが決める＝Ai.usage の login_required）。
   - ログイン前にこの端末で作った作品は、初回ログイン時にそのアカウントへ引き継ぐ（claim）。
   - 保存先は localStorage（この端末だけ）。期限が近づいたら refresh_token で自動更新。 */
window.Auth = (function () {
  "use strict";
  var cfg = window.ARCADE_CONFIG || {};
  var base = (cfg.supabaseUrl || "").replace(/\/$/, "");
  var KEY = "arcade.auth", RET = "arcade.auth.return";
  var sess = null, refreshing = null;
  try { sess = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { sess = null; }

  function save(s) {
    sess = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent("vappa:auth", { detail: { user: user() } })); } catch (e) {}
  }
  function hdr(tok) { return { apikey: cfg.supabaseKey, Authorization: "Bearer " + (tok || cfg.supabaseKey), "Content-Type": "application/json" }; }
  function user() { return sess && sess.user ? { id: sess.user.id, email: sess.user.email || "", name: (sess.user.user_metadata && (sess.user.user_metadata.full_name || sess.user.user_metadata.name)) || "" } : null; }

  async function fetchUser(tok) {
    var r = await fetch(base + "/auth/v1/user", { headers: hdr(tok) });
    if (!r.ok) throw new Error("user_" + r.status);
    return r.json();
  }
  async function refresh() {
    if (!sess || !sess.refresh_token) return null;
    if (refreshing) return refreshing;
    refreshing = (async function () {
      try {
        var r = await fetch(base + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: hdr(), body: JSON.stringify({ refresh_token: sess.refresh_token }) });
        if (r.status === 400 || r.status === 401) { save(null); return null; }   // 失効＝ログアウト扱い
        if (!r.ok) return sess;                                                  // 一時的な失敗は様子見
        var d = await r.json();
        save({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000, user: d.user || sess.user });
        return sess;
      } catch (e) { return sess; } finally { refreshing = null; }
    })();
    return refreshing;
  }
  // 有効なアクセストークン（期限まで2分を切っていたら先に更新）。未ログインは ""
  async function token() {
    if (!sess) return "";
    if (Date.now() > sess.expires_at - 120000) await refresh();
    return sess ? sess.access_token : "";
  }
  // 同期版（Catalog の書き込みヘッダ用）。期限切れなら "" を返し、裏で更新を始める。
  function tokenSync() {
    if (!sess) return "";
    if (Date.now() > sess.expires_at - 120000) { refresh(); return Date.now() < sess.expires_at ? sess.access_token : ""; }
    return sess.access_token;
  }

  // ログイン前にこの端末で作った作品を、このアカウントのものにする（初回ログイン時に1回）
  async function claim() {
    var u = user(); if (!u || !window.Catalog || !Catalog.isRemote) return;
    var oldOwner = Catalog.owner(), newOwner = "uid:" + u.id;
    if (oldOwner === newOwner) return;
    try {
      await fetch(base + "/rest/v1/games?owner=eq." + encodeURIComponent(oldOwner) + "&user_id=is.null", {
        method: "PATCH", headers: Object.assign(hdr(sess.access_token), { Prefer: "return=minimal" }),
        body: JSON.stringify({ owner: newOwner, user_id: u.id })
      });
    } catch (e) { console.warn("claim failed", e); }
    // 以後はどの端末でも同じ owner になる＝マイページの「作ったゲーム」が端末をまたいで出る
    try { localStorage.setItem("arcade.owner.before", oldOwner); localStorage.setItem("arcade.owner", newOwner); } catch (e) {}
  }

  // auth.html から呼ぶ：URL の #access_token=... を保存して元の画面へ戻す
  async function handleCallback() {
    var h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    var q = new URLSearchParams(location.search || "");
    var err = h.get("error_description") || q.get("error_description") || h.get("error") || q.get("error");
    if (err) return { error: err };
    var at = h.get("access_token");
    if (!at) return { error: "ログイン情報が見つかりませんでした" };
    var u = await fetchUser(at);
    save({ access_token: at, refresh_token: h.get("refresh_token"), expires_at: Date.now() + (parseInt(h.get("expires_in"), 10) || 3600) * 1000, user: u });
    await claim();
    var ret = "./#create";
    try { ret = localStorage.getItem(RET) || ret; localStorage.removeItem(RET); } catch (e) {}
    return { ok: true, ret: ret };
  }

  return {
    available: function () { return !!(base && cfg.supabaseKey); },
    user: user,
    token: token,
    tokenSync: tokenSync,
    handleCallback: handleCallback,
    // Google でログイン（ret: ログイン後に戻る場所。既定は「作る」タブ）
    login: function (ret) {
      try { localStorage.setItem(RET, ret || (location.pathname.replace(/[^/]*$/, "") + "#create")); } catch (e) {}
      var back = location.origin + location.pathname.replace(/[^/]*$/, "") + "auth.html";
      location.href = base + "/auth/v1/authorize?provider=google&redirect_to=" + encodeURIComponent(back);
    },
    logout: async function () {
      var t = sess && sess.access_token;
      save(null);
      // 端末トークンはログイン前のものに戻す（ログアウト後に他人の作品を「自分の」と表示しないため）
      try { var b = localStorage.getItem("arcade.owner.before"); b ? localStorage.setItem("arcade.owner", b) : localStorage.removeItem("arcade.owner"); } catch (e) {}
      if (t) { try { await fetch(base + "/auth/v1/logout", { method: "POST", headers: hdr(t) }); } catch (e) {} }
    },
    // Google ログインがサーバー側で有効になっているか（設定前はボタンを出さない）
    googleEnabled: async function () {
      try { var r = await fetch(base + "/auth/v1/settings", { headers: { apikey: cfg.supabaseKey } }); var d = await r.json(); return !!(d && d.external && d.external.google); }
      catch (e) { return false; }
    }
  };
})();
