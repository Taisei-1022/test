"""ソース共通の型とユーティリティ。"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional


@dataclass
class Quote:
    """あるホテル・ある宿泊日の、あるサイトでの見積り。"""
    source: str          # 取得元ソース名 (例: "serpapi_google_hotels")
    price_jpy: int       # 1泊あたりの最安価格（税・サービス料込みの表示額）
    vendor: str          # 実際に販売しているサイト名 (例: "Booking.com", "楽天トラベル")
    link: str            # 予約/詳細ページへのURL
    hotel_name: str = "" # 実際にヒットしたホテル名（照合確認用）

    def to_dict(self) -> dict:
        return asdict(self)


def normalize(text: str) -> str:
    """ホテル名照合用のゆるい正規化。空白・記号を除去して比較する。"""
    if not text:
        return ""
    out = []
    for ch in text:
        if ch.isalnum():
            out.append(ch.lower())
    return "".join(out)


def looks_like_same_hotel(query: str, candidate: str) -> bool:
    """検索名と候補名がだいたい同じホテルを指しているかのゆるい判定。"""
    q = normalize(query)
    c = normalize(candidate)
    if not q or not c:
        return False
    return q in c or c in q
