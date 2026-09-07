"""入职前经历 → 公司序列。

序列是受控字段：公司内任职段自带 HR 登记的序列三级，入职前的段只有岗位名、
公司名和（三成的人有的）简历描述。序列筛选如果只认登记，「找做过算法的人」
就看不见入职前在别处做算法的那几年。这里让模型把每个入职前的段对到公司序列树
上的一对一级二级，写进 `seq_inferred_l1 / seq_inferred_l2` 两列，序列筛选读
「登记的，没有就读对齐的」（`src/search/search.ts` 的 `FACT_COLUMNS`）。

**对齐的结果只进筛选，不做证据。** 登记的序列进 `seq` 那一路、按受控强度打分；
对齐的不进任何一路——它是推断，混进打分会和 HR 登记的可信度分不开。
`seq_l1..3` 三列因此永远只有登记值，对齐值另住两列（论证见 `src/db/schema.ts`）。

**封闭集合，宁可漏不可错。** 序列树从当前语料的公司内任职段取（不另维护一份）；
模型只能选树上存在的一对，要么两级都给，要么两级都空。二级拿不准的段就是空——
用户按二级筛时它不出现，比对错了出现在名单上好；简历里的脏数据、公司没有的
业务（「无法对齐」）也是空，这是合法结果，不是失败。
"""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping

import pandas as pd

from chat import complete
from extract import prompt_input
from pipeline import UNEMPLOYED

SeqPair = tuple[str, str]

SCHEMA = {
    "type": "object",
    "properties": {"l1": {"type": "string"}, "l2": {"type": "string"}},
    "required": ["l1", "l2"],
    "additionalProperties": False,
}


def seq_tree(experience: pd.DataFrame) -> list[SeqPair]:
    """公司内任职段登记过的（一级，二级）全集，去重排序。只有一级的登记不算：
    对齐要的是能进筛选的一对，而序列筛选只认成对的值。"""
    internal = experience[experience.kind == "internal"]
    pairs = {
        (l1, l2)
        for l1, l2 in zip(internal.seq_l1, internal.seq_l2, strict=True)
        if l1 and l2
    }
    return sorted(pairs)


def system_prompt(tree: list[SeqPair]) -> str:
    listing = "\n".join(f"- {l1} · {l2}" for l1, l2 in tree)
    return f"""你在读一段员工入职前的工作经历，判断这段经历在本公司会属于哪个序列。本公司的序列（一级 · 二级）只有下面这些：

{listing}

输出 JSON：{{"l1": "一级", "l2": "二级"}}

- 只能从上面的列表里选，一级和二级必须是同一行的一对，名字照抄。
- 判断依据是岗位名和描述里实际做的事；公司名只用来理解行业，不能单凭公司名判断。
- 多数经历只有岗位名，没有描述，这是正常的：岗位名本身说明了做什么（产品经理、客服、数据分析师、Java 开发）就按岗位名判断，不因为没有描述而放弃。
- 同一个一级下有几个二级时，选岗位名字面最贴近的那个；二级名就是这类岗位的通称时直接选它。
- 只有岗位名说明不了做什么（经理、专员、管培生、合伙人）、列表里没有相应的序列、或者经历与列表里任何序列都不相关时，l1 和 l2 才都给空字符串。不要硬选一个最接近的。"""


def _name(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return unicodedata.normalize("NFKC", value).strip()


def conform(raw: object, tree: set[SeqPair]) -> SeqPair:
    """把模型的原话收窄成树上的一对，不在树上就是（"", ""）。"""
    if not isinstance(raw, Mapping):
        return "", ""
    pair = (_name(raw.get("l1")), _name(raw.get("l2")))
    return pair if pair in tree else ("", "")


def align(experience: pd.DataFrame) -> pd.DataFrame:
    """把对到了的入职前段写进 `seq_inferred_l1 / seq_inferred_l2`；其余段保持空。

    待业段没有岗位可对，不去问。序列树写在提示词里，也就在缓存的键里：树变了，
    旧回答是对着另一棵树给的，自然失效。
    """
    out = experience.copy()
    tree = seq_tree(out)
    if not tree:
        print("  语料里没有登记的序列，入职前经历无法对齐")
        return out

    asked = out.index[(out.kind == "external") & (out.title != UNEMPLOYED)]
    texts = [prompt_input(out.loc[i]) for i in asked]
    payloads = complete(system_prompt(tree), SCHEMA, texts, "对齐")
    tree_set = set(tree)
    aligned = 0
    for i, text in zip(asked, texts, strict=True):
        l1, l2 = conform(payloads.get(text), tree_set)
        if l1:
            aligned += 1
            out.loc[i, ["seq_inferred_l1", "seq_inferred_l2"]] = [l1, l2]
    print(f"  入职前 {len(asked)} 段里 {aligned} 段对到了公司序列，其余无法对齐")
    return out
