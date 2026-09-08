"""能力词的对照表：别名 → 标准词，ETL 每次灌库前自动整理。

抽出来的能力词是开放词表，同一项能力有好几种写法（「推荐算法」「个性化推荐」
「Recommendation」）。检索不在乎——它们在向量空间里本来就是邻居；在乎的是筛选栏
「入职前能力」那一栏（`src/search/dimensions.ts`）：它按词数人，写法不合并就是一串
各有一两个人的项，没法点。

整理在灌库前、抽取后做（`review`）：先按库里已有的对照表把这一轮的能力词换成
标准词，再把剩下的词按向量圈成组，每组问一次模型哪些只是同一项能力的不同写法，
合并的结果写回对照表（`skill_alias`，`src/db/schema.ts`），最后按合并后的表把
能力词换成标准词交给灌库。全程无人；对照表记的是关于词的决定，整库重灌不清它。

**向量圈组，模型下结论。** 相似度阈值只决定圈子多大，圈进了不相干的词由模型拆开
（「推荐系统」和「搜索推荐」是邻居，不是同一项能力）；模型每次只看一组几个词，不是
整份词表。标准词不由模型选：就是组心，这组里人最多的词——留给模型选的时候它会
把通用词并进具体词（「搜索」→「搜索结果页」）。模型只回答组里哪些词该并进组心。
并不并的判据是筛选栏的用法：招聘的人点标准词时想不想看到写了候选词的人——限定了
行业或对象的具体种类要并（「销售团队管理」→「团队管理」），只是其中一个环节的不并
（「团队培训」）。这条线小模型划不动，所以这一步用 `REVIEW_MODEL`。

**一个词一周只判一次。** 问过模型的组心记下时间，`REVIEW_INTERVAL` 之内不再做组心；
陪它一起被看的候选词不记——它们只是参考，下一轮可能自己做组心。这样每轮只问新词
和到期的词，重跑 ETL 不重问。

**只整理有读者的组。** 筛选栏按人数排，两个单人词合成一个双人词没人会点；组心
至少 `HEAD_MIN` 人的组才问模型。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np
import psycopg

import config as C
from chat import complete
from embed import embed
from extract import Extraction, tag

#: 组心问过模型之后多久才再做组心。
REVIEW_INTERVAL = timedelta(days=7)
#: 两个能力词的向量相似度到这个数才圈进同一组。bge-m3 上同一项能力的不同写法
#: 多在 0.8 以上；再低会把「数据分析」和「数据仓库」这种相邻领域圈到一起——
#: 模型能拆，但每组的词一多它就开始漏。
SIMILARITY = 0.8
#: 一组最多几个词。圈子再大就是阈值定低了，模型面对二十个词会成片地判成同一项。
GROUP_MAX = 12
#: 组心至少几个人才值得整理。
HEAD_MIN = 3

SYSTEM = """你在整理人才库从简历里抽出来的能力词，整理的结果给筛选栏用：招聘的人点一个标准词，看到所有具备这项能力的人。第一行是标准词，后面每行是一个候选词，括号里是写了它的人数。逐个判断每个候选词该不该并进标准词。

该并的：写了候选词的人，招聘的人按标准词找人时也会想看到他。
- 同一件事的不同写法：同义词、中英文、缩写、语序颠倒、多了「工作」「能力」「统筹」这类字。「人员管理」「员工管理」「小组管理」都并进「团队管理」。
- 标准词的一个具体种类，只是限定了行业、对象或产品：「销售团队管理」并进「团队管理」，「产品数据分析」并进「数据分析」，「品牌战略」并进「品牌策略」。

不该并的：
- 只是标准词里的某一个环节或活动，做过它不等于具备整项能力：「团队培训」「团队建设」「团队 SOP 管理」不并进「团队管理」；「数据统计」「数据处理」「数据分析报告」不并进「数据分析」。
- 相邻的另一件事，招聘时是另一个要求：「营销策略」「销售策略」不并进「运营策略」；「品牌营销」「广告策略」不并进「品牌策略」。
- 比标准词更宽的词：「增长」不并进「用户增长」，「管理」不并进「团队管理」。

每个候选词先用一句话说它属于上面哪一种，再下结论。输出 JSON：
{"judgments": [{"word": "候选词", "why": "一句话", "alias": true 或 false}]}
候选词原样照抄，每个候选词都要有一条。"""

#: 逐词给理由再下结论，不是直接列名单：让模型一次列名单，它面对十来个相近的候选
#: 会整片说是或整片说否；逐词说完理由再判，每个词各判各的。理由只为约束判断，
#: 收窄时不读。
SCHEMA = {
    "type": "object",
    "properties": {
        "judgments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    "why": {"type": "string"},
                    "alias": {"type": "boolean"},
                },
                "required": ["word", "why", "alias"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["judgments"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class Decision:
    """一个词的决定：它的标准词（等于自己就是标准词）和上次整理的时间。"""

    canonical: str
    reviewed_at: datetime


Table = dict[str, Decision]


def read(cur: psycopg.Cursor) -> Table:
    cur.execute("select word, canonical, reviewed_at from skill_alias")
    table = {word: Decision(canonical, reviewed_at) for word, canonical, reviewed_at in cur}
    # 别名的标准词自己又是别名：`merge` 不会写出这种行，出现就是表被手改坏了，
    # 出声拒绝——静默取其一只会让筛选栏少一批人而没人知道
    chained = sorted(
        word
        for word, d in table.items()
        if d.canonical != word
        and d.canonical in table
        and table[d.canonical].canonical != d.canonical
    )
    if chained:
        raise SystemExit(f"skill_alias 表里 {'、'.join(chained)} 的标准词自己又是别名，表被改坏了")
    return table


def write(cur: psycopg.Cursor, table: Table, words: Iterable[str]) -> None:
    """把这些词的决定写回表。"""
    cur.executemany(
        "insert into skill_alias (word, canonical, reviewed_at) values (%s, %s, %s)"
        " on conflict (word) do update set canonical = excluded.canonical,"
        " reviewed_at = excluded.reviewed_at",
        [(word, table[word].canonical, table[word].reviewed_at) for word in words],
    )


def mapping(table: Table) -> dict[str, str]:
    """别名 → 标准词，只含真正要换的词。"""
    return {word: d.canonical for word, d in table.items() if d.canonical != word}


def apply(aliases: Mapping[str, str], extraction: Extraction) -> Extraction:
    """把一段的能力词换成标准词，换完重复的只留一个。做过的事的领域不动。"""
    skills: list[str] = []
    for skill in extraction.skills:
        canonical = aliases.get(skill, skill)
        if canonical not in skills:
            skills.append(canonical)
    return Extraction(tuple(skills), extraction.did)


def groups(
    words: list[str], counts: list[int], vectors: np.ndarray, due: set[str]
) -> list[list[str]]:
    """把相似的词圈成组，每组第一个词是组心，后面至少一个候选。

    人最多的词先做组心，把还没分组、和它相似度够的词收进来。组和组不串：
    「数据分析 - 数据监控 - 监控告警」这种一环扣一环的链不会连成一大组。
    只有 `due` 里的词做组心；人不够 `HEAD_MIN` 的词也不做组心，只能被收进别人的组。
    """
    unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
    order = sorted(range(len(words)), key=lambda i: (-counts[i], words[i]))
    free = np.ones(len(words), dtype=bool)
    out: list[list[str]] = []
    for head in order:
        if counts[head] < HEAD_MIN:
            break
        if not free[head] or words[head] not in due:
            continue
        free[head] = False
        similar = unit @ unit[head]
        members = [i for i in order if free[i] and similar[i] >= SIMILARITY][: GROUP_MAX - 1]
        if members:
            free[members] = False
            out.append([words[head], *(words[i] for i in members)])
    return out


def conform(raw: object, group: list[str]) -> list[str]:
    """把模型的原话收窄成组心的别名：只认组里的候选词里判成 true 的，其余当模型没说。"""
    if not isinstance(raw, Mapping):
        return []
    judgments = raw.get("judgments")
    out: list[str] = []
    for item in judgments if isinstance(judgments, list) else []:
        if not isinstance(item, Mapping) or item.get("alias") is not True:
            continue
        word = tag(item.get("word"))
        if word in group[1:] and word not in out:
            out.append(word)
    return out


def merge(table: Table, head: str, aliases: list[str], now: datetime) -> list[str]:
    """记下这一组的结论，返回决定变了的词。

    组心问过就记时间；并进来的词对到组心，此前对到它们的词也一起改指组心，
    表里于是不会出现「别名的别名」。
    """
    changed = [head]
    table[head] = Decision(head, now)
    for alias in aliases:
        for word, d in table.items():
            if d.canonical == alias:
                table[word] = Decision(head, now)
                changed.append(word)
        table[alias] = Decision(head, now)
        changed.append(alias)
    return list(dict.fromkeys(changed))


def _prompt_input(group: list[str], count: Mapping[str, int]) -> str:
    head, *candidates = group
    return "\n".join([f"标准词：{head}", *(f"{word}（{count[word]} 人）" for word in candidates)])


def _vocabulary(
    extractions: list[Extraction], emp_ids: list[str]
) -> tuple[list[str], list[int]]:
    """这一轮的能力词和各自的人数。"""
    people: dict[str, set[str]] = {}
    for extraction, emp_id in zip(extractions, emp_ids, strict=True):
        for skill in extraction.skills:
            people.setdefault(skill, set()).add(emp_id)
    words = sorted(people)
    return words, [len(people[w]) for w in words]


def review(
    cur: psycopg.Cursor, extractions: list[Extraction], emp_ids: list[str]
) -> list[Extraction]:
    """整理这一轮的能力词，返回换成标准词之后的抽取结果。过程打印，决定写回表。"""
    now = datetime.now(UTC)
    table = read(cur)
    extractions = [apply(mapping(table), e) for e in extractions]
    words, counts = _vocabulary(extractions, emp_ids)
    print(f"  能力词 {len(words)} 个，对照表已有 {len(table)} 个词的决定；整理模型 {C.REVIEW_MODEL}")
    if not words:
        return extractions
    due = {
        w for w in words if w not in table or now - table[w].reviewed_at >= REVIEW_INTERVAL
    }
    circles = groups(words, counts, np.array(embed(words), dtype=np.float32), due)
    print(
        f"  组心至少 {HEAD_MIN} 人、相似度 {SIMILARITY} 以上、"
        f"{REVIEW_INTERVAL.days} 天内没整理过，圈成 {len(circles)} 组"
    )
    count = dict(zip(words, counts, strict=True))
    inputs = [_prompt_input(group, count) for group in circles]
    payloads = complete(C.REVIEW_MODEL, SYSTEM, SCHEMA, inputs, "整理")
    changed: list[str] = []
    merged: list[tuple[str, str]] = []
    for group, text in zip(circles, inputs, strict=True):
        if text not in payloads:
            continue
        aliases = conform(payloads[text], group)
        changed += merge(table, group[0], aliases, now)
        merged += [(alias, group[0]) for alias in aliases]
    write(cur, table, dict.fromkeys(changed))
    print(f"  合并 {len(merged)} 个写法：")
    for alias, canonical in merged:
        print(f"    {alias} → {canonical}")
    return [apply(mapping(table), e) for e in extractions]
