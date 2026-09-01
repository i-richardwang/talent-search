"""通用管线：源契约的三张表 → 库里的 employee / experience 两张表。

这里不出现任何一家公司的字段名、字典码或组织名。它只做「无论数据从哪来都
必须做」的那几件事：

1. 区间合法性——没有开始日、结束早于开始、生效日在未来的记录一律**拒绝导入
   并报出数量**，不猜日期，也不靠 `max(1, ...)` 把错误区间伪装成一月经历；
2. 开放区间封口——公司内的末段封到 `as_of`，入职前的末段封到入职日；
3. 相邻段合并——`segment_key` 相同的相邻段是同一件事，不是两段经历；
4. 时长与当前信息派生。

这几件事只写一遍，接第二个数据源时才不会长出第二套「什么算一段经历」。
"""

from __future__ import annotations

import json
from datetime import timedelta

import pandas as pd

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


def _dates(frame: pd.DataFrame, *columns: str) -> pd.DataFrame:
    out = frame.copy()
    for column in columns:
        out[column] = pd.to_datetime(
            out[column].replace("", None), errors="coerce"
        )
    return out


def _text(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    out = frame.copy()
    for column in columns:
        out[column] = out[column].map(clean_scalar)
    return out


def _reject(frame: pd.DataFrame, bad: pd.Series, why: str) -> pd.DataFrame:
    """剔除并报数。**拒绝必须出声**——静默丢数据的管线没人能验收。"""
    if bad.any():
        print(f"  {why} {int(bad.sum())} 段，已拒绝导入")
    return frame[~bad].copy()


# ------------------------------------------------------------------ 公司内经历


def build_internal(rows: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    out = _text(_dates(rows, "start_date", "end_date"), TEXT_FIELDS)
    out["segment_key"] = out.segment_key.map(clean_scalar)

    out = _reject(out, out.start_date.isna(), "公司内经历缺少开始日期")
    out = _reject(out, out.start_date > as_of, "公司内经历生效日在未来")
    out = _reject(
        out,
        out.end_date.notna() & (out.end_date < out.start_date),
        "公司内经历日期倒置",
    )

    out = merge_adjacent(out.sort_values(["emp_id", "start_date"]), as_of)
    out["kind"] = "internal"
    out["description"] = ""
    out["org_meta"] = None
    return out


def merge_adjacent(rows: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    """合并 `segment_key` 相同的相邻段，并按合并后的区间重算时长。

    合并后的段取**第一段的起始**和**最后一段的结束**：末段结束为空表示至今，
    重算时长时封到 `as_of`。
    """
    if rows.empty:
        out = rows.copy()
        out["months"] = pd.Series(dtype="int64")
        return out.reset_index(drop=True)

    df = rows.reset_index(drop=True)
    key = df[["emp_id", "segment_key"]]
    group = (~(key == key.shift()).all(axis=1)).cumsum()

    agg = df.groupby(group).agg(
        {c: "first" for c in df.columns if c != "end_date"}
    )
    agg["end_date"] = df.groupby(group).end_date.apply(lambda v: v.iloc[-1])
    agg["months"] = [
        duration_months(
            pd.Timestamp(row.start_date),
            as_of if pd.isna(row.end_date) else pd.Timestamp(row.end_date),
        )
        for row in agg.itertuples()
    ]
    merged = len(df) - len(agg)
    if merged:
        print(f"  合并内容相同的相邻段 {merged} 条")
    return agg.reset_index(drop=True)


# ------------------------------------------------------------------ 入职前经历


def build_external(
    rows: pd.DataFrame, hire_dates: dict[str, pd.Timestamp]
) -> pd.DataFrame:
    out = _text(
        _dates(rows, "start_date", "end_date"),
        ["org", "title", "description", "company_tag", "industry", "nature"],
    )
    out["unemployed"] = out.unemployed.fillna(False).astype(bool)

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


def _org_meta(row) -> str | None:
    """公司属性只存非空项。整体为空时写 NULL，不写 `{}`。"""
    meta = {
        "company_tag": row.company_tag,
        "industry": row.industry,
        "nature": row.nature,
    }
    meta = {k: v for k, v in meta.items() if v}
    return json.dumps(meta, ensure_ascii=False) if meta else None


# -------------------------------------------------------------------- 员工表


def build_employee(rows: pd.DataFrame, internal: pd.DataFrame) -> pd.DataFrame:
    """档案字段来自源，`cur_*` 一律从最后一段公司内经历派生。

    当前部门、岗位、序列、职级不从源的快照里另取一份：那样库里就有两个「他现在
    在哪」，而时间线和结果行会各读一个。
    """
    fields = ["emp_id", "name", "education_level", "school", "recruitment"]
    out = _text(_dates(rows, "hire_date"), fields)
    out = out.sort_values("emp_id").set_index("emp_id")

    last = (
        internal.sort_values("start_date")
        .groupby("emp_id")
        .last()
        .reindex(out.index)
        if len(internal)
        else pd.DataFrame(index=out.index, columns=TEXT_FIELDS)
    )

    return pd.DataFrame(
        {
            "emp_id": out.index,
            "name": out.name.values,
            "cur_dept": last.org.fillna("").values,
            "cur_title": last.title.fillna("").values,
            "cur_seq_l1": last.seq_l1.fillna("").values,
            "cur_seq_l2": last.seq_l2.fillna("").values,
            "cur_seq_l3": last.seq_l3.fillna("").values,
            "cur_level": last.level.fillna("").values,
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
    as_of = as_of or pd.Timestamp.today().normalize()

    employees = data.employees.copy()
    employees["emp_id"] = employees.emp_id.map(clean_scalar)
    employees = employees[employees.emp_id != ""]

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
    idle = int((outside.title == UNEMPLOYED).sum()) if len(outside) else 0
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
