"""入职前经历 → 能力词与做过的事。

原文四路里只有简历描述是自由文本，而它整段池化成一个向量分不清主语和重点：
「配合算法团队完成上线」会和「算法」相近，主语却是别人。这里让模型把一段
描述读成两类**短说法**，每条说法和原文四路一样存进 `phrase`、指回这一段
（`experience_phrase` 的 `skill` / `did` 两路），检索链路对它们一视同仁：
向量召回、重排判定、按路权重打分。它们的来源仍是自述，所以强度和
`description` 同档（`src/search/weights.ts`）。

**判断进提示词，阈值进代码**：什么算能力词、哪种语气是哪种参与方式，是逐段的
判断，写在下面的提示词里，可以大改（缓存按提示词键入，改了旧抽取自然失效）；一条说法最长几个字、一段最多几条、参与方式只认哪几种，是全站的
阈值，写在 `conform` 里，改了不必换 id——缓存里存的是模型的原话（`chat.py`），
`conform` 每次重灌都重新收窄一遍。

**模型输出是不可信输入。** schema 里不写枚举、不写长度上限：写了，模型多给
一个字整条响应就作废，而收窄只会丢掉那一条（AGENTS.md「限制只写在收窄的
地方」）。参与方式不在枚举里的那一件事留下领域、参与方式记空——它只是证据行上
的标签，不参与检索（为什么不进向量见 `src/db/schema.ts` 的 `involvement` 列）。

只对入职前、有描述的段调用；公司内任职段没有自由文本，抽不出东西也不该去问。
端点没配就整体跳过（`load.py` 打印说明），检索照常可用、只是这两路为空。
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass

import config as C
from chat import complete

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

skills（能力词）：这个人在这段经历里实际用到或负责的技能、技术、方法与业务领域，写成招聘要求里会出现的那种词。
- 一个词只是一项技能、一种工具、一种方法或一个业务领域的通名，一般不超过八个字，例如「推荐算法」「Python」「支付风控」「渠道拓展」「数据仓库」。
- 去掉动作、修饰语和项目名，只留领域本身：「国际风控系统搭建」写「风控」，「推荐专项需求核心开发」写「推荐系统」，「从 0 到 1 打造数据平台」写「数据平台」。
- 一段话里同一项能力只写一次；一句描述里有几项能力就拆成几个词。
- 只写本人做的事。主语是别人或团队的（「配合算法团队」「公司拥有……」）不算这个人的能力。
- 不写：公司名、产品名、学校名；年限、职级、「高级」「资深」这类级别词；「沟通能力强」「责任心」这类自评；岗位名本身；「搭建」「优化」「提升」「推进」「落地」这类动作。
- 没有可写的就给空数组。

did（做过的事）：这个人在这段经历里做过的具体事，每件写成一种参与方式加一个领域。
- involvement 只能取以下五种之一：{"；".join(f"{a}（{g}）" for a, g in INVOLVEMENT_GUIDE.items())}。
- domain 是这件事的对象的通名，例如「推荐系统」「支付成功率」「数据平台」；不带公司名、产品名和「核心」「专项」「国际」这类修饰，动作已经在 involvement 里，不再写进 domain。
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


def tag(value: object) -> str:
    """一条说法的规范写法：NFKC 折叠全半角，压掉多余空白。"""
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip(" ·,，;；")


def _keep(word: str, org: str) -> bool:
    # 公司名永远不进向量：专有名词在向量空间里和同类名字是邻居。模型偶尔会把
    # 公司名当领域吐回来，这里按原文的公司名兜一道。
    if not word or len(word) > MAX_TAG_LEN:
        return False
    return not (org and (word in org or org in word))


def _items(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def conform(raw: object, org: str) -> Extraction:
    """把模型的原话收窄成一份合法的抽取。收窄只丢单条，不丢整段。"""
    if not isinstance(raw, Mapping):
        return EMPTY
    skills: list[str] = []
    # 只认数组：字符串也可迭代，"Python" 会被拆成六个单字标签
    for item in _items(raw.get("skills")):
        skill = tag(item)
        if _keep(skill, org) and skill not in skills:
            skills.append(skill)
        if len(skills) == MAX_SKILLS:
            break
    did: list[tuple[str | None, str]] = []
    # 一段对同一个领域只留第一条：边的主键是（段、路、说法），领域就是说法
    for item in _items(raw.get("did")):
        if not isinstance(item, Mapping):
            continue
        involvement = tag(item.get("involvement"))
        domain = tag(item.get("domain"))
        if _keep(domain, org) and all(d != domain for _, d in did):
            did.append((involvement if involvement in INVOLVEMENTS else None, domain))
        if len(did) == MAX_DID:
            break
    return Extraction(tuple(skills), tuple(did))


def extract(rows: list[Mapping[str, str]]) -> list[Extraction]:
    """按入参顺序返回每段的抽取。只有入职前且有描述的段会去问端点。
    每行读 `kind`、`org`、`title`、`description` 四个键。
    """
    asked = [
        prompt_input(row)
        if row["kind"] == "external" and row["description"]
        else None
        for row in rows
    ]
    payloads = complete(SYSTEM, SCHEMA, [text for text in asked if text], "抽取")
    return [
        conform(payloads[text], row["org"]) if text and text in payloads else EMPTY
        for row, text in zip(rows, asked, strict=True)
    ]
