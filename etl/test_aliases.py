"""能力词对照表：读表的拒绝规则、归并、向量圈组、收窄、合并记账，以及整轮整理。"""

from __future__ import annotations

import io
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime, timedelta
from unittest import mock

import numpy as np

import aliases as A
import chat
import config as C
from aliases import Decision
from extract import Extraction

NOW = datetime(2026, 9, 8, tzinfo=UTC)
OLD = NOW - timedelta(days=30)


def setUpModule() -> None:
    unittest.enterModuleContext(
        mock.patch.multiple(
            C,
            EXTRACT_BASE_URL="http://extract.test/v1",
            EXTRACT_MODEL="fake",
            EXTRACT_CONCURRENCY=2,
        )
    )


class FakeCursor:
    """只认 `read` 和 `write` 发出的那两条语句。"""

    def __init__(self, rows: list[tuple[str, str, datetime]]) -> None:
        self.rows = rows
        self.written: list[tuple[str, str, datetime]] = []

    def execute(self, sql: str) -> None:
        pass

    def __iter__(self):
        return iter(self.rows)

    def executemany(self, sql: str, params: list[tuple[str, str, datetime]]) -> None:
        self.written += params


class ReadTest(unittest.TestCase):
    def test_rows_become_decisions(self) -> None:
        cur = FakeCursor([("推荐算法", "推荐系统", OLD), ("推荐系统", "推荐系统", OLD)])
        self.assertEqual(
            A.read(cur),
            {"推荐算法": Decision("推荐系统", OLD), "推荐系统": Decision("推荐系统", OLD)},
        )

    def test_chain_is_rejected(self) -> None:
        cur = FakeCursor(
            [
                ("个性化推荐", "推荐算法", OLD),
                ("推荐算法", "推荐系统", OLD),
                ("推荐系统", "推荐系统", OLD),
            ]
        )
        with self.assertRaises(SystemExit) as ctx:
            A.read(cur)
        self.assertIn("个性化推荐 的标准词自己又是别名", str(ctx.exception))


class ApplyTest(unittest.TestCase):
    def test_skills_are_canonicalized_and_deduplicated_did_untouched(self) -> None:
        table = {
            "推荐算法": Decision("推荐系统", OLD),
            "个性化推荐": Decision("推荐系统", OLD),
            "推荐系统": Decision("推荐系统", OLD),
        }
        self.assertEqual(A.mapping(table), {"推荐算法": "推荐系统", "个性化推荐": "推荐系统"})
        got = A.apply(
            A.mapping(table),
            Extraction(("推荐算法", "Python", "个性化推荐"), (("负责建设", "推荐算法"),)),
        )
        self.assertEqual(got, Extraction(("推荐系统", "Python"), (("负责建设", "推荐算法"),)))


class GroupsTest(unittest.TestCase):
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

    def test_most_common_word_leads_and_groups_do_not_chain(self) -> None:
        with mock.patch.object(A, "SIMILARITY", 0.85), mock.patch.object(A, "HEAD_MIN", 3):
            got = A.groups(self.words, self.counts, self.vectors, set(self.words))
        # 推荐算法人最多先做组心，收进推荐系统；个性化推荐离推荐算法不够近，不进这一组，
        # 而它自己只有一个人，不够做组心
        self.assertEqual(got, [["推荐算法", "推荐系统"]])

    def test_only_due_words_lead_but_anyone_can_be_collected(self) -> None:
        with mock.patch.object(A, "SIMILARITY", 0.85), mock.patch.object(A, "HEAD_MIN", 3):
            got = A.groups(self.words, self.counts, self.vectors, {"推荐系统"})
        # 推荐算法刚整理过不做组心，轮到推荐系统做组心时它还是可以被收进来
        self.assertEqual(got, [["推荐系统", "推荐算法", "个性化推荐"]])

    def test_group_size_is_capped(self) -> None:
        words = [f"词{i}" for i in range(20)]
        with mock.patch.object(A, "GROUP_MAX", 5), mock.patch.object(A, "HEAD_MIN", 1):
            got = A.groups(words, [1] * 20, np.ones((20, 2)), set(words))
        self.assertEqual([len(g) for g in got], [5, 5, 5, 5])


class ConformTest(unittest.TestCase):
    group = ["推荐系统", "推荐算法", "搜索推荐"]

    def test_only_candidates_from_the_group_neither_head_nor_strangers(self) -> None:
        self.assertEqual(
            A.conform({"aliases": [" 推荐算法", "推荐系统", "别的词", "推荐算法"]}, self.group),
            ["推荐算法"],
        )

    def test_garbage_is_nothing(self) -> None:
        self.assertEqual(A.conform({"aliases": "推荐算法"}, self.group), [])
        self.assertEqual(A.conform("推荐系统", self.group), [])


class MergeTest(unittest.TestCase):
    def test_head_is_stamped_and_aliases_of_aliases_repoint(self) -> None:
        table = {"Py": Decision("Python", OLD), "Python": Decision("Python", OLD)}
        changed = A.merge(table, "推荐系统", ["Python"], NOW)
        self.assertEqual(sorted(changed), ["Py", "Python", "推荐系统"])
        self.assertEqual(
            table,
            {
                "Py": Decision("推荐系统", NOW),
                "Python": Decision("推荐系统", NOW),
                "推荐系统": Decision("推荐系统", NOW),
            },
        )

    def test_nothing_to_merge_still_stamps_the_head(self) -> None:
        table: A.Table = {}
        self.assertEqual(A.merge(table, "推荐系统", [], NOW), ["推荐系统"])
        self.assertEqual(table, {"推荐系统": Decision("推荐系统", NOW)})


class ReviewTest(unittest.TestCase):
    def test_applies_old_decisions_asks_about_due_heads_and_records(self) -> None:
        cur = FakeCursor(
            [
                ("Py", "Python", OLD),
                ("Python", "Python", NOW - timedelta(days=1)),
            ]
        )
        extractions = [
            Extraction(("推荐系统", "Py"), ()),
            Extraction(("推荐算法",), ()),
            Extraction(("推荐系统", "推荐算法", "Python"), ()),
            Extraction(("推荐系统", "推荐算法"), ()),
            Extraction(("推荐系统", "推荐算法", "Java"), ()),
        ]
        vectors = {
            "Java": [0.0, 1.0],
            "Python": [0.0, 1.0],
            "推荐算法": [0.95, 0.31],
            "推荐系统": [1.0, 0.0],
        }
        asked: list[str] = []

        def fake(system: str, schema: object, text: str, what: str) -> object:
            asked.append(text)
            return {"aliases": ["推荐系统"]}

        out = io.StringIO()
        with (
            mock.patch.object(A, "embed", lambda words: [vectors[w] for w in words]),
            mock.patch.object(chat, "_request", fake),
            mock.patch.object(chat, "_cache"),
            mock.patch.object(chat, "_cached", return_value={}),
            mock.patch.object(chat, "_store"),
            redirect_stdout(out),
        ):
            got = A.review(cur, extractions, ["u1", "u2", "u3", "u4", "u5"])
        # Python 一天前整理过不做组心，Java 只有一个人；到期的组心只有推荐算法（4 人）
        self.assertEqual(asked, ["标准词：推荐算法\n推荐系统（4 人）"])
        self.assertEqual(
            {w: c for w, c, _ in cur.written},
            {"推荐算法": "推荐算法", "推荐系统": "推荐算法"},
        )
        # 旧决定（Py → Python）和新决定都套到了这一轮的能力词上
        self.assertEqual(got[0], Extraction(("推荐算法", "Python"), ()))
        self.assertEqual(got[2], Extraction(("推荐算法", "Python"), ()))
        self.assertIn("推荐系统 → 推荐算法", out.getvalue())


if __name__ == "__main__":
    unittest.main()
