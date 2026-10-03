# 読み物ページ（作り方ガイド・よくある質問・投稿ガイドライン）を共通の枠で書き出す。
# 本文は pages/*.html（中身だけ）に書き、このスクリプトで arcade/ 直下に完成ページを作る。
#   python3 arcade/tools/build-pages.py
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "pages")
PAGES = [
    ("guide", "作り方ガイド", "AIと話してミニゲームを作る手順、設計書の書き方、ゲームを面白くする「盛り要素」の入れ方、Vappaの仕組みまでをまとめたガイドです。"),
    ("faq", "よくある質問", "Vappaの遊び方・作り方・ログイン・ランキング・安全性など、よくいただく質問への回答です。"),
    ("guidelines", "投稿ガイドライン", "Vappaに作品を公開するときのルールと、通報の仕組み、違反があった場合の対応についてのガイドラインです。"),
]
HEAD = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#141221" />
<title>{title}｜Vappa</title>
<meta name="description" content="{desc}" />
<link rel="canonical" href="https://vappa.app/arcade/{slug}.html" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6804943232069371" crossorigin="anonymous"></script>
<style>
  :root{{ --bg:#141221; --card:#1d1a2e; --line:#2c2740; --fg:#f1eefb; --sub:#9a93b5; --accent:#8b5cf6; }}
  *{{box-sizing:border-box;}}
  body{{margin:0;background:var(--bg);color:var(--fg);
    font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans",system-ui,sans-serif;
    line-height:1.85;-webkit-text-size-adjust:100%;}}
  .wrap{{max-width:680px;margin:0 auto;padding:18px 18px 60px;}}
  .bar{{display:flex;align-items:center;gap:10px;padding:6px 0 14px;}}
  .back{{font-size:26px;line-height:1;color:var(--fg);text-decoration:none;padding:2px 8px;border-radius:10px;}}
  .back:active{{background:var(--card);}}
  h1{{font-size:22px;margin:4px 0 2px;}}
  .lead{{color:var(--sub);font-size:13px;margin:0 0 18px;}}
  h2{{font-size:17px;margin:30px 0 8px;padding-top:14px;border-top:1px solid var(--line);}}
  h3{{font-size:15px;margin:20px 0 6px;color:#e9e2ff;}}
  p,li,dd{{font-size:14px;color:#e7e3f5;}}
  ul,ol{{padding-left:1.3em;margin:8px 0;}}
  li{{margin:5px 0;}}
  a{{color:#cdbcff;}}
  .toc{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 16px;margin:0 0 10px;font-size:13.5px;}}
  .toc ol{{margin:4px 0;}}
  .note{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:13.5px;color:#d9d3ec;margin:12px 0;}}
  .ex{{background:#0f0d18;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.8;white-space:pre-wrap;color:#e7e3f5;margin:10px 0;}}
  .ok{{color:#34d399;font-weight:700;}} .ng{{color:#f87171;font-weight:700;}}
  dl{{margin:8px 0;}} dt{{font-weight:700;font-size:14.5px;margin-top:18px;color:#fff;}}
  dt::before{{content:"Q. ";color:var(--accent);}}
  dd{{margin:4px 0 0;padding-left:1.6em;text-indent:-1.6em;}} dd::before{{content:"A. ";color:#34d399;font-weight:700;}}
  table{{width:100%;border-collapse:collapse;margin:10px 0;}}
  th,td{{font-size:13.5px;text-align:left;padding:8px 10px;border:1px solid var(--line);vertical-align:top;}}
  th{{background:var(--card);color:var(--sub);font-weight:600;}}
  .tbl{{overflow-x:auto;}}
  .upd{{color:var(--sub);font-size:12px;margin-top:30px;}}
  .links{{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);font-size:13px;line-height:2.2;}}
  .links a{{margin-right:14px;}}
</style>
</head>
<body>
<div class="wrap">
  <div class="bar">
    <a class="back" href="index.html" aria-label="戻る">‹</a>
    <span style="color:var(--sub);font-size:13px;">Vappa</span>
  </div>
"""
FOOT = """
  <p class="upd">最終更新：{upd}</p>
  <div class="links">
    <a href="index.html">ホーム</a>
    <a href="guide.html">作り方ガイド</a>
    <a href="faq.html">よくある質問</a>
    <a href="guidelines.html">投稿ガイドライン</a>
    <a href="about.html">運営者情報</a>
    <a href="terms.html">利用規約</a>
    <a href="privacy.html">プライバシーポリシー</a>
    <a href="contact.html">お問い合わせ</a>
  </div>
</div>
</body>
</html>
"""
UPD = "2026年10月3日"
for slug, title, desc in PAGES:
    body = open(os.path.join(SRC, slug + ".html"), encoding="utf-8").read()
    html = HEAD.format(title=title, desc=desc, slug=slug) + body + FOOT.format(upd=UPD)
    open(os.path.join(ROOT, slug + ".html"), "w", encoding="utf-8").write(html)
    text = re.sub(r"<[^>]+>", "", body)
    print(slug, "本文", len(re.sub(r"\s+", "", text)), "字")
