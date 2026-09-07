"""入职前经历 → 能力词与做过的事。语料侧唯一一处调用抽取端点的地方。

原文四路里只有简历描述是自由文本，而它整段池化成一个向量分不清主语和重点：
「配合算法团队完成上线」会和「算法」相近，主语却是别人。这里让模型把一段
描述读成两类**短说法**，每条说法和原文四路一样存进 `phrase`、指回这一段
（`experience_phrase` 的 `skill` / `did` 两路），检索链路对它们一视同仁：
向量召回、重排判定、按路权重打分。它们的来源仍是自述，所以强度和
`description` 同档（`src/search/weights.ts`）。

**判断进提示词，阈值进代码**：什么算能力词、哪种语气是哪种参与方式，是逐段的
判断，写在下面的提示词里，可以大改（换提示词就换 `EXTRACT_SPACE_ID`，旧缓存
自然失效）；一条说法最长几个字、一段最多几条、参与方式只认哪几种，是全站的
阈值，写在 `conform` 里，改了不必换 id——缓存里存的是模型的原话，
`conform` 每次重灌都重新收窄一遍。

**模型输出是不可信输入。** schema 里不写枚举、不写长度上限：写了，模型多给
一个字整条响应就作废，而收窄只会丢掉那一条（AGENTS.md「限制只写在收窄的
地方」）。参与方式不在枚举里的那一件事留下领域、参与方式记空——它只是证据行上
的标签，不参与检索（为什么不进向量见 `src/db/schema.ts` 的 `involvement` 列）。

只对入职前、有描述的段调用；公司内任职段没有自由文本，抽不出东西也不该去问。
端点没配就整体跳过（`load.py` 打印说明），检索照常可用、只是这两路为空。
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import config as C
from endpoint import post_json, retrying

#: 一条说法最长几个字。能力词和领域都是短名词；超过这个数的通常是模型把
#: 半句话原样抄了下来，那不是标签，是另一段原文。
MAX_TAG_LEN = 16
#: 一段最多几条能力词、几件事。多于此数的段几乎总是模型在逐句复述描述。
MAX_SKILLS = 12
MAX_DID = 8


@dataclass(frozen=True)
class Extraction:
    """一段经历抽出来的东西。`did` 的每一项是（参与方式，领域）：领域是说法，
    参与方式落在边上，模型判断不出时是 None。"""

    skills: tuple[str, ...]
    did: tuple[tuple[str | None, str], ...]


EMPTY = Extraction((), ())


#: 参与方式的几种取值与每种对应的语气。这是「做过的事」唯一的枚举，只写在
#: 这里：提示词从这里写进提示词给模型，`conform` 用它收窄，库里那一列不设约束。
INVOLVEMENT_GUIDE = {
    "从零搭建": "从无到有做出来的",
    "负责建设": "主责、主导、负责的",
    "优化改进": "提升、改造、迭代已有东西的",
    "参与执行": "参与、协助、配合、支持的",
    "带队管理": "带团队、管理人的",
}
INVOLVEMENTS: tuple[str, ...] = tuple(INVOLVEMENT_GUIDE)

SYSTEM = f"""你在读一段员工入职前的工作经历，把它整理成人才库能检索的两类短说法。只根据给出的文字，不补充、不推断没有写的事。

输出 JSON：{{"skills": ["..."], "did": [{{"involvement": "...", "domain": "..."}}]}}

skills（能力词）：这个人在这段经历里实际用到或负责的技能、技术、方法与业务领域。
- 短名词，一般不超过八个字，例如「推荐算法」「Python」「支付风控」「渠道拓展」「数据仓库」。
- 只写本人做的事。主语是别人或团队的（「配合算法团队」「公司拥有……」）不算这个人的能力。
- 不写：公司名、产品名、学校名；年限、职级、「高级」「资深」这类级别词；「沟通能力强」「责任心」这类自评；岗位名本身。
- 没有可写的就给空数组。

did（做过的事）：这个人在这段经历里做过的具体事，每件写成一种参与方式加一个领域。
- involvement 只能取以下五种之一：{"；".join(f"{a}（{g}）" for a, g in INVOLVEMENT_GUIDE.items())}。
- domain 是这件事的对象，短名词，例如「推荐系统」「支付成功率」「数据平台」。
- 判断不出参与方式就把 involvement 写成空字符串，不要硬选。
- 没有具体的事就给空数组。"""

SCHEMA = {
    "type": "object",
    "properties": {
        "skills": {"type": "array", "items": {"type": "string"}},
        "did": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "involvement": {"type": "string"},
                    "domain": {"type": "string"},
                },
                "required": ["involvement", "domain"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["skills", "did"],
    "additionalProperties": False,
}


def prompt_input(row: Mapping[str, str]) -> str:
    """送给模型的那段话。它也是缓存的键：同一段话永远得到同一份抽取。"""
    return f"岗位：{row['title']}\n公司：{row['org']}\n描述：{row['description']}"


def _tag(value: object) -> str:
    """一条说法的规范写法：NFKC 折叠全半角，压掉多余空白。"""
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip(" ·,，;；")


def _keep(tag: str, org: str) -> bool:
    # 公司名永远不进向量：专有名词在向量空间里和同类名字是邻居。模型偶尔会把
    # 公司名当领域吐回来，这里按原文的公司名兜一道。
    if not tag or len(tag) > MAX_TAG_LEN:
        return False
    return not (org and (tag in org or org in tag))


def _items(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def conform(raw: object, org: str) -> Extraction:
    """把模型的原话收窄成一份合法的抽取。收窄只丢单条，不丢整段。"""
    if not isinstance(raw, Mapping):
        return EMPTY
    skills: list[str] = []
    # 只认数组：字符串也可迭代，"Python" 会被拆成六个单字标签
    for item in _items(raw.get("skills")):
        tag = _tag(item)
        if _keep(tag, org) and tag not in skills:
            skills.append(tag)
        if len(skills) == MAX_SKILLS:
            break
    did: list[tuple[str | None, str]] = []
    # 一段对同一个领域只留第一条：边的主键是（段、路、说法），领域就是说法
    for item in _items(raw.get("did")):
        if not isinstance(item, Mapping):
            continue
        involvement = _tag(item.get("involvement"))
        domain = _tag(item.get("domain"))
        if _keep(domain, org) and all(d != domain for _, d in did):
            did.append((involvement if involvement in INVOLVEMENTS else None, domain))
        if len(did) == MAX_DID:
            break
    return Extraction(tuple(skills), tuple(did))


def extract(rows: list[Mapping[str, str]]) -> list[Extraction]:
    """按入参顺序返回每段的抽取。只有入职前且有描述的段会去问端点。
    每行读 `kind`、`org`、`title`、`description` 四个键。

    和 `embed` 一样先查缓存、再去重、最后才打端点；缓存里存的是模型的原话
    （JSON 字符串），按（抽取空间、模型、那段话）键入，读出来再 `conform`。
    进度只报没命中缓存的那几段。
    """
    asked = [
        prompt_input(row)
        if row["kind"] == "external" and row["description"]
        else None
        for row in rows
    ]
    unique = list(dict.fromkeys(text for text in asked if text))
    with _cache() as cache:
        payloads = _cached(cache, unique)
        missing = [t for t in unique if t not in payloads]
        done = 0
        with ThreadPoolExecutor(max_workers=C.EXTRACT_CONCURRENCY) as pool:
            for text, payload in zip(missing, pool.map(_request, missing), strict=True):
                done += 1
                if payload is None:
                    continue
                _store(cache, text, payload)
                payloads[text] = payload
                if done % 20 == 0 or done == len(missing):
                    print(f"  已抽取 {done}/{len(missing)} 段新描述", flush=True)
    out: list[Extraction] = []
    for row, text in zip(rows, asked, strict=True):
        payload = payloads.get(text) if text else None
        out.append(conform(payload, row["org"]) if payload is not None else EMPTY)
    return out


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


def _cache_key() -> str:
    return f"{C.EXTRACT_SPACE_ID}\x1f{C.EXTRACT_MODEL}"


def _cached(cache: sqlite3.Connection, texts: list[str]) -> dict[str, object]:
    out: dict[str, object] = {}
    by_sha = {_sha(t): t for t in texts}
    shas = list(by_sha)
    for start in range(0, len(shas), 500):
        part = shas[start : start + 500]
        placeholders = ",".join("?" for _ in part)
        rows = cache.execute(
            f"select sha, payload from extraction where identity = ? and sha in ({placeholders})",
            [_cache_key(), *part],
        ).fetchall()
        invalid: list[tuple[str, str]] = []
        for sha, payload in rows:
            try:
                out[by_sha[sha]] = json.loads(payload)
            except ValueError:
                # 写坏的缓存：删掉重抽
                invalid.append((_cache_key(), sha))
        cache.executemany(
            "delete from extraction where identity = ? and sha = ?", invalid
        )
    return out


def _store(cache: sqlite3.Connection, text: str, payload: object) -> None:
    cache.execute(
        "insert into extraction (identity, sha, payload) values (?, ?, ?) "
        "on conflict (identity, sha) do update set payload = excluded.payload",
        (_cache_key(), _sha(text), json.dumps(payload, ensure_ascii=False)),
    )
    cache.commit()


def _request(text: str) -> object | None:
    """一段描述的抽取。瞬时故障重试；模型给回的不是 JSON 就打印说明后放弃这一段。

    放弃这一段而不是整次导入：一个异常的响应不该让二十分钟的灌库回滚。
    放弃的段不进缓存，下次重跑会再问一遍。
    """
    return retrying("抽取", C.EXTRACT_BASE_URL, lambda: _post(text))


def _post(text: str) -> object | None:
    response_format: dict[str, object] = (
        {
            "type": "json_schema",
            "json_schema": {"name": "extraction", "strict": True, "schema": SCHEMA},
        }
        if C.EXTRACT_STRUCTURED_OUTPUTS
        else {"type": "json_object"}
    )
    payload = post_json(
        f"{C.EXTRACT_BASE_URL.rstrip('/')}/chat/completions",
        {
            "model": C.EXTRACT_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM},
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
        raise SystemExit("抽取端点响应缺少 choices[0].message.content") from None
    if not content:
        # 推理模型在思考阶段撞上输出预算时就是这个样子：不报错，content 为空
        print(
            f"  抽取返回空内容（finish_reason={choice.get('finish_reason')}），"
            "这段两路为空；若 finish_reason 是 length，调大 EXTRACT_MAX_OUTPUT_TOKENS",
            flush=True,
        )
        return None
    try:
        return json.loads(content)
    except ValueError:
        print("  抽取返回的不是 JSON，这段两路为空", flush=True)
        return None
