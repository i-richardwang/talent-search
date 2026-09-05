"""公开 CSV 适配器只解析格式，不替数据源编造契约字段。

测的是 `extract()` 这一整条路：CSV 表达不了的东西（BOM、可省的列、布尔字面量）
由适配器补齐，列齐不齐由契约报错。适配器不判列。
"""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from contract import SourceData
from sources.csv_dir import extract

EMPLOYEES = (
    "emp_id,name,hire_date,education_level,school,recruitment\n"
    "E1,某人,2020-01-01,本科,示例大学,校招\n"
)
ASSIGNMENTS = (
    "emp_id,start_date,end_date,org,org_path,title,level,seq_l1,seq_l2,seq_l3\n"
    "E1,2024-01-01,,平台技术部,示例科技/平台技术部,算法工程师,P6,技术,算法,\n"
)
EXTERNAL = (
    "emp_id,start_date,end_date,org,title,description,"
    "company_tag,industry,nature,unemployed\n"
    "E1,2018-01-01,2019-12-31,云枢智能,算法工程师,做召回,,,,\n"
)


class CsvSourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.write("employees.csv", EMPLOYEES)
        self.write("assignments.csv", ASSIGNMENTS)
        self.write("external.csv", EXTERNAL)

    def write(self, name: str, text: str) -> None:
        (self.directory / name).write_text(text, encoding="utf-8")

    def extract(self) -> SourceData:
        with (
            mock.patch.dict(os.environ, {"TALENT_CSV_DIR": str(self.directory)}),
            redirect_stdout(io.StringIO()),
        ):
            return extract()

    def test_required_column_is_not_silently_filled(self) -> None:
        self.write("employees.csv", "emp_id,name\nE1,某人\n")

        with self.assertRaises(SystemExit) as caught:
            self.extract()

        self.assertIn("hire_date", str(caught.exception))

    def test_byte_order_mark_does_not_hide_the_first_column(self) -> None:
        self.write("employees.csv", "﻿" + EMPLOYEES)

        self.assertEqual(self.extract().employees.emp_id.tolist(), ["E1"])

    def test_absent_segment_key_falls_back_to_department_and_title(self) -> None:
        keys = self.extract().assignments.segment_key

        self.assertEqual(keys.tolist(), ["平台技术部|算法工程师"])

    def test_blank_segment_key_falls_back_but_a_given_one_is_kept(self) -> None:
        self.write(
            "assignments.csv",
            ASSIGNMENTS.replace("seq_l3\n", "seq_l3,segment_key\n")
            .replace("技术,算法,\n", "技术,算法,,JOB-7\n")
            + "E1,2022-01-01,2023-12-31,推荐工程部,示例科技/推荐工程部,"
            "算法工程师,P6,技术,算法,,\n",
        )

        keys = self.extract().assignments.segment_key

        self.assertEqual(keys.tolist(), ["JOB-7", "推荐工程部|算法工程师"])

    def test_unemployed_reads_the_documented_spellings(self) -> None:
        rows = "".join(
            f"E1,2018-01-01,2018-06-30,,,,,,,{written}\n"
            for written in ("true", "Y", "是", "1", "", "no")
        )
        self.write("external.csv", EXTERNAL.split("\n")[0] + "\n" + rows)

        flags = self.extract().external.unemployed

        self.assertEqual(flags.tolist(), [True, True, True, True, False, False])


if __name__ == "__main__":
    unittest.main()
