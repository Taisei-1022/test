"""SerpApi 経由の Google Hotels ソース。

Google ホテルは Booking.com / Expedia / 楽天 / Agoda / じゃらん等の料金を
1画面に集約している。SerpApi はそれを構造化 JSON で返すので、
「複数サイトを横断的に、時間軸で定期チェック」という用途に一番合う。

必要な環境変数: SERPAPI_KEY   (https://serpapi.com 無料枠 250検索/月)
"""
from __future__ import annotations

import os
from typing import Optional

import requests

from .base import Quote, looks_like_same_hotel

ENDPOINT = "https://serpapi.com/search.json"
TIMEOUT = 30


def _extract_int(value) -> Optional[int]:
    """SerpApi の extracted_* は数値、lowest は "¥9,000" 形式のことがある。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return int(digits) if digits else None


def _best_from_property(prop: dict) -> Optional[Quote]:
    """1つのホテル(property)の中から最安のベンダーを選ぶ。"""
    hotel_name = prop.get("name", "")
    candidates = []  # (price, vendor, link)

    # 各販売サイトごとの価格（あれば最も詳しい情報）
    for p in prop.get("prices", []) or []:
        price = _extract_int(
            (p.get("rate_per_night") or {}).get("extracted_lowest")
            or (p.get("rate_per_night") or {}).get("lowest")
            or p.get("extracted_lowest")
        )
        if price:
            candidates.append((price, p.get("source", "不明"), p.get("link", "")))

    # ホテル全体の最安（ベンダー内訳が無い検索結果向けフォールバック）
    rpn = prop.get("rate_per_night") or {}
    overall = _extract_int(rpn.get("extracted_lowest") or rpn.get("lowest"))
    if overall:
        candidates.append((overall, "Google Hotels 最安", prop.get("link", "")))

    if not candidates:
        return None

    price, vendor, link = min(candidates, key=lambda c: c[0])
    return Quote(
        source="serpapi_google_hotels",
        price_jpy=price,
        vendor=vendor,
        link=link or prop.get("link", ""),
        hotel_name=hotel_name,
    )


def fetch(hotel: dict, checkin: str, checkout: str, locale: dict) -> Optional[Quote]:
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        return None  # キー未設定ならこのソースは静かにスキップ

    params = {
        "engine": "google_hotels",
        "api_key": api_key,
        "check_in_date": checkin,
        "check_out_date": checkout,
        "adults": str(hotel.get("adults", 1)),
        "currency": locale.get("currency", "JPY"),
        "gl": locale.get("gl", "jp"),
        "hl": locale.get("hl", "ja"),
    }

    token = hotel.get("property_token")
    if token:
        params["property_token"] = token
    else:
        params["q"] = hotel["name"]

    resp = requests.get(ENDPOINT, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()

    if data.get("error"):
        raise RuntimeError(f"SerpApi error: {data['error']}")

    # property_token 指定時はトップレベルが1ホテル分になる
    if token and (data.get("name") or data.get("prices") or data.get("rate_per_night")):
        return _best_from_property(data)

    # 検索時は properties[] から名前が最も一致するものを採用
    props = data.get("properties", []) or []
    if not props:
        return None

    matched = [p for p in props if looks_like_same_hotel(hotel["name"], p.get("name", ""))]
    target = matched[0] if matched else props[0]
    return _best_from_property(target)
