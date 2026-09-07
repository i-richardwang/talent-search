"""通用管线：源契约的三张表 → 库里的 employee / experience 两张表。

这里不出现任何一家公司的字段名、字典码或组织名。它只做「无论数据从哪来都
必须做」的那几件事：

1. 区间合法性——日期格式错误、没有开始日、结束早于开始、生效日在未来的记录
   一律**拒绝导入并报出数量**，不猜日期，也不靠 `max(1, ...)` 把错误区间伪装
   成一月经历；
2. 开放区间封口——公司内开放段计算时封到 `as_of`，入职前开放段封到入职日；
3. 相邻段合并——`segment_key` 相同且时间连续或重叠的记录合成一段经历；
4. 时长与当前信息派生。

这几件事只写一遍，接第二个数据源时才不会长出第二套「什么算一段经历」。
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Protocol

import pandas as pd
from pandas.api.types import is_bool

from contract import SourceData

EMPLOYEE_OUT = [
    "emp_id",
    "name",
    "cur_dept",
    "cur_title",
    "cur_seq_l1",
    "cur_seq_l2",
    "cur_seq_l3",
    "cur_level",
    "hire_date",
    "education_level",
    "school",
    "recruitment",
]

EXPERIENCE_OUT = [
    "emp_id",
    "kind",
    "start_date",
    "end_date",
    "org",
    "org_path",
    "org_meta",
    "title",
    "seq_l1",
    "seq_l2",
    "seq_l3",
    "level",
    "description",
    "months",
]

TEXT_FIELDS = ["org", "org_path", "title", "level", "seq_l1", "seq_l2", "seq_l3"]

#: 待业段的岗位显示。它不是一个岗位名，是「这段时间没有工作」的表达。
UNEMPLOYED = "待业"


def clean_scalar(value: object) -> str:
    """任何标量 → 干净的字符串。缺失值变空串，绝不变成字面量 "nan"。"""
    return "" if pd.isna(value) else str(value).strip()


def duration_months(start: pd.Timestamp, end: pd.Timestamp) -> int:
    """把一个**已经校验过**的闭区间换算成月数。

    非法区间在这里抛错而不是兜底：能走到这一步说明上面的校验漏了，
    悄悄返回 1 会让一段错数据以合法经历的样子进库。
    """
    if pd.isna(start) or pd.isna(end) or end < start:
        raise ValueError(f"无效日期区间：{start} — {end}")
    months = round(((end - start).days + 1) / 30.44)
    return months if months > 0 else 1


def _parse_dates(
    frame: pd.DataFrame, *columns: str
) -> tuple[pd.DataFrame, pd.Series]:
    """解析日期，并单独返回「有原值但解析失败」的行。

    空值是契约允许的未知或开放区间；格式错误不是。两者不能都收成 NaT，否则
    错误结束日会被当成开放区间封口，错误历史段会被当成当前经历。
    """
    out = frame.copy()
    invalid = pd.Series(False, index=out.index)
    for column in columns:
        raw = out[column]
        blank = raw.isna() | raw.map(
            lambda value: isinstance(value, str) and not value.strip()
        )
        parsed = pd.to_datetime(raw.mask(blank), errors="coerce")
        invalid |= ~blank & parsed.isna()
        out[column] = parsed
    return out, invalid


def _text(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    out = frame.copy()
    for column in columns:
        out[column] = out[column].map(clean_scalar)
    return out


def _reject(
    frame: pd.DataFrame, bad: pd.Series, why: str, unit: str = "段"
) -> pd.DataFrame:
    """剔除并报数。**拒绝必须报告**——静默丢数据的管线没人能验收。

    经历按段数，员工档案按行数：报告里的量词得和被拒的东西对得上。
    """
    if bad.any():
        print(f"  {why} {int(bad.sum())} {unit}，已拒绝导入")
    return frame[~bad].copy()


# ------------------------------------------------------------------ 公司内经历


def build_internal(rows: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    dated, invalid = _parse_dates(rows, "start_date", "end_date")
    out = _text(dated, TEXT_FIELDS)
    out["segment_key"] = out.segment_key.map(clean_scalar)

    out = _reject(out, invalid, "公司内经历日期格式无效")
    out = _reject(out, out.start_date.isna(), "公司内经历缺少开始日期")
    out = _reject(out, out.start_date > as_of, "公司内经历生效日在未来")
    out = _reject(
        out,
        out.end_date.notna() & (out.end_date > as_of),
        "公司内经历结束日在未来",
    )
    out = _reject(
        out,
        out.end_date.notna() & (out.end_date < out.start_date),
        "公司内经历日期倒置",
    )

    missing_key = out.segment_key == ""
    if missing_key.any():
        print(
            f"  公司内经历缺少 segment_key {int(missing_key.sum())} 段，已保留为独立经历"
        )

    out = _merge_adjacent(out.sort_values(["emp_id", "start_date"]), as_of)
    out["kind"] = "internal"
    out["description"] = ""
    out["org_meta"] = None
    return out


def _merge_adjacent(rows: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    """合并 `segment_key` 相同的相邻段，并按合并后的区间重算时长。

    相同 key 只说明内容相同；时间连续或重叠才说明它们是同一段经历。合并区间取
    最早开始和最晚结束，只要其中一段开放，合并结果就开放；重算时长封到 `as_of`。
    """
    # 空表不能走下面的分组：`pd.DataFrame([], columns=...)` 会把日期列退回
    # object，之后按开始日排序的就不再是日期。
    if rows.empty:
        out = rows.copy()
        out["months"] = pd.Series(dtype="int64")
        return out.reset_index(drop=True)

    df = rows.sort_values(
        ["emp_id", "segment_key", "start_date", "end_date"], na_position="last"
    ).copy()
    df["_merge_key"] = [
        ("segment", key) if key else ("row", index)
        for index, key in zip(df.index, df.segment_key, strict=True)
    ]
    merged_rows: list[dict] = []
    for _, same_segment in df.groupby(["emp_id", "_merge_key"], sort=False):
        current: dict | None = None
        for row in same_segment.drop(columns="_merge_key").to_dict("records"):
            if current is None:
                current = row
                continue
            current_end = as_of if pd.isna(current["end_date"]) else current["end_date"]
            if row["start_date"] > current_end + timedelta(days=1):
                merged_rows.append(current)
                current = row
                continue
            current["end_date"] = (
                pd.NaT
                if pd.isna(current["end_date"]) or pd.isna(row["end_date"])
                else max(current["end_date"], row["end_date"])
            )
        if current is not None:
            merged_rows.append(current)

    merged = pd.DataFrame(merged_rows, columns=rows.columns)
    merged["months"] = [
        duration_months(
            pd.Timestamp(row.start_date),
            as_of if pd.isna(row.end_date) else pd.Timestamp(row.end_date),
        )
        for row in merged.itertuples()
    ]
    merged_count = len(df) - len(merged)
    if merged_count:
        print(f"  合并内容相同的相邻段 {merged_count} 条")
    return merged.sort_values(["emp_id", "start_date"]).reset_index(drop=True)


# ------------------------------------------------------------------ 入职前经历


def build_external(
    rows: pd.DataFrame, hire_dates: dict[str, pd.Timestamp]
) -> pd.DataFrame:
    dated, invalid = _parse_dates(rows, "start_date", "end_date")
    out = _text(
        dated,
        ["org", "title", "description", "company_tag", "industry", "nature"],
    )
    out = _reject(out, invalid, "入职前经历日期格式无效")
    valid_unemployed = out.unemployed.isna() | out.unemployed.map(is_bool)
    out = _reject(out, ~valid_unemployed, "入职前经历待业标记无效")
    out["unemployed"] = out.unemployed.map(
        lambda value: False if pd.isna(value) else bool(value)
    )
    out = _reject(out, out.start_date.isna(), "入职前经历缺少开始日期")
    out = close_external_intervals(out, hire_dates)
    out = _reject(
        out,
        out.end_date.notna() & (out.end_date < out.start_date),
        "入职前经历日期倒置",
    )
    # 入职前经历不能越过已知入职日；开放区间封到入职日的边界合法。
    hire = pd.to_datetime(out.emp_id.map(hire_dates), errors="coerce")
    out = _reject(
        out,
        out.end_date.notna() & hire.notna() & (out.end_date > hire),
        "入职前经历结束日晚于入职日",
    )

    out["title"] = out.title.where(~out.unemployed, UNEMPLOYED)
    out["description"] = out.description.where(~out.unemployed, "")
    out["org_meta"] = [_org_meta(row) for row in out.itertuples()]
    out["months"] = [
        duration_months(row.start_date, row.end_date) for row in out.itertuples()
    ]
    out["kind"] = "external"
    for column in ("org_path", "level", "seq_l1", "seq_l2", "seq_l3"):
        out[column] = ""
    return out.reset_index(drop=True)


def close_external_intervals(
    rows: pd.DataFrame, hire_dates: dict[str, pd.Timestamp]
) -> pd.DataFrame:
    """用入职日封住入职前经历的开放区间；封不上的不导入。

    「一直干到入职这家公司为止」是这段经历唯一说得通的读法；连入职日都没有时
    区间就没有边界，猜一个出来等于凭空造经历。
    """
    out = rows.copy()
    open_ended = out.end_date.isna()
    if open_ended.any():
        out.loc[open_ended, "end_date"] = out.loc[open_ended, "emp_id"].map(hire_dates)
    return _reject(
        out, open_ended & out.end_date.isna(), "入职前经历缺少结束日且无入职日"
    )


class _CompanyRow(Protocol):
    """`_org_meta` 只读这三项。`itertuples` 的行是动态命名元组，按结构声明。"""

    company_tag: str
    industry: str
    nature: str


def _org_meta(row: _CompanyRow) -> str | None:
    """公司属性只存非空项。整体为空时写 NULL，不写 `{}`。"""
    meta = {
        "company_tag": row.company_tag,
        "industry": row.industry,
        "nature": row.nature,
    }
    meta = {k: v for k, v in meta.items() if v}
    return json.dumps(meta, ensure_ascii=False) if meta else None


# -------------------------------------------------------------------- 员工表


def _normalize_employee_rows(rows: pd.DataFrame) -> pd.DataFrame:
    fields = ["emp_id", "name", "education_level", "school", "recruitment"]
    dated, invalid_hire_date = _parse_dates(rows, "hire_date")
    out = _text(dated, fields)
    if invalid_hire_date.any():
        print(
            f"  员工档案入职日期格式无效 {int(invalid_hire_date.sum())} 行，入职日已留空"
        )
    return out


def build_employee(rows: pd.DataFrame, internal: pd.DataFrame) -> pd.DataFrame:
    """档案字段来自归一化后的源行，`cur_*` 一律从唯一的开放公司内经历派生。

    行在进来之前已经过 `_normalize_employee_rows`：归一化是每一批档案都要做的
    第一件事，做在入口一次，这里再做一遍就是同一件事有两个位置。

    当前部门、岗位、序列、职级不从源的快照里另取一份：那样库里就有两个「他现在
    在哪」，而时间线和结果行会各读一个。没有开放段就没有当前岗位；同时存在多段
    开放经历时，单值当前字段无法表达事实，因此留空并报出数据冲突，不猜一段。
    """
    out = rows.sort_values("emp_id").set_index("emp_id")

    active = internal[internal.end_date.isna()]
    ambiguous = active.emp_id.value_counts()
    ambiguous = set(ambiguous[ambiguous > 1].index)
    if ambiguous:
        shown = "、".join(sorted(ambiguous)[:5]) + ("…" if len(ambiguous) > 5 else "")
        print(f"  当前公司内经历冲突 {len(ambiguous)} 人（{shown}），当前字段已留空")
        active = active[~active.emp_id.isin(ambiguous)]
    current = active.set_index("emp_id").reindex(out.index)

    return pd.DataFrame(
        {
            "emp_id": out.index,
            "name": out.name.values,
            "cur_dept": current.org.fillna("").values,
            "cur_title": current.title.fillna("").values,
            "cur_seq_l1": current.seq_l1.fillna("").values,
            "cur_seq_l2": current.seq_l2.fillna("").values,
            "cur_seq_l3": current.seq_l3.fillna("").values,
            "cur_level": current.level.fillna("").values,
            "hire_date": out.hire_date.dt.date.values,
            "education_level": out.education_level.values,
            "school": out.school.values,
            "recruitment": out.recruitment.values,
        }
    )


# ---------------------------------------------------------------------- 入口


def build(
    data: SourceData, as_of: pd.Timestamp | None = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """源契约 → 可直接 COPY 进库的两张表。"""
    if as_of is None:
        as_of = pd.Timestamp.today().normalize()

    employees = _normalize_employee_rows(data.employees)
    employees = _reject(
        employees, employees.emp_id == "", "员工档案缺少工号", unit="行"
    )

    # 完全重复是导出毛刺；同工号冲突无法确定权威值，整个人退出本次人群。
    before = len(employees)
    employees = employees.drop_duplicates()
    if len(employees) < before:
        print(f"  员工档案整行重复 {before - len(employees)} 行，已去重")
    conflict = employees.emp_id.duplicated(keep=False)
    if conflict.any():
        ids = sorted(set(employees.emp_id[conflict]))
        shown = "、".join(ids[:5]) + ("…" if len(ids) > 5 else "")
        print(f"  员工档案字段冲突 {len(ids)} 人（{shown}），已连同其经历拒绝导入")
        employees = employees[~conflict]

    population = set(employees.emp_id)
    print(f"  人群 {len(population)} 人")

    assignments = _in_population(data.assignments, population, "公司内经历")
    external = _in_population(data.external, population, "入职前经历")

    internal = build_internal(assignments, as_of)
    print(f"  公司内 {len(internal)} 段")

    employee = build_employee(employees, internal)
    hire_dates = {
        row.emp_id: pd.Timestamp(row.hire_date)
        for row in employee.itertuples()
        if pd.notna(row.hire_date)
    }

    outside = build_external(external, hire_dates)
    idle = int((outside.title == UNEMPLOYED).sum())
    print(f"  入职前 {len(outside)} 段（其中待业 {idle} 段）")

    parts = [
        frame.reindex(columns=EXPERIENCE_OUT)
        for frame in (internal, outside)
        if not frame.empty
    ]
    experience = (
        pd.concat(parts, ignore_index=True)
        if parts
        else pd.DataFrame(columns=EXPERIENCE_OUT)
    )
    experience = experience.sort_values(["emp_id", "start_date"]).reset_index(drop=True)
    return employee.reindex(columns=EMPLOYEE_OUT), experience


def _in_population(
    rows: pd.DataFrame, population: set[str], what: str
) -> pd.DataFrame:
    """人群由 `employees` 说了算：经历表里指向库外的人一律丢弃。

    留着它们只会撞上 `experience.emp_id` 的外键，报一条读不懂的数据库错误。
    """
    out = rows.copy()
    out["emp_id"] = out.emp_id.map(clean_scalar)
    outside = ~out.emp_id.isin(population)
    if outside.any():
        print(f"  {what} 有 {int(outside.sum())} 段不属于本次人群，已忽略")
    return out[~outside].copy()
