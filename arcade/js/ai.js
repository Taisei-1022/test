/* AI生成クライアント（Supabase Edge Function 経由でClaudeを呼ぶ）
   - send(messages, prevHtml): 会話を送り { action:'ask'|'build', reply, options?, title?, html? } を受け取る
   - APIキーはサーバー側にあり、ここからは触れない。 */
window.Ai = (function () {
  "use strict";
  var cfg = window.ARCADE_CONFIG || {};
  function fnUrl() { return cfg.supabaseUrl ? cfg.supabaseUrl.replace(/\/$/, "") + "/functions/v1/generate" : ""; }

  async function post(payload) {
    var url = fnUrl();
    if (!url || !cfg.supabaseKey) throw new Error("not_configured");
    // 生成は時間がかかる。サーバーはストリームで隙間にスペースを送って接続を維持し、
    // 最後にJSONを流す。ここでは本文を全部受け取り、trim()してからparseする。
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 180000) : null;
    var res, raw;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg.supabaseKey, "Authorization": "Bearer " + cfg.supabaseKey },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      });
      raw = await res.text();
    } finally { if (timer) clearTimeout(timer); }
    var data = null;
    try { data = JSON.parse((raw || "").trim()); } catch (e) {}
    if (!res.ok) { throw new Error("ai_failed:" + res.status + ":" + String(raw || "").slice(0, 160)); }
    if (!data) throw new Error("bad_response");
    if (data.error === "rate_limited") throw new Error("rate_limited:" + (data.reason || "") + (data.retry_sec ? (":" + data.retry_sec) : ""));
    if (data.error) throw new Error("ai_failed:" + data.error + (data.detail ? (":" + data.detail) : ""));
    return data;
  }
  // 端末ごとの簡易ID（Catalogと同じトークン）。レート制限のキーに使う。
  function token() { try { return (window.Catalog && Catalog.owner) ? Catalog.owner() : ""; } catch (e) { return ""; } }

  return {
    available: function () { return !!(cfg.supabaseUrl && cfg.supabaseKey); },
    // 会話を送る（相談 or 生成）。prevHtml を渡すと既存ゲームの編集モード。
    send: function (messages, prevHtml) { return post({ messages: messages, prevHtml: prevHtml || "", token: token() }); },
    // 後方互換：一言からそのまま生成
    generate: async function (prompt, prevHtml) {
      var r = await post({ messages: [{ role: "user", content: prompt }], prevHtml: prevHtml || "", token: token() });
      if (!r.html) throw new Error("generate_empty");
      return { title: r.title || "無題のゲーム", html: r.html };
    }
  };
})();
