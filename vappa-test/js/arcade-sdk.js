/* Arcade SDK（ゲーム側に読み込ませる薄い殻）
   - 殻(プラットフォーム)のiframe内で動くときだけ親へ postMessage
   - 単体(直接ブラウザ)で開いたときは no-op になり、ゲームはそのまま動く     */
(function () {
  "use strict";
  var inFrame = window.parent && window.parent !== window;
  var handlers = {};

  function send(call, payload) {
    if (inFrame) window.parent.postMessage({ __arcade: true, call: call, payload: payload || {} }, "*");
  }

  window.Arcade = {
    version: 1,
    ready: function () { send("ready"); },
    submitScore: function (score) { send("submitScore", { score: score }); },
    gameOver: function (score) { send("gameOver", { score: score }); },
    event: function (name, data) { send("event", { name: name, data: data }); },
    onPause: function (fn) { handlers.pause = fn; },
    onResume: function (fn) { handlers.resume = fn; },
    onRestart: function (fn) { handlers.restart = fn; }
  };

  // 殻 → ゲーム の制御
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || !d.__arcadeCtl) return;
    if (d.call === "pause" && handlers.pause) handlers.pause();
    if (d.call === "resume" && handlers.resume) handlers.resume();
    if (d.call === "restart" && handlers.restart) handlers.restart();
  });
})();
