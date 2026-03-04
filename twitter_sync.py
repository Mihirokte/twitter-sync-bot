"""
Twitter likes → Google Sheets sync.

Supports two modes:
- Local: config.json + cookies.json (or TWITTER_COOKIES_FILE) + GOOGLE_SERVICE_ACCOUNT_FILE + GOOGLE_SHEETS_SPREADSHEET_ID
- GitHub Actions: all config from env (see .github/workflows/sync.yml).
"""
import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from twikit import Client


BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.json"
COOKIES_FILE = Path(os.getenv("TWITTER_COOKIES_FILE", str(BASE_DIR / "cookies.json"))).expanduser()


@dataclass
class Config:
    twitter_handle: str
    sheet_id: str
    sheet_name: str
    max_likes: int = 100


def load_config() -> Config:
    """Load from config.json (local) or from env (GitHub Actions)."""
    if os.getenv("GITHUB_ACTIONS") or os.getenv("CI"):
        return Config(
            twitter_handle=os.environ["TWITTER_HANDLE"],
            sheet_id=os.environ["SPREADSHEET_ID"],
            sheet_name=os.environ.get("SHEET_NAME") or "TwitterLikes",
            max_likes=int(os.environ.get("MAX_LIKES") or "100"),
        )
    if not CONFIG_FILE.exists():
        raise RuntimeError("Missing config.json. Copy config.example.json -> config.json and edit.")
    data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    return Config(
        twitter_handle=data["twitter_handle"],
        sheet_id=data["sheet_id"],
        sheet_name=data.get("sheet_name", "TwitterLikes"),
        max_likes=int(data.get("max_likes", 100)),
    )


def get_twitter_client() -> Client:
    """Create twikit client from cookies file or from TWITTER_COOKIES_JSON (Actions)."""
    cookies_json = os.getenv("TWITTER_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
    elif COOKIES_FILE.exists():
        cookies = json.loads(COOKIES_FILE.read_text(encoding="utf-8"))
    else:
        raise RuntimeError(
            "No cookies: set TWITTER_COOKIES_JSON (env) or create cookies.json with auth_token + ct0."
        )
    client = Client("en-US")
    client.set_cookies(cookies)
    return client


def get_sheets_service():
    """Build Sheets API service from file (local) or from GOOGLE_SERVICE_ACCOUNT_JSON (Actions)."""
    sheet_id = os.getenv("SPREADSHEET_ID") or os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID")
    sa_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    sa_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")

    if not sheet_id:
        raise RuntimeError("SPREADSHEET_ID or GOOGLE_SHEETS_SPREADSHEET_ID must be set.")

    if sa_json:
        info = json.loads(sa_json)
        creds = Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    elif sa_path:
        creds = Credentials.from_service_account_file(
            Path(sa_path).expanduser(), scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
    else:
        raise RuntimeError(
            "Set GOOGLE_SERVICE_ACCOUNT_JSON (env) or GOOGLE_SERVICE_ACCOUNT_FILE (path to JSON key)."
        )

    service = build("sheets", "v4", credentials=creds)
    return service, sheet_id


async def fetch_likes(config: Config) -> List[Dict[str, Any]]:
    client = get_twitter_client()
    user = await client.get_user_by_screen_name(config.twitter_handle)
    likes = await client.get_user_tweets(user.id, "Likes", count=config.max_likes)

    results: List[Dict[str, Any]] = []
    for t in likes:
        handle = f"@{t.user.screen_name}" if getattr(t, "user", None) else ""
        url = f"https://x.com/{t.user.screen_name}/status/{t.id}" if getattr(t, "user", None) else ""
        results.append(
            {
                "tweetId": str(t.id),
                "author": getattr(t.user, "name", "") if getattr(t, "user", None) else "",
                "authorHandle": handle,
                "content": getattr(t, "text", "") or "",
                "tweetUrl": url,
                "likes": str(getattr(t, "favorite_count", 0) or 0),
                "retweets": str(getattr(t, "retweet_count", 0) or 0),
            }
        )
    return results


def read_existing_ids(service, sheet_id: str, sheet_name: str) -> set:
    range_ = f"{sheet_name}!A2:A"
    try:
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=range_)
            .execute()
        )
    except Exception:
        return set()
    values = resp.get("values", [])
    return {row[0] for row in values if row}


def ensure_header(service, sheet_id: str, sheet_name: str) -> None:
    """Ensure the sheet has a header row (idempotent)."""
    range_ = f"{sheet_name}!A1:H1"
    try:
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=range_)
            .execute()
        )
        if resp.get("values"):
            return
    except Exception:
        pass
    body = {
        "values": [
            ["tweetId", "author", "authorHandle", "content", "tweetUrl", "likes", "retweets", "action"],
        ]
    }
    service.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f"{sheet_name}!A1",
        valueInputOption="RAW",
        body=body,
    ).execute()


def append_rows(service, sheet_id: str, sheet_name: str, rows: List[List[Any]]) -> None:
    if not rows:
        return
    ensure_header(service, sheet_id, sheet_name)
    body = {"values": rows}
    service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range=f"{sheet_name}!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body=body,
    ).execute()


def sync_likes() -> int:
    """Fetch recent likes and append new ones to Google Sheets. Returns count of new rows."""
    config = load_config()
    service, sheet_id = get_sheets_service()
    existing_ids = read_existing_ids(service, sheet_id, config.sheet_name)
    tweets = asyncio.run(fetch_likes(config))

    rows: List[List[Any]] = []
    for t in tweets:
        if t["tweetId"] in existing_ids:
            continue
        rows.append(
            [
                t["tweetId"],
                t["author"],
                t["authorHandle"],
                t["content"],
                t["tweetUrl"],
                t["likes"],
                t["retweets"],
                "synced",
            ]
        )
    if rows:
        append_rows(service, sheet_id, config.sheet_name, rows)
    return len(rows)


if __name__ == "__main__":
    count = sync_likes()
    print(f"Synced {count} new liked tweets to Sheets.")
