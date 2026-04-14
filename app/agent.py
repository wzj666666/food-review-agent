"""
基于 LangChain Agent + 高德 Web 服务。

- 模型：OpenAI 兼容接口（app.config.settings，默认本机 8020）。
- v3：地理编码 / 逆地理 / POI / 输入提示 / 天气 / IP / 行政区。
- 路径规划 2.0（v5）：驾车、步行、骑行、电动车、公交地铁。
- 需配置 **AMAP_KEY**；调试打印设 **DEBUG_AMAP_AGENT=1**（见 settings.debug_amap_agent）。
"""

from __future__ import annotations

import asyncio
import json
import pprint
from collections.abc import AsyncIterator
from typing import Any

import httpx
from langchain.agents import create_agent
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from app.config import settings

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
    offset: int = 6,
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

SYSTEM_PROMPT = """你是「高德地图 + 本地生活」助手，必须通过下方工具获取真实数据，禁止编造 POI、坐标或营业信息。

处理「某地名附近美食/餐厅」类问题时，建议顺序：
1) 用地理编码 `amap_geocode_geo` 把地名与上级城市转为经纬度；
2) 用周边搜索 `amap_place_around`，location 填坐标，keywords 用「美食」等，radius 可用 2000～5000 米；
3) 若地理编码不理想，可先用 `amap_input_tips` 联想，再编码或 `amap_place_text` 关键字搜索。

路径规划请用 2.0 工具：`amap_route_driving` / `amap_route_walking` / `amap_route_bicycling` / `amap_route_electrobike` / `amap_route_transit`；起终点均为「经度,纬度」。公交须传 citycode：`amap_route_transit` 的 city1、city2（同城可只填 city1）。

回答用户时用中文，简洁列出店名、类型、距离（若有）、评分、地址。若工具返回 status 不为 1（路径 2.0 与多数接口为字符串 \"1\" 表示成功），说明原因并给出可重试建议。"""


def _make_llm() -> ChatOpenAI:
    base = settings.ai_base_url.rstrip("/")
    return ChatOpenAI(
        model=settings.ai_model,
        base_url=f"{base}/v1",
        api_key=(settings.ai_api_key or "EMPTY").strip() or "EMPTY",
        temperature=0.2,
        timeout=120.0,
        streaming=True,
    )


# 修改 _make_llm / 工具集后递增，避免进程内仍缓存旧图
_AGENT_GRAPH_VERSION = 2
_agent_graph: Any | None = None
_agent_graph_built_at: int = 0


def _get_agent_graph():
    """惰性构建 Agent 图；进程内单例；版本号变化时重建。"""
    global _agent_graph, _agent_graph_built_at
    if _agent_graph is None or _agent_graph_built_at != _AGENT_GRAPH_VERSION:
        _agent_graph = create_agent(
            _make_llm(),
            AMAP_TOOLS,
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

    tool_obj = next((t for t in AMAP_TOOLS if getattr(t, "name", "") == name), None)
    if tool_obj is None:
        content = json.dumps({"status": "0", "info": f"未知工具: {name}"}, ensure_ascii=False)
        return ToolMessage(content=content, name=name or "unknown_tool", tool_call_id=call_id, status="error")

    try:
        result = await tool_obj.ainvoke(args)
        content = result if isinstance(result, str) else _truncate_json(result)
        return ToolMessage(content=content, name=name, tool_call_id=call_id, status="success")
    except Exception as e:  # noqa: BLE001 - 工具异常应回传给模型继续兜底
        content = json.dumps({"status": "0", "info": f"工具 {name} 执行失败: {e}"}, ensure_ascii=False)
        return ToolMessage(content=content, name=name, tool_call_id=call_id, status="error")


async def iter_amap_advisor_sse(messages: list[BaseMessage]) -> AsyncIterator[bytes]:
    """
    参谋页 SSE：仅输出最终答案的 OpenAI 兼容 delta.content。
    实现方式使用 LangChain 原生 `ChatOpenAI.bind_tools(...).astream()`：
    前几轮用流式累计 tool_call_chunks，若最终形成 tool_calls 则执行工具并继续；
    遇到没有 tool_calls 的最终回答轮时，直接把 text chunks 逐段转发给前端。
    """
    if not _amap_key():
        err = "服务端未配置高德 AMAP_KEY，无法使用地图参谋。请在环境变量中设置 AMAP_KEY 后重试。"
        yield f"data: {_sse_openai_delta(err)}\n\n".encode()
        yield b"data: [DONE]\n\n"
        return

    # 立刻推一行 SSE 注释，尽早结束「首字节前阻塞」，并减少中间层合并首包与后续包的概率
    yield b":\n\n"

    llm = _make_llm()
    llm_with_tools = llm.bind_tools(AMAP_TOOLS)
    dialogue: list[BaseMessage] = [SystemMessage(content=SYSTEM_PROMPT), *messages]
    trace_messages: list[Any] = list(messages)
    max_turns = 8
    streamed_any_text = False

    try:
        for _ in range(max_turns):
            full_chunk = None
            saw_tool_chunks = False
            started_streaming_this_turn = False
            pending_text_chunks: list[str] = []

            async for chunk in llm_with_tools.astream(dialogue):
                full_chunk = chunk if full_chunk is None else full_chunk + chunk

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
                            yield f"data: {_sse_openai_delta(buffered)}\n\n".encode()
                    started_streaming_this_turn = True
                    streamed_any_text = True
                    continue

                if started_streaming_this_turn:
                    yield f"data: {_sse_openai_delta(text_piece)}\n\n".encode()

            if full_chunk is None:
                break

            final_ai = AIMessage(content=_message_text(full_chunk), tool_calls=getattr(full_chunk, "tool_calls", None) or [])
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
    """终端调试：把 Agent 返回的消息列表格式化打印。"""
    print("\n" + "=" * 72, flush=True)
    print("amap agent · messages", flush=True)
    print("=" * 72, flush=True)
    for i, m in enumerate(msgs):
        header = f"[{i}] {type(m).__name__}"
        print("-" * len(header), flush=True)
        print(header, flush=True)
        if hasattr(m, "model_dump"):
            blob = m.model_dump()
        else:
            blob = {"repr": repr(m)}
        text = pprint.pformat(blob, width=96, sort_dicts=False, compact=False)
        if len(text) > 12_000:
            text = text[:12_000] + "\n…(truncated)"
        print(text, flush=True)
    print("=" * 72 + "\n", flush=True)


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
