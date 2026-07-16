"""楽天トラベル空室検索API ソース（楽天のみ・完全無料）。

SerpApi のキーを用意しなくてもこのソースだけで動く。楽天をよく使う人向けの
無料の下支え。必要な環境変数: RAKUTEN_APP_ID
  (https://webservice.rakuten.co.jp/ でアプリ登録すると発行される applicationId)

API: 楽天トラベル空室検索API version 2017-04-26
  https://webservice.rakuten.co.jp/documentation/vacant-hotel-search
"""
from __future__ import annotations

import os
from typing import Optional

import requests

from .base import Quote, looks_like_same_hotel

ENDPOINT = "https://app.rakuten.co.jp/services/api/Travel/VacantHotelSearch/20170426"
TIMEOUT = 30


def _min_charge(hotel_entry: dict) -> Optional[int]:
    """1ホテル分のレスポンスから最安料金を拾う。"""
    prices = []
    for block in hotel_entry.get("hotel", []):
        basic = block.get("hotelBasicInfo")
        if basic and basic.get("hotelMinCharge"):
            prices.append(int(basic["hotelMinCharge"]))
        room = block.get("roomInfo")
        if room:
            for r in room:
                charge = (r.get("dailyCharge") or {}).get("total")
                if charge:
                    prices.append(int(charge))
    return min(prices) if prices else None


def _basic_info(hotel_entry: dict) -> dict:
    for block in hotel_entry.get("hotel", []):
        if block.get("hotelBasicInfo"):
            return block["hotelBasicInfo"]
    return {}


def fetch(hotel: dict, checkin: str, checkout: str, locale: dict) -> Optional[Quote]:
    app_id = os.environ.get("RAKUTEN_APP_ID")
    if not app_id:
        return None  # 未設定なら静かにスキップ

    params = {
        "applicationId": app_id,
        "format": "json",
        "keyword": hotel["name"],
        # 楽天は YYYY-MM-DD を受け付ける
        "checkinDate": checkin,
        "checkoutDate": checkout,
        "adultNum": hotel.get("adults", 1),
        "responseType": "small",
        "hits": 5,
    }

    resp = requests.get(ENDPOINT, params=params, timeout=TIMEOUT)
    # キーワードでヒット0件のとき楽天は 404 を返すことがある → 在庫なし扱い
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json()

    if data.get("error"):
        # not_found 系はスキップ、それ以外は例外
        if data.get("error") in ("not_found", "wrong_parameter"):
            return None
        raise RuntimeError(f"Rakuten error: {data.get('error')} {data.get('error_description')}")

    entries = data.get("hotels", []) or []
    if not entries:
        return None

    # 名前が一致するホテルを優先
    best = None
    for entry in entries:
        info = _basic_info(entry)
        name = info.get("hotelName", "")
        if not looks_like_same_hotel(hotel["name"], name):
            continue
        price = _min_charge(entry)
        if price is None:
            continue
        if best is None or price < best.price_jpy:
            best = Quote(
                source="rakuten",
                price_jpy=price,
                vendor="楽天トラベル",
                link=info.get("hotelInformationUrl", ""),
                hotel_name=name,
            )
    return best
