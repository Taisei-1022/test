#!/usr/bin/env python3
"""ホテル価格ウォッチャー 本体。

設定ファイルの各ホテル × 各宿泊日について、有効なソースから価格を取得し、
・履歴を data/history.jsonl に追記（時間軸の記録）
・閾値以下になったら Slack に通知（再通知はクールダウンで抑制）
する。

使い方:
    python watch.py                # 通常実行
    python watch.py --dry-run      # 取得だけ。履歴もSlackも触らない（動作確認用）
    python watch.py --config path/to/config.yaml
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import REGISTRY, Quote  # noqa: E402
from notify import slack  # noqa: E402

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
HISTORY_FILE = DATA_DIR / "history.jsonl"
STATE_FILE = DATA_DIR / "state.json"

WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
# 通知の再送・状態記録は JST 基準（利用者は日本在住のため）
JST = timezone(timedelta(hours=9))


# ----------------------------------------------------------------------
# 宿泊日の展開
# ----------------------------------------------------------------------
def _fmt(d) -> str:
    return d.strftime("%Y-%m-%d")


def build_date_ranges(dates_cfg: dict, today) -> list[tuple[str, str]]:
    """設定に従って (checkin, checkout) のリストを作る。"""
    mode = dates_cfg.get("mode", "weekly")
    ranges: list[tuple[str, str]] = []

    if mode == "weekly":
        cfg = dates_cfg.get("weekly", {})
        target_wd = WEEKDAYS.get(str(cfg.get("weekday", "fri")).lower(), 4)
        nights = int(cfg.get("nights", 1))
        weeks_ahead = int(cfg.get("weeks_ahead", 6))
        # 次に来る対象曜日を求める（今日が対象曜日なら今日を含む）
        delta = (target_wd - today.weekday()) % 7
        first = today + timedelta(days=delta)
        for w in range(weeks_ahead):
            checkin = first + timedelta(weeks=w)
            checkout = checkin + timedelta(days=nights)
            ranges.append((_fmt(checkin), _fmt(checkout)))

    elif mode == "rolling":
        cfg = dates_cfg.get("rolling", {})
        start = int(cfg.get("start_offset_days", 1))
        span = int(cfg.get("span_days", 30))
        nights = int(cfg.get("nights", 1))
        for offset in range(start, start + span):
            checkin = today + timedelta(days=offset)
            checkout = checkin + timedelta(days=nights)
            ranges.append((_fmt(checkin), _fmt(checkout)))

    elif mode == "fixed":
        for item in dates_cfg.get("fixed", []) or []:
            raw = item["checkin"]
            # YAML は 2026-08-14 を date に、"2026-08-14" を str に変換しうる
            if isinstance(raw, str):
                checkin = datetime.strptime(raw, "%Y-%m-%d").date()
            else:
                checkin = raw  # datetime.date
            checkout = checkin + timedelta(days=int(item.get("nights", 1)))
            ranges.append((_fmt(checkin), _fmt(checkout)))

    else:
        raise ValueError(f"未知の dates.mode: {mode}")

    return ranges


# ----------------------------------------------------------------------
# 履歴・状態の入出力
# ----------------------------------------------------------------------
def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def append_history(record: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with HISTORY_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def historical_min(hotel_id: str, checkin: str) -> Optional[int]:
    """過去の履歴からこのホテル・この宿泊日の最安を返す。"""
    if not HISTORY_FILE.exists():
        return None
    best = None
    with HISTORY_FILE.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("hotel_id") == hotel_id and rec.get("checkin") == checkin:
                p = rec.get("price_jpy")
                if p is not None and (best is None or p < best):
                    best = p
    return best


# ----------------------------------------------------------------------
# 価格取得
# ----------------------------------------------------------------------
def cheapest_quote(hotel: dict, checkin: str, checkout: str,
                   source_names: list[str], locale: dict) -> Optional[Quote]:
    """有効な全ソースに問い合わせ、最安の Quote を返す。"""
    best: Optional[Quote] = None
    for name in source_names:
        fetch = REGISTRY.get(name)
        if fetch is None:
            print(f"  [warn] 未知のソース: {name}")
            continue
        try:
            q = fetch(hotel, checkin, checkout, locale)
        except Exception as e:  # 1ソースの失敗で全体を止めない
            print(f"  [warn] {name} 取得失敗: {e}")
            continue
        if q is None:
            continue
        print(f"    - {name}: ¥{q.price_jpy:,} ({q.vendor})")
        if best is None or q.price_jpy < best.price_jpy:
            best = q
    return best


# ----------------------------------------------------------------------
# メイン
# ----------------------------------------------------------------------
def run(config_path: Path, dry_run: bool) -> int:
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    locale = cfg.get("locale", {})
    source_names = cfg.get("sources", ["serpapi_google_hotels"])
    alerts_cfg = cfg.get("alerts", {})
    renotify_h = float(alerts_cfg.get("renotify_after_hours", 24))
    only_on_new_low = bool(alerts_cfg.get("only_on_new_low", False))

    now = datetime.now(JST)
    today = now.date()
    ranges = build_date_ranges(cfg.get("dates", {}), today)

    print(f"== ホテル価格ウォッチャー {now.isoformat(timespec='minutes')} (JST) ==")
    print(f"ソース: {', '.join(source_names)} / 宿泊日 {len(ranges)}件 / dry_run={dry_run}")

    state = load_state()
    alerts_sent = 0

    for hotel in cfg.get("hotels", []):
        hid = hotel["id"]
        threshold = int(hotel["threshold_jpy"])
        print(f"\n[{hid}] {hotel['name']}  (閾値 ¥{threshold:,})")

        for checkin, checkout in ranges:
            print(f"  {checkin}〜{checkout}")
            q = cheapest_quote(hotel, checkin, checkout, source_names, locale)
            if q is None:
                print("    (在庫/価格が取得できず)")
                continue

            prev_min = historical_min(hid, checkin)

            if not dry_run:
                append_history({
                    "ts": now.isoformat(timespec="seconds"),
                    "hotel_id": hid,
                    "hotel_name": hotel["name"],
                    "checkin": checkin,
                    "checkout": checkout,
                    "price_jpy": q.price_jpy,
                    "vendor": q.vendor,
                    "source": q.source,
                    "link": q.link,
                })

            # --- 通知判定 -------------------------------------------------
            if q.price_jpy > threshold:
                continue  # 閾値超えは通知しない

            if only_on_new_low and prev_min is not None and q.price_jpy >= prev_min:
                print(f"    閾値以下だが過去最安({prev_min})を更新せず → 通知見送り")
                continue

            key = f"{hid}|{checkin}"
            st = state.get(key, {})
            last_price = st.get("last_alert_price")
            last_ts = st.get("last_alert_ts")

            cooled_down = True
            if last_ts:
                try:
                    elapsed = (now - datetime.fromisoformat(last_ts)).total_seconds() / 3600.0
                    cooled_down = elapsed >= renotify_h
                except ValueError:
                    cooled_down = True

            price_dropped = last_price is None or q.price_jpy < last_price
            if not (cooled_down or price_dropped):
                print("    閾値以下だがクールダウン中 → 通知見送り")
                continue

            print(f"    🔔 閾値以下！ ¥{q.price_jpy:,} ({q.vendor}) を通知")
            if not dry_run:
                sent = slack.send_alert(
                    hotel_name=q.hotel_name or hotel["name"],
                    checkin=checkin, checkout=checkout,
                    price=q.price_jpy, threshold=threshold,
                    vendor=q.vendor, link=q.link,
                    prev_price=last_price,
                )
                if sent:
                    alerts_sent += 1
                    state[key] = {
                        "last_alert_price": q.price_jpy,
                        "last_alert_ts": now.isoformat(timespec="seconds"),
                    }

    if not dry_run:
        save_state(state)

    print(f"\n完了。通知 {alerts_sent} 件。")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="ホテル価格ウォッチャー")
    ap.add_argument("--config", default=str(ROOT / "config.yaml"))
    ap.add_argument("--dry-run", action="store_true",
                    help="取得だけ行い、履歴・Slack・状態を書き換えない")
    args = ap.parse_args()
    return run(Path(args.config), args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
