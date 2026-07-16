"""価格取得ソース（プラガブル）。

各ソースは `fetch(hotel, checkin, checkout, locale)` を実装し、
`Quote` を返す（取得できなければ None）。新しいサイトを足したいときは
ここに関数を1つ追加して REGISTRY に登録するだけ。
"""
from .base import Quote
from . import serpapi_hotels, rakuten

# 設定ファイルの名前 -> fetch 関数
REGISTRY = {
    "serpapi_google_hotels": serpapi_hotels.fetch,
    "rakuten": rakuten.fetch,
}

__all__ = ["Quote", "REGISTRY"]
