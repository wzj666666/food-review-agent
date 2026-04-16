"""
基于 LangChain Agent + 高德 Web 服务。

- 模型：OpenAI 兼容接口（app.config.settings，默认本机 8020）。
- v3：地理编码 / 逆地理 / POI / 输入提示 / 天气 / IP / 行政区。
- 路径规划 2.0（v5）：驾车、步行、骑行、电动车、公交地铁。
- 需配置 **AMAP_KEY**；调试打印设 **DEBUG_AMAP_AGENT=1**（见 settings.debug_amap_agent）。
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import pprint
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx
from langchain.agents import create_agent
from sqlalchemy.orm import joinedload
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from app.config import settings
from app.database import SessionLocal
from app.logger import logger
from app.models import Review

# 参谋 SSE 执行 DB 工具时注入当前登录用户 id，避免模型传入他人 user_id 越权查询
advisor_auth_user_id: contextvars.ContextVar[int | None] = contextvars.ContextVar("advisor_auth_user_id", default=None)

AMAP_V3 = "https://restapi.amap.com/v3"
AMAP_V5 = "https://restapi.amap.com/v5"
_MAX_JSON = 18_000


def _truncate_json(data: Any) -> str:
    s = json.dumps(data, ensure_ascii=False)
    if len(s) > _MAX_JSON:
        return s[:_MAX_JSON] + "…[已截断]"
    return s


def _amap_key() -> str | None:
    k = (settings.amap_key or "").strip()
    return k or None


def _amap_get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    key = _amap_key()
    if not key:
        return {"status": "0", "info": "未配置 AMAP_KEY，请在环境变量中设置高德 Web 服务 Key"}
    q = {k: v for k, v in params.items() if v is not None and v != ""}
    q["key"] = key
    q["output"] = "json"
    url = f"{AMAP_V3}/{path.lstrip('/')}"
    with httpx.Client(timeout=25.0) as client:
        r = client.get(url, params=q)
        r.raise_for_status()
        return r.json()


def _amap_v5_get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    """路径规划 2.0（v5），成功时 status 为字符串 \"1\"。"""
    key = _amap_key()
    if not key:
        return {"status": "0", "info": "未配置 AMAP_KEY，请在环境变量中设置高德 Web 服务 Key"}
    q = {k: v for k, v in params.items() if v is not None and v != ""}
    q["key"] = key
    q["output"] = "json"
    url = f"{AMAP_V5}/{path.lstrip('/')}"
    with httpx.Client(timeout=25.0) as client:
        r = client.get(url, params=q)
        r.raise_for_status()
        return r.json()


@tool
def amap_geocode_geo(address: str, city: str = "") -> str:
    """地理编码：将地址文字转为经纬度（location 为 经度,纬度）。如 address=酒仙桥 city=北京。"""
    data = _amap_get("geocode/geo", {"address": address, "city": city or None})
    return _truncate_json(data)


@tool
def amap_geocode_regeo(
    location: str,
    radius: int = 1000,
    extensions: str = "all",
) -> str:
    """逆地理编码：经纬度转结构化地址与附近 POI（extensions=all 时返回 pois）。"""
    data = _amap_get(
        "geocode/regeo",
        {"location": location, "radius": radius, "extensions": extensions},
    )
    return _truncate_json(data)


@tool
def amap_place_text(
    keywords: str,
    city: str = "",
    citylimit: bool = True,
    types: str = "",
    page: int = 1,
    offset: int = 20,
) -> str:
    """关键字搜索 POI（餐饮、景点等）。适合「绿茶餐厅（酒仙桥店）」类查询。"""
    data = _amap_get(
        "place/text",
        {
            "keywords": keywords,
            "city": city or None,
            "citylimit": "true" if citylimit and city else "false",
            "types": types or None,
            "page": page,
            "offset": min(offset, 25),
            "extensions": "all",
        },
    )
    return _truncate_json(data)


@tool
def amap_place_around(
    location: str,
    keywords: str = "美食",
    radius: int = 2000,
    types: str = "",
    page: int = 1,
    offset: int = 10,
) -> str:
    """周边搜索 POI。已知坐标后查「附近美食」用本工具。"""
    data = _amap_get(
        "place/around",
        {
            "location": location,
            "keywords": keywords or None,
            "radius": min(radius, 50_000),
            "types": types or None,
            "page": page,
            "offset": min(offset, 25),
            "extensions": "all",
        },
    )
    return _truncate_json(data)


@tool
def amap_input_tips(
    keywords: str,
    city: str = "",
    datatype: str = "all",
) -> str:
    """输入提示：联想地点与关键词，辅助用户补全地名或 POI。"""
    data = _amap_get(
        "assistant/inputtips",
        {"keywords": keywords, "city": city or None, "datatype": datatype},
    )
    return _truncate_json(data)


@tool
def amap_weather(city: str) -> str:
    """查询城市天气（实况与预报需 extensions=all）。"""
    data = _amap_get("weather/weatherInfo", {"city": city, "extensions": "all"})
    return _truncate_json(data)


@tool
def amap_ip_location(ip: str = "") -> str:
    """IP 定位：根据 IP 返回大致城市与矩形区域。"""
    data = _amap_get("ip", {"ip": ip or None})
    return _truncate_json(data)


@tool
def amap_route_driving(
    origin: str,
    destination: str,
    strategy: int | None = None,
    waypoints: str = "",
    plate: str = "",
    cartype: int | None = None,
    ferry: int | None = None,
    show_fields: str = "",
) -> str:
    """路径规划 2.0·驾车：origin/destination 为「经度,纬度」。可选 strategy、waypoints、plate、cartype、ferry、show_fields。"""
    data = _amap_v5_get(
        "direction/driving",
        {
            "origin": origin,
            "destination": destination,
            "strategy": strategy,
            "waypoints": waypoints or None,
            "plate": plate or None,
            "cartype": cartype,
            "ferry": ferry,
            "show_fields": show_fields or None,
        },
    )
    return _truncate_json(data)


@tool
def amap_route_walking(
    origin: str,
    destination: str,
    alternative_route: int | None = None,
    isindoor: int = 0,
    show_fields: str = "",
) -> str:
    """路径规划 2.0·步行：起终点「经度,纬度」。可选 alternative_route、isindoor、show_fields。"""
    data = _amap_v5_get(
        "direction/walking",
        {
            "origin": origin,
            "destination": destination,
            "alternative_route": alternative_route,
            "isindoor": isindoor,
            "show_fields": show_fields or None,
        },
    )
    return _truncate_json(data)


@tool
def amap_route_bicycling(
    origin: str,
    destination: str,
    alternative_route: int | None = None,
    show_fields: str = "",
) -> str:
    """路径规划 2.0·骑行（自行车）：起终点「经度,纬度」。"""
    data = _amap_v5_get(
        "direction/bicycling",
        {
            "origin": origin,
            "destination": destination,
            "alternative_route": alternative_route,
            "show_fields": show_fields or None,
        },
    )
    return _truncate_json(data)


@tool
def amap_route_electrobike(
    origin: str,
    destination: str,
    alternative_route: int | None = None,
    show_fields: str = "",
) -> str:
    """路径规划 2.0·电动车：起终点「经度,纬度」；算路会考虑限行等。"""
    data = _amap_v5_get(
        "direction/electrobike",
        {
            "origin": origin,
            "destination": destination,
            "alternative_route": alternative_route,
            "show_fields": show_fields or None,
        },
    )
    return _truncate_json(data)


@tool
def amap_route_transit(
    origin: str,
    destination: str,
    city1: str,
    city2: str = "",
    strategy: int = 0,
    nightflag: int = 0,
    alternative_route: int | None = None,
    multiexport: int = 0,
    originpoi: str = "",
    destinationpoi: str = "",
    show_fields: str = "",
) -> str:
    """路径规划 2.0·公交/地铁：city1、city2 为 citycode（如北京 010）；同城时 city2 可空。起终点「经度,纬度」。"""
    c2 = (city2 or "").strip() or city1
    params: dict[str, Any] = {
        "origin": origin,
        "destination": destination,
        "city1": city1,
        "city2": c2,
        "strategy": strategy,
        "nightflag": nightflag,
        "multiexport": multiexport,
        "originpoi": originpoi or None,
        "destinationpoi": destinationpoi or None,
        "show_fields": show_fields or None,
    }
    if alternative_route is not None:
        params["AlternativeRoute"] = alternative_route
    data = _amap_v5_get("direction/transit/integrated", params)
    return _truncate_json(data)


@tool
def amap_district(
    keywords: str,
    subdistrict: int = 1,
) -> str:
    """行政区域查询：省市区边界与子级列表。"""
    data = _amap_get(
        "config/district",
        {"keywords": keywords, "subdistrict": subdistrict, "extensions": "all"},
    )
    return _truncate_json(data)


def _review_row_overall(r: Review) -> float:
    return (r.taste_score + r.service_score + r.environment_score + r.value_score) / 4.0


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点间球面距离（km）。"""
    import math
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


@tool
def find_nearby_reviewed_restaurants(
    user_id: int,
    center_lng: float,
    center_lat: float,
    radius_km: float = 5.0,
    query_scope: str = "all",
) -> str:
    """按经纬度筛选点评库中的餐馆，返回距中心点 `radius_km` 公里以内的点评，按距离升序。

    - `center_lng` / `center_lat`：中心点经纬度（高德 GCJ-02 坐标，先用 `amap_geocode_geo` 获取）。
    - `radius_km`：搜索半径（公里），默认 5.0。
    - `query_scope`：`"mine"` 只查本人，`"all"` 全站（默认 all）。
    - 只有提交时经过高德选点确认的点评才有坐标；无坐标的点评不出现在结果中。
    """
    auth = advisor_auth_user_id.get()
    if auth is None:
        return json.dumps({"ok": False, "info": "未绑定登录用户"}, ensure_ascii=False)
    uid = int(auth)
    if int(user_id) != uid:
        return json.dumps({"ok": False, "info": f"user_id 不一致：传入 {user_id}，当前用户 {uid}"}, ensure_ascii=False)
    scope = (query_scope or "all").strip().lower()
    if scope not in ("mine", "all"):
        return json.dumps({"ok": False, "info": "query_scope 只能是 mine 或 all"}, ensure_ascii=False)

    db = SessionLocal()
    try:
        q = db.query(Review).options(joinedload(Review.author))
        if scope == "mine":
            q = q.filter(Review.user_id == uid)
        # 只取有坐标的记录
        q = q.filter(Review.latitude.isnot(None), Review.longitude.isnot(None))
        rows = q.all()
        items: list[dict[str, Any]] = []
        for r in rows:
            r_lat = float(r.latitude)  # type: ignore[arg-type]
            r_lng = float(r.longitude)  # type: ignore[arg-type]
            dist = _haversine_km(center_lat, center_lng, r_lat, r_lng)
            if dist > radius_km:
                continue
            tier = getattr(r, "recommend_tier", None) or "人上人"
            author_username = getattr(r.author, "username", "") if r.author else ""
            items.append({
                "review_id": r.id,
                "author_username": author_username,
                "restaurant_name": r.restaurant_name,
                "city": r.city,
                "district": r.district or "",
                "distance_km": round(dist, 2),
                "dining_type": r.dining_type,
                "recommend_tier": tier,
                "overall_score": round(_review_row_overall(r), 2),
                "avg_price": r.avg_price,
                "content_preview": (r.content or "")[:200],
                "created_at": r.created_at.isoformat() if r.created_at else "",
            })
        items.sort(key=lambda x: x["distance_km"])
        return _truncate_json({
            "ok": True,
            "center": {"lng": center_lng, "lat": center_lat},
            "radius_km": radius_km,
            "query_scope": scope,
            "count": len(items),
            "reviews": items,
        })
    finally:
        db.close()


@tool
def list_user_reviewed_restaurants(user_id: int, query_scope: str = "mine") -> str:
    """查询应用内点评记录（餐馆名、地区、推荐度、综合分、人均、正文摘要、`author_username` 等）。

    - **mine**（默认）：只查当前登录用户自己的点评；`user_id` 须与系统消息中的当前用户 id 一致。
    - **all**：全站所有用户点评（`user_id` 仅鉴权）。用于：无地点的推荐/点评参考、有地点时与高德结果合并、或用户明确问全站/所有人发了什么。
    """
    auth = advisor_auth_user_id.get()
    if auth is None:
        return json.dumps({"ok": False, "info": "未绑定登录用户，无法查询点评记录"}, ensure_ascii=False)
    uid = int(auth)
    scope = (query_scope or "mine").strip().lower()
    if scope not in ("mine", "all"):
        return json.dumps(
            {"ok": False, "info": "query_scope 只能是 mine（本人）或 all（全站）"},
            ensure_ascii=False,
        )
    if int(user_id) != uid:
        return json.dumps(
            {
                "ok": False,
                "info": f"user_id 不一致：传入 {user_id}，当前登录用户为 {uid}。请使用系统提示中的 user_id。",
            },
            ensure_ascii=False,
        )

    db = SessionLocal()
    try:
        q = db.query(Review).options(joinedload(Review.author))
        if scope == "mine":
            q = q.filter(Review.user_id == uid)
        limit = 80 if scope == "mine" else 200
        rows = q.order_by(Review.created_at.desc()).limit(limit).all()
        items: list[dict[str, Any]] = []
        for r in rows:
            tier = getattr(r, "recommend_tier", None) or "人上人"
            author_username = ""
            if r.author is not None:
                author_username = getattr(r.author, "username", "") or ""
            row_out: dict[str, Any] = {
                "review_id": r.id,
                "user_id": r.user_id,
                "author_username": author_username,
                "restaurant_name": r.restaurant_name,
                "city": r.city,
                "district": r.district or "",
                "dining_type": r.dining_type,
                "recommend_tier": tier,
                "overall_score": round(_review_row_overall(r), 2),
                "avg_price": r.avg_price,
                "content_preview": (r.content or "")[:200],
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            items.append(row_out)
        payload: dict[str, Any] = {
            "ok": True,
            "query_scope": scope,
            "count": len(items),
            "reviews": items,
        }
        if scope == "mine":
            payload["user_id"] = uid
        return _truncate_json(payload)
    finally:
        db.close()


AMAP_TOOLS = [
    amap_geocode_geo,
    amap_geocode_regeo,
    amap_place_text,
    amap_place_around,
    amap_input_tips,
    amap_weather,
    amap_ip_location,
    amap_route_driving,
    amap_route_walking,
    amap_route_bicycling,
    amap_route_electrobike,
    amap_route_transit,
    amap_district,
]

ADVISOR_TOOLS = [*AMAP_TOOLS, list_user_reviewed_restaurants, find_nearby_reviewed_restaurants]

SYSTEM_PROMPT = """你是美食AI参谋：闲聊、美食与点评常识、一般知识或解题思路等，可直接用自然语言回答，不必调用工具。

## 推荐餐馆、点评与点评库（优先按下面执行）
参数 `user_id` **始终只填**系统消息里给出的当前登录用户 id（鉴权用，不得改他人 id）。

1) **用户要推荐、想参考点评，但没有给出具体地点**（例如「推荐几家馆子」「最近大家吃了啥值得去」）：
   - 调用 `list_user_reviewed_restaurants`，`query_scope="all"`，依据全站真实点评作答。
   - **不要**为此去调高德周边搜/关键字搜（没有锚点地点就不要硬搜地图）。

2) **用户提到「某地附近」「某地旁边」或明确给出了可检索的地点**（例如「三里屯附近吃啥」「望京有什么火锅」「离西湖 3 公里内有哪些」）：
   - **步骤 A**：先用 `amap_geocode_geo` 把该地名转为经纬度（location 字段格式为「经度,纬度」）。
   - **步骤 B**：立即调用 `find_nearby_reviewed_restaurants`，传入步骤 A 得到的 `center_lng`/`center_lat`，`radius_km` 默认 5.0（用户说「附近」或「不远」时用 5；说「很近」时可用 2；说「周边」「一带」时可用 8～10）。
   - **步骤 C**：如库内结果不足 5 条，再用 `amap_place_around` 补充高德 POI，与库内结果合并后一起呈现。
   - 回答时标注每条点评距离（来自 `distance_km` 字段）。

3) **用户只问本人记录**（「我写过哪些」「我去过哪些店」）：
   - 调用 `list_user_reviewed_restaurants`，`query_scope="mine"`。

以上用中文回答；用户未指定条数时默认约 5 条；列店名、类型、距离（若有）、评分、地址。

## 高德地图工具（有明确地理/路线/天气需求时用）
需要可核验的店址、坐标、距离、路线、天气、行政区等时**必须**调用高德工具，未调用不得编造；用户**没有**地点锚点且属于上节 1) 时，不要为了显得专业而强行搜地图。

路径规划：`amap_route_driving` / `amap_route_walking` / `amap_route_bicycling` / `amap_route_electrobike` / `amap_route_transit`；起终点均为「经度,纬度」。公交须传 citycode：`amap_route_transit` 的 city1、city2（同城可只填 city1）。
"""


def _make_llm() -> ChatOpenAI:
    base = settings.ai_base_url.rstrip("/")
    proxy = (settings.ai_http_proxy or "").strip() or None
    timeout = httpx.Timeout(120.0)
    client_kw: dict[str, Any] = {}
    if proxy:
        client_kw["http_async_client"] = httpx.AsyncClient(proxy=proxy, timeout=timeout)
        client_kw["http_client"] = httpx.Client(proxy=proxy, timeout=timeout)
    return ChatOpenAI(
        model=settings.ai_model,
        base_url=f"{base}",
        api_key=(settings.ai_api_key or "EMPTY").strip() or "EMPTY",
        temperature=0.2,
        timeout=120.0,
        streaming=True,
        **client_kw,
    )


# 修改 _make_llm / 工具集 / SYSTEM_PROMPT 后递增，避免进程内仍缓存旧图
_AGENT_GRAPH_VERSION = 7
_agent_graph: Any | None = None
_agent_graph_built_at: int = 0


def _get_agent_graph():
    """惰性构建 Agent 图；进程内单例；版本号变化时重建。"""
    global _agent_graph, _agent_graph_built_at
    if _agent_graph is None or _agent_graph_built_at != _AGENT_GRAPH_VERSION:
        _agent_graph = create_agent(
            _make_llm(),
            ADVISOR_TOOLS,
            system_prompt=SYSTEM_PROMPT,
        )
        _agent_graph_built_at = _AGENT_GRAPH_VERSION
    return _agent_graph


def _sse_openai_delta(text: str) -> str:
    return json.dumps({"choices": [{"delta": {"content": text}}]}, ensure_ascii=False)


def _message_text(message: BaseMessage) -> str:
    """提取消息里的纯文本部分。"""
    c = getattr(message, "content", None)
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts: list[str] = []
        for block in c:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        if parts:
            return "".join(parts)
    return str(c or "")


async def _run_tool_call(tool_call: dict[str, Any]) -> ToolMessage:
    """执行单个 LangChain tool_call 并包装成 ToolMessage。"""
    t_tool = time.perf_counter()
    name = str(tool_call.get("name") or "")
    call_id = str(tool_call.get("id") or "")
    raw_args = tool_call.get("args") or {}
    if isinstance(raw_args, str):
        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {}
    elif isinstance(raw_args, dict):
        args = raw_args
    else:
        args = {}

    tool_obj = next((t for t in ADVISOR_TOOLS if getattr(t, "name", "") == name), None)
    if tool_obj is None:
        content = json.dumps({"status": "0", "info": f"未知工具: {name}"}, ensure_ascii=False)
        return ToolMessage(content=content, name=name or "unknown_tool", tool_call_id=call_id, status="error")

    try:
        result = await tool_obj.ainvoke(args)
        content = result if isinstance(result, str) else _truncate_json(result)
        logger.info(
            "ai_sse tool_done name={} ms={:.1f}",
            name,
            (time.perf_counter() - t_tool) * 1000,
        )
        return ToolMessage(content=content, name=name, tool_call_id=call_id, status="success")
    except Exception as e:  # noqa: BLE001 - 工具异常应回传给模型继续兜底
        logger.warning(
            "ai_sse tool_fail name={} ms={:.1f} err={}",
            name,
            (time.perf_counter() - t_tool) * 1000,
            e,
        )
        content = json.dumps({"status": "0", "info": f"工具 {name} 执行失败: {e}"}, ensure_ascii=False)
        return ToolMessage(content=content, name=name, tool_call_id=call_id, status="error")


async def iter_amap_advisor_sse(
    messages: list[BaseMessage],
    *,
    auth_user_id: int,
    auth_username: str = "",
) -> AsyncIterator[bytes]:
    """
    参谋页 SSE：仅输出最终答案的 OpenAI 兼容 delta.content。
    实现方式使用 LangChain 原生 `ChatOpenAI.bind_tools(...).astream()`：
    前几轮用流式累计 tool_call_chunks，若最终形成 tool_calls 则执行工具并继续；
    遇到没有 tool_calls 的最终回答轮时，直接把 text chunks 逐段转发给前端。
    """
    ctx_token = advisor_auth_user_id.set(int(auth_user_id))
    t_sse_start = time.perf_counter()
    try:
        user_ctx = (
            f"\n\n【会话身份】当前登录用户 user_id={int(auth_user_id)}"
            + (f"，用户名 {auth_username}" if auth_username else "")
            + "。调用 `list_user_reviewed_restaurants` 时参数 `user_id` 只能填上述 id。"
        )
        full_system = SYSTEM_PROMPT + user_ctx

        yield b":\n\n"

        t_before_llm = time.perf_counter()
        llm = _make_llm()
        if not _amap_key():
            llm_with_tools = llm.bind_tools([list_user_reviewed_restaurants])
            dialogue: list[BaseMessage] = [
                SystemMessage(
                    content=full_system
                    + "\n\n（当前未配置 AMAP_KEY，无法使用高德地图类工具；若用户需要地图/POI/路线等，请说明需配置 AMAP_KEY。）"
                ),
                *messages,
            ]
        else:
            llm_with_tools = llm.bind_tools(ADVISOR_TOOLS)
            dialogue = [SystemMessage(content=full_system), *messages]

        t_after_bind = time.perf_counter()
        logger.info(
            "ai_sse user_id={} phase=prep make_llm+bind+dialogue_ms={:.1f} since_start_ms={:.1f}",
            auth_user_id,
            (t_after_bind - t_before_llm) * 1000,
            (t_after_bind - t_sse_start) * 1000,
        )

        trace_messages: list[Any] = list(messages)
        max_turns = 8
        streamed_any_text = False

        try:
            for turn in range(max_turns):
                full_chunk = None
                saw_tool_chunks = False
                started_streaming_this_turn = False
                pending_text_chunks: list[str] = []
                first_llm_chunk_logged = False
                t_stream_start = time.perf_counter()

                async for chunk in llm_with_tools.astream(dialogue):
                    if not first_llm_chunk_logged:
                        first_llm_chunk_logged = True
                        logger.info(
                            "ai_sse user_id={} turn={} phase=first_llm_chunk since_stream_start_ms={:.1f} since_sse_start_ms={:.1f}",
                            auth_user_id,
                            turn,
                            (time.perf_counter() - t_stream_start) * 1000,
                            (time.perf_counter() - t_sse_start) * 1000,
                        )
                    full_chunk = chunk if full_chunk is None else full_chunk + chunk

                    # 流式前几包经常是 content 为空的 AIMessageChunk：仅携带 run id、元数据或占位，
                    # 并非模型「打了许多空格」；首个可见字出现在第一个带文本的 delta 里。
                    tool_call_chunks = getattr(chunk, "tool_call_chunks", None) or []
                    if tool_call_chunks:
                        saw_tool_chunks = True

                    text_piece = getattr(chunk, "text", None)
                    if not isinstance(text_piece, str) or not text_piece:
                        text_piece = _message_text(chunk)
                    if not text_piece:
                        continue

                    # 工具调用轮通常只会先吐空串或 "\n\n"，随后出现 tool_call_chunks。
                    # 为避免把这类前导空白误发给前端，先暂存，直到确认本轮没有走工具。
                    pending_text_chunks.append(text_piece)
                    if saw_tool_chunks:
                        continue

                    if not started_streaming_this_turn and text_piece.strip():
                        for buffered in pending_text_chunks:
                            if buffered:
                                logger.info(f"buffered: {buffered}")
                                yield f"data: {_sse_openai_delta(buffered)}\n\n".encode()
                        started_streaming_this_turn = True
                        streamed_any_text = True
                        logger.info(
                            "ai_sse user_id={} turn={} phase=【first_token_to_client】 since_sse_start_ms={:.1f} since_stream_start_ms={:.1f}",
                            auth_user_id,
                            turn,
                            (time.perf_counter() - t_sse_start) * 1000,
                            (time.perf_counter() - t_stream_start) * 1000,
                        )
                        continue

                    if started_streaming_this_turn:
                        yield f"data: {_sse_openai_delta(text_piece)}\n\n".encode()

                t_after_stream = time.perf_counter()
                logger.info(
                    "ai_sse user_id={} turn={} phase=llm_stream_end wall_ms={:.1f} saw_tool_chunks={} started_text_stream={}",
                    auth_user_id,
                    turn,
                    (t_after_stream - t_stream_start) * 1000,
                    saw_tool_chunks,
                    started_streaming_this_turn,
                )

                if full_chunk is None:
                    break

                final_ai = AIMessage(
                    content=_message_text(full_chunk),
                    tool_calls=getattr(full_chunk, "tool_calls", None) or [],
                )
                if final_ai.tool_calls:
                    trace_messages.append(final_ai)
                    dialogue.append(final_ai)
                    for tool_call in final_ai.tool_calls:
                        tool_msg = await _run_tool_call(tool_call)
                        trace_messages.append(tool_msg)
                        dialogue.append(tool_msg)
                    continue

                if not started_streaming_this_turn:
                    fallback_text = _message_text(full_chunk)
                    if fallback_text:
                        yield f"data: {_sse_openai_delta(fallback_text)}\n\n".encode()
                        streamed_any_text = True
                        logger.info(
                            "ai_sse user_id={} turn={} phase=first_token_fallback since_sse_start_ms={:.1f}",
                            auth_user_id,
                            turn,
                            (time.perf_counter() - t_sse_start) * 1000,
                        )
                trace_messages.append(final_ai)
                break
            else:
                err = "（参谋服务异常：工具调用轮数过多，已中止）"
                yield f"data: {_sse_openai_delta(err)}\n\n".encode()
                streamed_any_text = True
        except Exception as e:  # noqa: BLE001
            err = f"（参谋服务异常：{e}）"
            yield f"data: {_sse_openai_delta(err)}\n\n".encode()
            streamed_any_text = True

        if settings.debug_amap_agent and trace_messages:
            _debug_print_messages(trace_messages)

        if not streamed_any_text:
            yield f"data: {_sse_openai_delta('（未生成文本回复，请检查模型是否支持工具调用）')}\n\n".encode()
        yield b"data: [DONE]\n\n"
    finally:
        advisor_auth_user_id.reset(ctx_token)


def _final_text(messages: list[BaseMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, AIMessage) and m.content:
            c = m.content
            if isinstance(c, str):
                return c
            if isinstance(c, list):
                parts = []
                for block in c:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(block.get("text", ""))
                return "\n".join(parts) if parts else str(c)
            return str(c)
    return "（未生成文本回复，请检查模型是否支持工具调用）"


def _debug_print_messages(msgs: list[Any]) -> None:
    """DEBUG_AMAP_AGENT=1 时：将 Agent 消息列表格式化写入日志（含 logs/app.log）。"""
    lines: list[str] = ["", "=" * 72, "amap agent · messages", "=" * 72]
    for i, m in enumerate(msgs):
        header = f"[{i}] {type(m).__name__}"
        lines.append("-" * len(header))
        lines.append(header)
        if hasattr(m, "model_dump"):
            blob = m.model_dump()
        else:
            blob = {"repr": repr(m)}
        text = pprint.pformat(blob, width=96, sort_dicts=False, compact=False)
        if len(text) > 12_000:
            text = text[:12_000] + "\n…(truncated)"
        lines.append(text)
    lines.append("=" * 72)
    logger.info("\n".join(lines))


async def arun_amap_agent(user_query: str) -> str:
    """异步执行高德 Agent，返回最终自然语言答案。"""
    if not _amap_key():
        return "服务端未配置高德 AMAP_KEY，无法调用地图接口。请在环境变量中设置 AMAP_KEY 后重试。"

    graph = _get_agent_graph()
    state = await graph.ainvoke(
        {"messages": [HumanMessage(content=user_query.strip())]},
        config={"recursion_limit": 40},
    )
    msgs = state.get("messages") or []
    if settings.debug_amap_agent:
        _debug_print_messages(list(msgs))
    return _final_text(list(msgs))


def run_amap_agent_sync(user_query: str) -> str:
    """同步包装（测试或非 async 环境）。"""
    import asyncio

    return asyncio.run(arun_amap_agent(user_query))


if __name__ == "__main__":
    print(run_amap_agent_sync("北京天安门附近的美食"))
