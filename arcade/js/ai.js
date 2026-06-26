/* AI生成クライアント（Supabase Edge Function 経由でClaudeを呼ぶ）
   - APIキーはサーバー側にあり、ここからは触れない。
   - 設定が無い／関数が未デプロイなら例外を投げ、UIがメッセージを出す。 */
window.Ai = (function () {
  "use strict";
  var cfg = window.ARCADE_CONFIG || {};
  function fnUrl() { return cfg.supabaseUrl ? cfg.supabaseUrl.replace(/\/$/, "") + "/functions/v1/generate" : ""; }

  return {
    available: function () { return !!(cfg.supabaseUrl && cfg.supabaseKey); },
    // prevHtml を渡すと「既存ゲームを指示で修正」モードになる（案A）
    generate: async function (prompt, prevHtml) {
      var url = fnUrl();
      if (!url || !cfg.supabaseKey) throw new Error("not_configured");
      var res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.supabaseKey,
          "Authorization": "Bearer " + cfg.supabaseKey
        },
        body: JSON.stringify({ prompt: prompt, prevHtml: prevHtml || "" })
      });
      if (!res.ok) {
        var t = ""; try { t = await res.text(); } catch (e) {}
        throw new Error("generate_failed:" + res.status + ":" + t.slice(0, 160));
      }
      var data = await res.json();
      if (!data || !data.html) throw new Error("generate_empty");
      return { title: data.title || "無題のゲーム", html: data.html };
    }
  };
})();
