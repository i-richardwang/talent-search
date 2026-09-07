"""语料侧调用聊天端点的那一层：一段文字进、一份 JSON 出，结果缓存在本地。

两处用它——`extract.py`（简历描述 → 能力词与做过的事）和 `align.py`（入职前
岗位 → 公司序列）。它们各有各的提示词、schema 与收窄，这里只有对两者都成立
的事：发 `/chat/completions`、要 JSON、并发、进度，以及按身份键入的 SQLite 缓存。

**缓存里存的是模型的原话**，收窄在调用方读出时做：改收窄规则不动缓存。缓存的
键是模型名、系统提示词与 schema 的摘要加上那段文字：会改变回答的东西都在键里，
改了提示词（含对齐提示词里列出的序列树）旧回答自然失效，不用人记得换什么身份。
同一段文字、同一份提示词、同一个模型，永远同一份回答。

**模型输出是不可信输入。** 响应不是 JSON 的段打印说明后放弃、不进缓存，下次
重跑再问；一个异常的响应不该让二十分钟的灌库回滚。
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor

import config as C
from endpoint import post_json, retrying


def complete(
    system: str, schema: Mapping[str, object], texts: list[str], what: str
) -> dict[str, object]:
    """对每段文字要一份 JSON；返回文字 → 模型原话，放弃的段不在里面。

    先查缓存、再去重、最后才打端点；`what` 是进度和报错里的名字（「抽取」「对齐」）。
    """
    identity = _identity(system, schema)
    unique = list(dict.fromkeys(texts))
    with _cache() as cache:
        payloads = _cached(cache, identity, unique)
        missing = [t for t in unique if t not in payloads]
        done = 0
        with ThreadPoolExecutor(max_workers=C.EXTRACT_CONCURRENCY) as pool:
            for text, payload in zip(
                missing,
                pool.map(lambda t: _request(system, schema, t, what), missing),
                strict=True,
            ):
                done += 1
                if payload is None:
                    continue
                _store(cache, identity, text, payload)
                payloads[text] = payload
                if done % 20 == 0 or done == len(missing):
                    print(f"  已{what} {done}/{len(missing)}", flush=True)
    return payloads


def _identity(system: str, schema: Mapping[str, object]) -> str:
    return _sha(
        f"{C.EXTRACT_MODEL}\x1f{system}\x1f{json.dumps(schema, ensure_ascii=False, sort_keys=True)}"
    )


def _cache() -> sqlite3.Connection:
    C.EXTRACT_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(C.EXTRACT_CACHE_PATH)
    conn.execute(
        "create table if not exists extraction ("
        " identity text not null, sha text not null, payload text not null,"
        " primary key (identity, sha))"
    )
    return conn


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _cached(
    cache: sqlite3.Connection, identity: str, texts: list[str]
) -> dict[str, object]:
    out: dict[str, object] = {}
    by_sha = {_sha(t): t for t in texts}
    shas = list(by_sha)
    for start in range(0, len(shas), 500):
        part = shas[start : start + 500]
        placeholders = ",".join("?" for _ in part)
        rows = cache.execute(
            f"select sha, payload from extraction where identity = ? and sha in ({placeholders})",
            [identity, *part],
        ).fetchall()
        invalid: list[tuple[str, str]] = []
        for sha, payload in rows:
            try:
                out[by_sha[sha]] = json.loads(payload)
            except ValueError:
                # 写坏的缓存：删掉重问
                invalid.append((identity, sha))
        cache.executemany(
            "delete from extraction where identity = ? and sha = ?", invalid
        )
    return out


def _store(
    cache: sqlite3.Connection, identity: str, text: str, payload: object
) -> None:
    cache.execute(
        "insert into extraction (identity, sha, payload) values (?, ?, ?) "
        "on conflict (identity, sha) do update set payload = excluded.payload",
        (identity, _sha(text), json.dumps(payload, ensure_ascii=False)),
    )
    cache.commit()


def _request(
    system: str, schema: Mapping[str, object], text: str, what: str
) -> object | None:
    """一段文字的回答。瞬时故障重试；模型给回的不是 JSON 就打印说明后放弃这一段。"""
    return retrying(what, C.EXTRACT_BASE_URL, lambda: _post(system, schema, text, what))


def _post(
    system: str, schema: Mapping[str, object], text: str, what: str
) -> object | None:
    response_format: dict[str, object] = (
        {
            "type": "json_schema",
            "json_schema": {"name": what, "strict": True, "schema": schema},
        }
        if C.EXTRACT_STRUCTURED_OUTPUTS
        else {"type": "json_object"}
    )
    payload = post_json(
        f"{C.EXTRACT_BASE_URL.rstrip('/')}/chat/completions",
        {
            "model": C.EXTRACT_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
            "response_format": response_format,
            "max_tokens": C.EXTRACT_MAX_OUTPUT_TOKENS,
            "temperature": 0,
            **(
                {"enable_thinking": C.EXTRACT_ENABLE_THINKING}
                if C.EXTRACT_ENABLE_THINKING is not None
                else {}
            ),
        },
        C.EXTRACT_API_KEY,
        C.EXTRACT_TIMEOUT_S,
    )
    try:
        choice = payload["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise SystemExit(f"{what}端点响应缺少 choices[0].message.content") from None
    if not content:
        # 推理模型在思考阶段撞上输出预算时就是这个样子：不报错，content 为空
        print(
            f"  {what}返回空内容（finish_reason={choice.get('finish_reason')}），"
            "放弃这一段；若 finish_reason 是 length，调大 EXTRACT_MAX_OUTPUT_TOKENS",
            flush=True,
        )
        return None
    try:
        return json.loads(content)
    except ValueError:
        print(f"  {what}返回的不是 JSON，放弃这一段", flush=True)
        return None
