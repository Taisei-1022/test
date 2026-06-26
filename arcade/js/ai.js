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
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": cfg.supabaseKey, "Authorization": "Bearer " + cfg.supabaseKey },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { var t = ""; try { t = await res.text(); } catch (e) {} throw new Error("ai_failed:" + res.status + ":" + t.slice(0, 160)); }
    return res.json();
  }

  return {
    available: function () { return !!(cfg.supabaseUrl && cfg.supabaseKey); },
    // 会話を送る（相談 or 生成）。prevHtml を渡すと既存ゲームの編集モード。
    send: function (messages, prevHtml) { return post({ messages: messages, prevHtml: prevHtml || "" }); },
    // 後方互換：一言からそのまま生成
    generate: async function (prompt, prevHtml) {
      var r = await post({ messages: [{ role: "user", content: prompt }], prevHtml: prevHtml || "" });
      if (!r.html) throw new Error("generate_empty");
      return { title: r.title || "無題のゲーム", html: r.html };
    }
  };
})();
