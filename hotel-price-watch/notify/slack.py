"""Slack Incoming Webhook への通知。

必要な環境変数: SLACK_WEBHOOK_URL
  (Slack で Incoming Webhook を作成して発行される https://hooks.slack.com/... のURL)
"""
from __future__ import annotations

import os
from typing import Optional

import requests

TIMEOUT = 20


def _fmt_yen(n: int) -> str:
    return f"¥{n:,}"


def send_alert(*, hotel_name: str, checkin: str, checkout: str,
               price: int, threshold: int, vendor: str, link: str,
               prev_price: Optional[int] = None) -> bool:
    """安値アラートを Slack に送る。送れたら True。"""
    url = os.environ.get("SLACK_WEBHOOK_URL")
    if not url:
        print("  [slack] SLACK_WEBHOOK_URL 未設定のため通知をスキップ")
        return False

    diff_line = ""
    if prev_price and prev_price > price:
        diff_line = f"　（前回 {_fmt_yen(prev_price)} → {_fmt_yen(price)}　▼{_fmt_yen(prev_price - price)}）"

    headline = f"🏨 *{hotel_name}* が安くなりました  {_fmt_yen(price)}{diff_line}"
    details = (
        f"*宿泊日*: {checkin} 〜 {checkout}\n"
        f"*最安*: {_fmt_yen(price)}（閾値 {_fmt_yen(threshold)} 以下）\n"
        f"*販売サイト*: {vendor}"
    )

    blocks = [
        {"type": "section", "text": {"type": "mrkdwn", "text": headline}},
        {"type": "section", "text": {"type": "mrkdwn", "text": details}},
    ]
    if link:
        blocks.append({
            "type": "actions",
            "elements": [{
                "type": "button",
                "text": {"type": "plain_text", "text": "予約ページを開く"},
                "url": link,
            }],
        })

    payload = {"text": f"{hotel_name} が {_fmt_yen(price)} に（{checkin}）", "blocks": blocks}
    resp = requests.post(url, json=payload, timeout=TIMEOUT)
    resp.raise_for_status()
    return True
