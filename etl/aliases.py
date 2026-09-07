"""能力词的对照表：别名 → 标准词。

抽出来的能力词是开放词表，同一项能力有好几种写法（「推荐算法」「个性化推荐」
「Recommendation」）。检索不在乎——它们在向量空间里本来就是邻居；在乎的是筛选栏
「入职前能力」那一栏（`src/search/dimensions.ts`）：它按词数人，写法不合并就是一串
各有一两个人的项，没法点。

对照表是人维护的一份 CSV（`alias,canonical` 两列），和数据源放在一起、不进版本库
（`SKILL_ALIASES`）。这个模块两用：

- ETL 读它（`read`），灌库前把每段的能力词换成标准词（`apply`）；没有这份文件
  就不归并，`load.py` 打印说明后照常灌库。
- 直接运行它是整理工具：读库里的能力词和向量，相似的圈成一组，每组问一次模型
  哪些只是同一项能力的不同写法，模型的建议追加进对照表并打印出来。已有的行一律
  不动——人改过、删过的就是最终决定。改完重跑 ETL 才生效。

**向量圈组，模型下结论，人有否决权。** 相似度阈值只决定圈子多大，圈进了不相干的词
由模型拆开（「推荐系统」和「搜索推荐」是邻居，不是同一项能力）；模型每次只看一组
几个词，不是整份词表。标准词不由模型选：就是组心，这组里人最多的词——留给模型
选的时候它会把通用词并进具体词（「搜索」→「搜索结果页」）。模型只回答组里哪些词
和组心是同一项能力。

**只整理有读者的组。** 筛选栏按人数排，两个单人词合成一个双人词没人会点；组心
至少 `HEAD_MIN` 人的组才问模型，建议的行数也才是人看得完的量。
"""

from __future__ import annotations

import csv
import json
from collections.abc import Mapping
from pathlib import Path

import numpy as np
import psycopg

import config as C
from chat import complete
from extract import Extraction, tag

#: 两个能力词的向量相似度到这个数才圈进同一组。bge-m3 上同一项能力的不同写法
#: 多在 0.8 以上；再低会把「数据分析」和「数据仓库」这种相邻领域圈到一起——
#: 模型能拆，但每组的词一多它就开始漏。
SIMILARITY = 0.8
#: 一组最多几个词。圈子再大就是阈值定低了，模型面对二十个词会成片地判成同一项。
GROUP_MAX = 12
#: 组心至少几个人才值得整理。
HEAD_MIN = 3

SYSTEM = """你在整理人才库从简历里抽出来的能力词。第一行是标准词，后面每行是一个候选词，括号里是写了它的人数。判断哪些候选词和标准词说的是同一项能力、只是写法不同（同义词、中英文、缩写、多了无意义的修饰）。

输出 JSON：{"aliases": ["候选词一", "候选词二"]}

- 只放和标准词是同一项能力的候选词，原样照抄。
- 相关但不是同一项能力的不放：标准词的下位词或上位词（「推荐系统」和「视频推荐」）、相邻的另一件事（「推荐系统」和「搜索推荐」，「Python」和「数据分析」）都不是。
- 一个都不是就给空数组。"""

SCHEMA = {
    "type": "object",
    "properties": {"aliases": {"type": "array", "items": {"type": "string"}}},
    "required": ["aliases"],
    "additionalProperties": False,
}


def read(path: Path) -> dict[str, str]:
    """对照表：别名 → 标准词。文件不存在就是空表。

    写坏的表出声拒绝，不猜：一条别名两个标准词、标准词自己又是别名（链）、别名
    等于标准词，都是人在文件里写错了，静默取其一只会让筛选栏少一批人而没人知道。
    """
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    with path.open(encoding="utf-8", newline="") as f:
        for number, row in enumerate(csv.DictReader(f), start=2):
            alias, canonical = tag(row.get("alias")), tag(row.get("canonical"))
            if not alias or not canonical or alias == canonical:
                raise SystemExit(f"{path} 第 {number} 行：alias 和 canonical 都要有，且不能相同")
            if alias in out and out[alias] != canonical:
                raise SystemExit(f"{path} 第 {number} 行：{alias} 已对到 {out[alias]}，不能再对到 {canonical}")
            out[alias] = canonical
    chained = sorted(c for c in set(out.values()) if c in out)
    if chained:
        raise SystemExit(
            f"{path}：{'、'.join(chained)} 既是标准词又是别名。一个词只能是其中一种，"
            "把指向它的行改成指向它的标准词"
        )
    return out


def apply(table: Mapping[str, str], extraction: Extraction) -> Extraction:
    """把一段的能力词换成标准词，换完重复的只留一个。做过的事的领域不动。"""
    skills: list[str] = []
    for skill in extraction.skills:
        canonical = table.get(skill, skill)
        if canonical not in skills:
            skills.append(canonical)
    return Extraction(tuple(skills), extraction.did)


def write(path: Path, table: Mapping[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["alias", "canonical"])
        for alias, canonical in sorted(table.items(), key=lambda kv: (kv[1], kv[0])):
            writer.writerow([alias, canonical])


def groups(
    words: list[str], counts: list[int], vectors: np.ndarray
) -> list[list[str]]:
    """把相似的词圈成组，每组第一个词是组心，后面至少一个候选。

    人最多的词先做组心，把还没分组、和它相似度够的词收进来。组和组不串：
    「数据分析 - 数据监控 - 监控告警」这种一环扣一环的链不会连成一大组。
    人不够 `HEAD_MIN` 的词不做组心，只能被收进别人的组。
    """
    unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
    order = sorted(range(len(words)), key=lambda i: (-counts[i], words[i]))
    free = np.ones(len(words), dtype=bool)
    out: list[list[str]] = []
    for head in order:
        if counts[head] < HEAD_MIN:
            break
        if not free[head]:
            continue
        free[head] = False
        similar = unit @ unit[head]
        members = [
            i for i in order if free[i] and similar[i] >= SIMILARITY
        ][: GROUP_MAX - 1]
        if members:
            free[members] = False
            out.append([words[head], *(words[i] for i in members)])
    return out


def conform(raw: object, group: list[str]) -> list[str]:
    """把模型的原话收窄成组心的别名：只认组里的候选词，其余当模型没说。"""
    if not isinstance(raw, Mapping):
        return []
    proposed = raw.get("aliases")
    return [
        alias
        for alias in dict.fromkeys(tag(a) for a in (proposed if isinstance(proposed, list) else []))
        if alias in group[1:]
    ]


def _prompt_input(group: list[str], count: Mapping[str, int]) -> str:
    head, *candidates = group
    return "\n".join([f"标准词：{head}", *(f"{word}（{count[word]} 人）" for word in candidates)])


def _vocabulary() -> tuple[list[str], list[int], np.ndarray]:
    """库里的能力词、各自的人数与向量。"""
    with psycopg.connect(C.require_database_url()) as conn:
        rows = conn.execute(
            "select p.text, p.embedding::text, count(distinct e.emp_id)"
            " from phrase p"
            " join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'"
            " join experience e on e.id = ep.experience_id"
            " group by p.id order by p.text"
        ).fetchall()
    words = [text for text, _, _ in rows]
    counts = [int(n) for _, _, n in rows]
    vectors = np.array([json.loads(vec) for _, vec, _ in rows], dtype=np.float32)
    return words, counts, vectors


def merge(
    table: dict[str, str], proposals: list[tuple[str, list[str]]]
) -> tuple[list[tuple[str, str]], list[str]]:
    """把模型的建议并进对照表，返回（新增的行，没并进去的说明）。

    只加不改：已经在表里的别名是人定的；建议的标准词本身已是别名、或者建议的
    别名已是别人的标准词，并进去会成链，都留给人看。
    """
    added: list[tuple[str, str]] = []
    skipped: list[str] = []
    for canonical, aliases in proposals:
        if canonical in table:
            skipped.append(f"{canonical} 已是 {table[canonical]} 的别名，它下面的 {'、'.join(aliases)} 未并入")
            continue
        for alias in aliases:
            if alias in table:
                continue
            if alias in table.values():
                skipped.append(f"{alias} 已是标准词，未并到 {canonical} 下")
                continue
            table[alias] = canonical
            added.append((alias, canonical))
    return added, skipped


def main() -> None:
    if not C.extract_configured():
        raise SystemExit("整理要问模型：请先配置 EXTRACT_BASE_URL 与 EXTRACT_MODEL")
    path = C.SKILL_ALIASES_PATH
    table = read(path)
    words, counts, vectors = _vocabulary()
    print(f"库里能力词 {len(words)} 个；对照表 {path} 已有 {len(table)} 行")
    if not words:
        return
    count = dict(zip(words, counts, strict=True))
    circles = groups(words, counts, vectors)
    print(f"组心至少 {HEAD_MIN} 人、相似度 {SIMILARITY} 以上，圈成 {len(circles)} 组，问模型…")
    inputs = [_prompt_input(group, count) for group in circles]
    payloads = complete(SYSTEM, SCHEMA, inputs, "整理")
    proposals = [
        (group[0], found)
        for group, text in zip(circles, inputs, strict=True)
        if (found := conform(payloads.get(text), group))
    ]
    added, skipped = merge(table, proposals)
    if added:
        write(path, table)
    print(f"\n{len(circles) - len(proposals)} 组里没有同一项能力的不同写法，不合并")
    for line in skipped:
        print(f"  {line}")
    print(f"新增 {len(added)} 行，已写进 {path}；看一遍，不对的改掉或删掉，然后重跑 ETL")
    for alias, canonical in added:
        print(f"  {alias} → {canonical}")


if __name__ == "__main__":
    main()
