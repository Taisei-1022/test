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
    // アプリ専用マーカー（role:"ui"=ボタン状態, role:"imgs"=素材画像base64）はサーバーに送らない。
    // 特に画像はここで確実に落とす（通信量とプロンプト汚染の防止）。
    if (Array.isArray(payload.messages)) {
      payload.messages = payload.messages.filter(function (m) { return m && (m.role === "user" || m.role === "assistant"); });
    }
    // 生成は時間がかかる。サーバーはストリームで隙間にスペースを送って接続を維持し、
    // 最後にJSONを流す。ここでは本文を全部受け取り、trim()してからparseする。
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 180000) : null;
    var res, raw;
    // ログイン中は本人のトークンを付ける（作る＝相談・生成はログイン必須。サーバーが確かめる）
    var ut = (window.Auth && Auth.token) ? await Auth.token() : "";
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg.supabaseKey, "Authorization": "Bearer " + (ut || cfg.supabaseKey) },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      });
      raw = await res.text();
    } finally { if (timer) clearTimeout(timer); }
    var data = null;
    try { data = JSON.parse((raw || "").trim()); } catch (e) {}
    if (!res.ok) { throw new Error("ai_failed:" + res.status + ":" + String(raw || "").slice(0, 160)); }
    if (!data) throw new Error("bad_response");
    if (data.error === "login_required") { try { window.dispatchEvent(new CustomEvent("vappa:needlogin")); } catch (e) {} throw new Error("login_required"); }
    if (data.error === "banned") throw new Error("banned");
    if (data.error === "rate_limited") throw new Error("rate_limited:" + (data.reason || "") + (data.retry_sec ? (":" + data.retry_sec) : ""));
    if (data.error) throw new Error("ai_failed:" + data.error + (data.detail ? (":" + data.detail) : ""));
    return data;
  }
  // 端末ごとの簡易ID（Catalogと同じトークン）。レート制限のキーに使う。
  function token() { try { return (window.Catalog && Catalog.owner) ? Catalog.owner() : ""; } catch (e) { return ""; } }
  // 管理者コード（端末に保存）。サーバーの ADMIN_CODE と一致するとレート制限が無制限になる。
  var ADMINKEY = "arcade.admincode";
  function adminCode() { try { return localStorage.getItem(ADMINKEY) || ""; } catch (e) { return ""; } }
  // 生成テストモデル（管理者のみ有効。サーバー側で admin 判定してから適用される）
  var TESTMODELKEY = "arcade.testmodel";
  function testModel() { try { return localStorage.getItem(TESTMODELKEY) || ""; } catch (e) { return ""; } }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ジョブの状態を1回確認（軽い・短いリクエスト）。生のJSONを返す（エラーで投げない）。
  async function pollOnce(jobId) {
    var url = fnUrl();
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 15000) : null;
    var raw;
    try {
      var res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg.supabaseKey, "Authorization": "Bearer " + cfg.supabaseKey },
        body: JSON.stringify({ job: jobId }),
        signal: ctrl ? ctrl.signal : undefined
      });
      raw = await res.text();
    } finally { if (timer) clearTimeout(timer); }
    try { return JSON.parse((raw || "").trim()); } catch (e) { return null; }
  }

  // 非同期生成：完成までポーリング。通信が一時的に切れても続行（サーバー側は生成し続ける）。
  // 待つ上限は、サーバーが返すジョブ全体の上限（limit 秒＝プランの壁時計から算出。
  // Free≒320秒 / 400秒プラン≒820秒）＋30秒。サーバーは1回目が時間切れになると新インスタンスへ
  // 引き継いで2回目を試すので、アプリが先に諦めると「2回目で完成しているのに失敗表示」になる。
  // limit を過ぎればサーバーが明示的に timeout を返すので、無限に待つことはない。
  // limit を返さない古いサーバー向けの既定は 900 秒。
  async function pollJob(jobId) {
    var start = Date.now(), limitMs = 900000, retrying = false;
    while (Date.now() - start < limitMs) {
      await sleep(2500);
      var d = null;
      try { d = await pollOnce(jobId); } catch (e) { d = null; }
      if (d && d.limit > 0) limitMs = (d.limit + 30) * 1000;
      // 途中経過に「引き継ぎ」が出たら＝1回目が時間切れで、2回目を作っている
      if (d && Array.isArray(d.diag) && d.diag.some(function (x) { return /handoff/.test(x); })) retrying = true;
      // 経過を画面へ知らせる（長く待たせる時に「止まっていない」ことを見せる用）
      try { window.dispatchEvent(new CustomEvent("vappa:genwait", { detail: { sec: Math.round((Date.now() - start) / 1000), limit: Math.round(limitMs / 1000), retrying: retrying } })); } catch (e) {}
      if (!d) continue;                       // 一時的な失敗 → 次のポーリングで再確認
      if (d.status === "pending") continue;
      if (d.status === "error") {
        if (d.error === "rate_limited") throw new Error("rate_limited:" + (d.reason || "") + (d.retry_sec ? (":" + d.retry_sec) : ""));
        if (d.error === "timeout") throw new Error("ai_failed:timeout");
        throw new Error("ai_failed:" + (d.error || "") + (d.detail ? (":" + d.detail) : ""));
      }
      if (d.status === "done") return d;       // {status:'done', action:'build', title, html, category, reply}
    }
    throw new Error("ai_failed:timeout");
  }

  return {
    available: function () { return !!(cfg.supabaseUrl && cfg.supabaseKey); },
    // 会話を送る（相談 or 生成）。prevHtml を渡すと既存ゲームの編集モード。
    // onBuild: 本生成が始まった（ジョブ受付）時に呼ぶコールバック（「生成中」表示用）。
    // force=true で「作り始める」＝サーバーで Opus ビルドを実行（生成カウント消費）。
    // force無し（相談ターン）は Haiku で ask / ready を返すだけ。
    // specText: ユーザーが確認・編集した設計書（新規ビルド時のみ。サーバーはこれを最優先で使う）
    send: function (messages, prevHtml, onBuild, force, specText) {
      return post({ messages: messages, prevHtml: prevHtml || "", token: token(), admin: adminCode(), build: !!force, model: testModel() || undefined, spec: specText || undefined }).then(function (data) {
        if (data && data.action === "job") {
          if (onBuild) { try { onBuild(data.job_id); } catch (e) {} }
          return pollJob(data.job_id);
        }
        return data;
      });
    },
    // 既存ジョブIDの完了を待つ（離脱→再起動後の復元用）
    resumeJob: function (jobId) { return pollJob(jobId); },
    // 設計書だけ作る（ビルド前の確認・編集用。生成カウントは消費しない）
    makeSpec: function (messages) { return post({ makeSpec: true, messages: messages, token: token(), admin: adminCode() }); },
    // 運営からのお知らせ（警告）を読んだ
    ack: function () { return post({ ack: true, token: token() }); },
    // 通報（作品ID・理由・詳細）。同じ人の2回目は数えない。
    report: function (gameId, reason, detail) { return post({ report: { game_id: gameId, reason: reason, detail: detail || "" }, token: token() }); },
    // 今日の作成上限の使用状況を取得（加算しない）。model を同送すると管理者は実効モデル名が返る
    usage: function () { return post({ usage: true, token: token(), admin: adminCode(), model: testModel() || undefined }); },
    // 管理者コードの取得/設定（設定画面から呼ぶ）
    getAdmin: function () { return adminCode(); },
    setAdmin: function (v) { try { localStorage.setItem(ADMINKEY, (v || "").trim()); } catch (e) {} },
    // 生成テストモデルの取得/設定（マイページの管理者用セレクタから呼ぶ）
    getTestModel: function () { return testModel(); },
    setTestModel: function (v) { try { localStorage.setItem(TESTMODELKEY, (v || "").trim()); } catch (e) {} },
    // 後方互換：一言からそのまま生成
    generate: async function (prompt, prevHtml) {
      var r = await post({ messages: [{ role: "user", content: prompt }], prevHtml: prevHtml || "", token: token(), admin: adminCode() });
      if (!r.html) throw new Error("generate_empty");
      return { title: r.title || "無題のゲーム", html: r.html };
    }
  };
})();
