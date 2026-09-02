"""公开 CSV 适配器只解析格式，不替数据源编造契约字段。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from contract import ASSIGNMENT_COLUMNS, EMPLOYEE_COLUMNS
from sources.csv_dir import _read


class CsvContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def write(self, name: str, header: str, row: str) -> None:
        (self.directory / name).write_text(f"{header}\n{row}\n", encoding="utf-8")

    def test_required_column_is_not_silently_filled(self) -> None:
        self.write("employees.csv", "emp_id,name", "E1,某人")

        with self.assertRaises(SystemExit) as caught:
            _read(self.directory, "employees.csv", EMPLOYEE_COLUMNS)

        self.assertIn("hire_date", str(caught.exception))

    def test_segment_key_is_the_only_optional_assignment_column(self) -> None:
        required = [column for column in ASSIGNMENT_COLUMNS if column != "segment_key"]
        self.write("assignments.csv", ",".join(required), ",".join(["E1", "2024-01-01", *([""] * 8)]))

        frame = _read(
            self.directory,
            "assignments.csv",
            ASSIGNMENT_COLUMNS,
            frozenset({"segment_key"}),
        )

        self.assertEqual(frame.columns.tolist(), ASSIGNMENT_COLUMNS)
        self.assertEqual(frame.iloc[0].segment_key, "")


if __name__ == "__main__":
    unittest.main()
