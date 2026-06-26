/* 共通の素材・カテゴリ定義
   - ARCADE_CATEGORIES: ゲームのカテゴリ一覧（生成時の設定・遊ぶ画面のフィルタで共通利用）
   - ARCADE_EMOJI: 相談チャットで選べる絵文字素材（約20個）。
     生成ゲームはネット遮断のサンドボックスで動くため画像は使えないが、
     絵文字なら canvas の fillText でそのまま「まともな見た目」のキャラとして描ける。
     ※ Edge Function 側(generate)にも同じパレットを記載してAIへ渡している。 */
window.ARCADE_CATEGORIES = [
  "アクション", "パズル", "シューティング", "反射神経",
  "よける", "タイミング", "記憶", "レース", "その他"
];

window.ARCADE_EMOJI = [
  // 動物・キャラ
  { e: "🐱", name: "ねこ", group: "キャラ" },
  { e: "🐶", name: "いぬ", group: "キャラ" },
  { e: "🐸", name: "かえる", group: "キャラ" },
  { e: "🐤", name: "ひよこ", group: "キャラ" },
  { e: "🦊", name: "きつね", group: "キャラ" },
  { e: "🐙", name: "たこ", group: "キャラ" },
  { e: "🐢", name: "かめ", group: "キャラ" },
  { e: "🐝", name: "はち", group: "キャラ" },
  // たべもの
  { e: "🍣", name: "すし", group: "たべもの" },
  { e: "🍎", name: "りんご", group: "たべもの" },
  { e: "🍩", name: "ドーナツ", group: "たべもの" },
  { e: "🍄", name: "きのこ", group: "たべもの" },
  // アイテム・効果
  { e: "⭐", name: "スター", group: "アイテム" },
  { e: "💎", name: "ジェム", group: "アイテム" },
  { e: "🪙", name: "コイン", group: "アイテム" },
  { e: "🔥", name: "ほのお", group: "アイテム" },
  { e: "⚡", name: "いなずま", group: "アイテム" },
  { e: "💣", name: "ばくだん", group: "アイテム" },
  // のりもの
  { e: "🚀", name: "ロケット", group: "のりもの" },
  { e: "⚽", name: "ボール", group: "のりもの" }
];
