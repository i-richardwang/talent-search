"""通用管线的不变量。

这里测的是「无论数据从哪来都必须成立」的那几条：非法区间必须被拒绝并报数、
开放区间怎么封口、相邻段怎么合并、当前信息从哪派生。适配器自己的解析逻辑
归各自的测试，不在这里。
"""

from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout

import pandas as pd

from contract import SourceData
from pipeline import (
    UNEMPLOYED,
    build,
    build_employee,
    build_external,
    build_internal,
    clean_scalar,
    duration_months,
)

AS_OF = pd.Timestamp("2024-06-30")


def assignments(rows: list[dict]) -> pd.DataFrame:
    base = {
        "end_date": None,
        "org": "部门",
        "org_path": "公司/中心/部门",
        "title": "岗位",
        "level": "P6",
        "seq_l1": "技术",
        "seq_l2": "后端开发",
        "seq_l3": "",
        "segment_key": "K1",
    }
    frame = pd.DataFrame([{**base, **row} for row in rows])
    if frame.empty:
        return pd.DataFrame(columns=["emp_id", "start_date", *base])
    return frame


def externals(rows: list[dict]) -> pd.DataFrame:
    base = {
        "end_date": None,
        "org": "某公司",
        "title": "工程师",
        "description": "",
        "company_tag": "",
        "industry": "",
        "nature": "",
        "unemployed": False,
    }
    frame = pd.DataFrame([{**base, **row} for row in rows])
    if frame.empty:
        return pd.DataFrame(columns=["emp_id", "start_date", *base])
    return frame


def quiet(fn, *args):
    out = io.StringIO()
    with redirect_stdout(out):
        result = fn(*args)
    return result, out.getvalue()


def people(rows: list[dict]) -> pd.DataFrame:
    base = {
        "name": "某人",
        "hire_date": "2020-01-01",
        "education_level": "",
        "school": "",
        "recruitment": "",
    }
    return pd.DataFrame([{**base, **row} for row in rows])


class DurationTest(unittest.TestCase):
    def test_rejects_reversed_range(self) -> None:
        with self.assertRaises(ValueError):
            duration_months(pd.Timestamp("2024-02-01"), pd.Timestamp("2024-01-31"))

    def test_null_scalar_never_becomes_nan_text(self) -> None:
        self.assertEqual(clean_scalar(float("nan")), "")


class InternalTest(unittest.TestCase):
    def test_rejects_illegal_intervals_and_says_so(self) -> None:
        rows = assignments(
            [
                {"emp_id": "E1", "start_date": "2020-01-01"},
                {"emp_id": "E2", "start_date": None},
                {"emp_id": "E3", "start_date": "2030-01-01"},
                {"emp_id": "E4", "start_date": "2020-05-01", "end_date": "2020-01-01"},
            ]
        )

        out, said = quiet(build_internal, rows, AS_OF)

        self.assertEqual(out.emp_id.tolist(), ["E1"])
        self.assertIn("缺少开始日期 1 段，已拒绝导入", said)
        self.assertIn("生效日在未来 1 段，已拒绝导入", said)
        self.assertIn("日期倒置 1 段，已拒绝导入", said)

    def test_merges_adjacent_segments_and_recomputes_duration(self) -> None:
        rows = assignments(
            [
                {"emp_id": "E1", "start_date": "2024-01-01", "end_date": "2024-01-31"},
                {"emp_id": "E1", "start_date": "2024-02-01"},
            ]
        )

        out, _ = quiet(build_internal, rows, AS_OF)

        self.assertEqual(len(out), 1)
        self.assertTrue(pd.isna(out.iloc[0].end_date))
        # 合并后按「第一段起始 → as_of」重算，不是两段月数相加
        self.assertEqual(out.iloc[0].months, 6)

    def test_different_key_stays_two_segments(self) -> None:
        rows = assignments(
            [
                {"emp_id": "E1", "start_date": "2024-01-01", "end_date": "2024-01-31"},
                {"emp_id": "E1", "start_date": "2024-02-01", "segment_key": "K2"},
            ]
        )

        out, _ = quiet(build_internal, rows, AS_OF)

        self.assertEqual(len(out), 2)

    def test_same_key_on_different_people_never_merges(self) -> None:
        rows = assignments(
            [
                {"emp_id": "E1", "start_date": "2024-01-01", "end_date": "2024-01-31"},
                {"emp_id": "E2", "start_date": "2024-02-01"},
            ]
        )

        out, _ = quiet(build_internal, rows, AS_OF)

        self.assertEqual(out.emp_id.tolist(), ["E1", "E2"])


class ExternalTest(unittest.TestCase):
    def test_open_range_ends_at_hire_date_or_is_rejected(self) -> None:
        rows = externals(
            [
                {"emp_id": "E1", "start_date": "2020-01-01"},
                {"emp_id": "E2", "start_date": "2020-01-01"},
            ]
        )

        out, said = quiet(build_external, rows, {"E1": pd.Timestamp("2021-01-01")})

        self.assertEqual(out.emp_id.tolist(), ["E1"])
        self.assertEqual(out.iloc[0].end_date, pd.Timestamp("2021-01-01"))
        self.assertIn("无入职日 1 段，已拒绝导入", said)

    def test_unemployed_segment_carries_no_description(self) -> None:
        rows = externals(
            [
                {
                    "emp_id": "E1",
                    "start_date": "2020-01-01",
                    "end_date": "2020-06-30",
                    "description": "不该留下来的描述",
                    "unemployed": True,
                }
            ]
        )

        out, _ = quiet(build_external, rows, {})

        self.assertEqual(out.iloc[0].title, UNEMPLOYED)
        self.assertEqual(out.iloc[0].description, "")

    def test_company_meta_keeps_only_non_empty_keys(self) -> None:
        rows = externals(
            [
                {
                    "emp_id": "E1",
                    "start_date": "2020-01-01",
                    "end_date": "2020-06-30",
                    "company_tag": "大厂",
                },
                {"emp_id": "E2", "start_date": "2020-01-01", "end_date": "2020-06-30"},
            ]
        )

        out, _ = quiet(build_external, rows, {})

        self.assertEqual(json.loads(out.iloc[0].org_meta), {"company_tag": "大厂"})
        # 三项全空写 NULL，不写 `{}`——空对象读起来像「有属性但都是空的」
        self.assertIsNone(out.iloc[1].org_meta)


class EmployeeTest(unittest.TestCase):
    def test_current_fields_come_from_the_last_internal_segment(self) -> None:
        internal, _ = quiet(
            build_internal,
            assignments(
                [
                    {
                        "emp_id": "E1",
                        "start_date": "2020-01-01",
                        "end_date": "2021-12-31",
                        "title": "旧岗位",
                    },
                    {
                        "emp_id": "E1",
                        "start_date": "2022-01-01",
                        "title": "现岗位",
                        "segment_key": "K2",
                    },
                ]
            ),
            AS_OF,
        )

        out = build_employee(people([{"emp_id": "E1"}]), internal)

        self.assertEqual(out.iloc[0].cur_title, "现岗位")
        self.assertEqual(out.iloc[0].cur_dept, "部门")

    def test_person_without_any_segment_still_lands(self) -> None:
        empty, _ = quiet(build_internal, assignments([]), AS_OF)

        out = build_employee(people([{"emp_id": "E1", "name": "只有档案"}]), empty)

        self.assertEqual(out.iloc[0].cur_title, "")
        # `.name` 在 Series 上是索引名，取列必须用下标
        self.assertEqual(out.iloc[0]["name"], "只有档案")


class PopulationTest(unittest.TestCase):
    def test_segments_outside_the_population_are_dropped(self) -> None:
        """人群由 employees 说了算——留着孤儿段只会撞外键，报一条读不懂的错。"""
        data = SourceData(
            employees=people([{"emp_id": "E1", "name": "在册"}]),
            assignments=assignments(
                [
                    {"emp_id": "E1", "start_date": "2020-01-01"},
                    {"emp_id": "E9", "start_date": "2020-01-01"},
                ]
            ),
            external=externals([]),
        )

        (employee, experience), said = quiet(build, data, AS_OF)

        self.assertEqual(employee.emp_id.tolist(), ["E1"])
        self.assertEqual(experience.emp_id.tolist(), ["E1"])
        self.assertIn("不属于本次人群", said)


class ContractTest(unittest.TestCase):
    def test_missing_column_is_reported_by_name(self) -> None:
        with self.assertRaises(SystemExit) as caught:
            SourceData(
                employees=pd.DataFrame([{"emp_id": "E1"}]),
                assignments=assignments([]),
                external=externals([]),
            )
        self.assertIn("hire_date", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
