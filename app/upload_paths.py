"""点评配图：存于项目根 uploads/{user_id}/，URL 路径 /uploads/{user_id}/{filename}"""
from __future__ import annotations

import json
import re
from pathlib import Path

from app.database import ROOT

UPLOADS_ROOT = ROOT / "uploads"
# 配图 + 点评视频：均为 32 位 hex 文件名
SAFE_NAME = re.compile(
    r"^[a-f0-9]{32}\.(jpg|png|gif|webp|heic|mp4|webm|mov)$",
    re.IGNORECASE,
)


def uploads_url_dir(user_id: int) -> str:
    return f"/uploads/{user_id}"


def fs_path_for_url(url_path: str, owner_user_id: int) -> Path | None:
    """仅当 url 属于 owner 且文件名安全时返回磁盘路径。"""
    p = (url_path or "").strip()
    if not p.startswith("/uploads/"):
        return None
    parts = [x for x in p.split("/") if x]
    if len(parts) != 3 or parts[0] != "uploads":
        return None
    uid_s, fname = parts[1], parts[2]
    if uid_s != str(owner_user_id):
        return None
    if not SAFE_NAME.match(fname):
        return None
    return UPLOADS_ROOT / uid_s / fname


def _json_path_list(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x).strip() for x in data if str(x).strip()]
    except json.JSONDecodeError:
        pass
    return []


def parse_images_json(raw: str | None) -> list[str]:
    return _json_path_list(raw)


def parse_videos_json(raw: str | None) -> list[str]:
    return _json_path_list(raw)


def delete_files_for_paths(paths: list[str], owner_user_id: int) -> None:
    for url_p in paths:
        loc = fs_path_for_url(url_p, owner_user_id)
        if loc and loc.is_file():
            try:
                loc.unlink()
            except OSError:
                pass
