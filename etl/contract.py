"""源契约：适配器要交出什么，管线才接得住。

这是公开仓库与具体人事数据之间**唯一**的接口。任何一套 HR 数据，只要能填出
下面三张表，就能接进来；反过来，管线只认这三张表，不认任何一家公司的表名、
字段名或字典码——那些一律留在 `sources/` 下的适配器里。

三张表刻意都是「已经摊平的事实」，不是某个系统的原始形态：

- `employees`   人群与档案。**谁在这张表里，谁就进库**，人群口径是适配器的事；
- `assignments` 公司内任职段，一段一行，切段规则是适配器的事；
- `external`    入职前经历，一段一行。

管线负责的是三张表都逃不掉的那部分：区间合法性、开放区间封口、相邻段合并、
时长计算、当前信息派生。这些不该在每接一个数据源时重写一遍——重写一遍就会
出现两套「什么算一段经历」。
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

#: 一人一行。`emp_id` 是全库主键，其余是详情页会读的档案字段。
EMPLOYEE_COLUMNS = [
    "emp_id",
    "name",
    "hire_date",
    "education_level",
    "school",
    "recruitment",
]

#: 公司内任职段，一段一行。`end_date` 留空表示至今。
#:
#: `segment_key` 是「这两段是不是同一件事」的判据，只被相邻段合并读。源系统里
#: 部门被重新登记、或一次异动被拆成两条时，会切出内容相同的相邻段——它们不是
#: 两段经历。判据只有源自己知道（组织 id + job code 比中文名可靠），所以由
#: 适配器给；没有更好的东西时填 `org` + `title` 也是成立的。
ASSIGNMENT_COLUMNS = [
    "emp_id",
    "start_date",
    "end_date",
    "org",
    "org_path",
    "title",
    "level",
    "seq_l1",
    "seq_l2",
    "seq_l3",
    "segment_key",
]

#: 入职前经历，一段一行。`end_date` 留空的用入职日封口。
#:
#: `unemployed` 为真时岗位显示为「待业」且不接描述：待业段要保留（它解释了
#: 履历上的空档），但它不是一段可检索的经历。
EXTERNAL_COLUMNS = [
    "emp_id",
    "start_date",
    "end_date",
    "org",
    "title",
    "description",
    "company_tag",
    "industry",
    "nature",
    "unemployed",
]


def conform(frame: pd.DataFrame, columns: list[str], what: str) -> pd.DataFrame:
    """按契约列裁齐一张表；缺列直接报到人看得懂。

    多出来的列丢掉，缺的列报错——适配器算中间值很正常，但它们不许顺着管线漏
    进库里（见 AGENTS.md「不落没有读者的列」）。
    """
    missing = [c for c in columns if c not in frame.columns]
    if missing:
        raise SystemExit(f"数据源的 {what} 缺少契约列：{'、'.join(missing)}")
    return frame.reindex(columns=columns)


@dataclass(frozen=True)
class SourceData:
    """一次抽取的全部产出。适配器的 `extract()` 返回它。"""

    employees: pd.DataFrame
    assignments: pd.DataFrame
    external: pd.DataFrame

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "employees", conform(self.employees, EMPLOYEE_COLUMNS, "employees")
        )
        object.__setattr__(
            self,
            "assignments",
            conform(self.assignments, ASSIGNMENT_COLUMNS, "assignments"),
        )
        object.__setattr__(
            self, "external", conform(self.external, EXTERNAL_COLUMNS, "external")
        )
