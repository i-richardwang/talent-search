"""能力词对照表：读表的拒绝规则、归并、向量圈组、收窄，以及整理工具只加不改。"""

from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import numpy as np

import aliases as A
import chat
import config as C
from extract import Extraction


def setUpModule() -> None:
    unittest.enterModuleContext(
        mock.patch.multiple(
            C,
            EXTRACT_BASE_URL="http://extract.test/v1",
            EXTRACT_MODEL="fake",
            EXTRACT_CONCURRENCY=2,
        )
    )


class ReadTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "skill_aliases.csv"

    def table(self, body: str) -> dict[str, str]:
        self.path.write_text("alias,canonical\n" + body, encoding="utf-8")
        return A.read(self.path)

    def test_missing_file_is_an_empty_table(self) -> None:
        self.assertEqual(A.read(self.path), {})

    def test_rows_are_normalized_like_tags(self) -> None:
        self.assertEqual(
            self.table("推荐算法,推荐系统\n ｐython ,Python\n"),
            {"推荐算法": "推荐系统", "python": "Python"},
        )

    def test_alias_equal_to_canonical_is_rejected(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            self.table("Python,Python\n")
        self.assertIn("第 2 行", str(ctx.exception))

    def test_one_alias_two_canonicals_is_rejected(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            self.table("推荐算法,推荐系统\n推荐算法,推荐\n")
        self.assertIn("推荐算法 已对到 推荐系统", str(ctx.exception))

    def test_chain_is_rejected(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            self.table("个性化推荐,推荐算法\n推荐算法,推荐系统\n")
        self.assertIn("推荐算法 既是标准词又是别名", str(ctx.exception))


class ApplyTest(unittest.TestCase):
    def test_skills_are_canonicalized_and_deduplicated_did_untouched(self) -> None:
        table = {"推荐算法": "推荐系统", "个性化推荐": "推荐系统"}
        got = A.apply(
            table,
            Extraction(("推荐算法", "Python", "个性化推荐"), (("负责建设", "推荐算法"),)),
        )
        self.assertEqual(got, Extraction(("推荐系统", "Python"), (("负责建设", "推荐算法"),)))


class GroupsTest(unittest.TestCase):
    def test_most_common_word_leads_and_groups_do_not_chain(self) -> None:
        words = ["推荐系统", "推荐算法", "个性化推荐", "Python", "数据分析"]
        counts = [3, 5, 1, 4, 2]
        # 推荐系统与推荐算法相近，个性化推荐只和推荐系统相近；Python、数据分析各自独立
        vectors = np.array(
            [
                [1.0, 0.0, 0.0],
                [0.9, 0.44, 0.0],
                [0.9, -0.44, 0.0],
                [0.0, 0.0, 1.0],
                [0.0, 1.0, 0.0],
            ]
        )
        with mock.patch.object(A, "SIMILARITY", 0.85), mock.patch.object(A, "HEAD_MIN", 3):
            got = A.groups(words, counts, vectors)
        # 推荐算法人最多先做组心，收进推荐系统；个性化推荐离推荐算法不够近，不进这一组，
        # 而它自己只有一个人，不够做组心
        self.assertEqual(got, [["推荐算法", "推荐系统"]])

    def test_group_size_is_capped(self) -> None:
        words = [f"词{i}" for i in range(20)]
        vectors = np.ones((20, 2))
        with mock.patch.object(A, "GROUP_MAX", 5), mock.patch.object(A, "HEAD_MIN", 1):
            got = A.groups(words, [1] * 20, vectors)
        self.assertEqual([len(g) for g in got], [5, 5, 5, 5])


class ConformTest(unittest.TestCase):
    group = ["推荐系统", "推荐算法", "搜索推荐"]

    def test_only_candidates_from_the_group_neither_head_nor_strangers(self) -> None:
        self.assertEqual(
            A.conform(
                {"aliases": [" 推荐算法", "推荐系统", "别的词", "推荐算法"]},
                self.group,
            ),
            ["推荐算法"],
        )

    def test_garbage_is_nothing(self) -> None:
        self.assertEqual(A.conform({"aliases": "推荐算法"}, self.group), [])
        self.assertEqual(A.conform("推荐系统", self.group), [])


class MergeTest(unittest.TestCase):
    def test_only_adds_never_changes_and_refuses_chains(self) -> None:
        table = {"个性化推荐": "推荐系统", "Py": "Python"}
        added, skipped = A.merge(
            table,
            [
                ("推荐系统", ["推荐算法", "个性化推荐"]),
                ("Py", ["python3"]),
                ("数据分析", ["Python"]),
            ],
        )
        self.assertEqual(added, [("推荐算法", "推荐系统")])
        self.assertEqual(
            table,
            {"个性化推荐": "推荐系统", "Py": "Python", "推荐算法": "推荐系统"},
        )
        self.assertEqual(len(skipped), 2)
        self.assertIn("Py 已是 Python 的别名", skipped[0])
        self.assertIn("Python 已是标准词", skipped[1])


class MainTest(unittest.TestCase):
    def test_writes_proposals_and_reports(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "skill_aliases.csv"
        vocabulary = (
            ["推荐系统", "推荐算法", "Python"],
            [3, 5, 4],
            np.array([[1.0, 0.0], [0.95, 0.31], [0.0, 1.0]]),
        )
        asked: list[str] = []

        def fake(system: str, schema: object, text: str, what: str) -> object:
            asked.append(text)
            return {"aliases": ["推荐系统"]}

        out = io.StringIO()
        with (
            mock.patch.object(C, "SKILL_ALIASES_PATH", path),
            mock.patch.object(C, "EXTRACT_CACHE_PATH", Path(tmp.name) / "x.sqlite"),
            mock.patch.object(A, "_vocabulary", return_value=vocabulary),
            mock.patch.object(chat, "_request", fake),
            redirect_stdout(out),
        ):
            A.main()
        self.assertEqual(asked, ["标准词：推荐算法\n推荐系统（3 人）"])
        self.assertEqual(A.read(path), {"推荐系统": "推荐算法"})
        self.assertIn("推荐系统 → 推荐算法", out.getvalue())


if __name__ == "__main__":
    unittest.main()
