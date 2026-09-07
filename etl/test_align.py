"""序列对齐：树从哪来、收窄只认树上的一对、哪些段会去问、缓存身份随树变。"""

from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import pandas as pd

import align as A
import chat
import config as C
from pipeline import UNEMPLOYED


def setUpModule() -> None:
    unittest.enterModuleContext(
        mock.patch.multiple(
            C,
            EXTRACT_BASE_URL="http://extract.test/v1",
            EXTRACT_MODEL="fake",
            EXTRACT_CONCURRENCY=2,
        )
    )


def corpus(*external: tuple[str, str]) -> pd.DataFrame:
    """两段登记了序列的公司内经历，加上给定的（岗位，描述）入职前段。"""
    rows = [
        {"kind": "internal", "org": "平台技术部", "title": "算法工程师",
         "seq_l1": "技术", "seq_l2": "算法", "description": ""},
        {"kind": "internal", "org": "渠道部", "title": "渠道运营",
         "seq_l1": "运营", "seq_l2": "渠道运营", "description": ""},
        {"kind": "internal", "org": "渠道部", "title": "实习生",
         "seq_l1": "运营", "seq_l2": "", "description": ""},
    ]
    rows += [
        {"kind": "external", "org": "云枢智能", "title": title,
         "seq_l1": "", "seq_l2": "", "description": description}
        for title, description in external
    ]
    # 和 pipeline.build 交出的形状一样：推断的两列已经在，等着 align 填
    return pd.DataFrame(rows).assign(seq_inferred_l1="", seq_inferred_l2="")


class SeqTreeTest(unittest.TestCase):
    def test_pairs_from_internal_segments_only_both_levels(self) -> None:
        self.assertEqual(
            A.seq_tree(corpus(("算法工程师", ""))),
            [("技术", "算法"), ("运营", "渠道运营")],
        )

    def test_prompt_lists_every_pair(self) -> None:
        prompt = A.system_prompt([("技术", "算法"), ("运营", "渠道运营")])
        self.assertIn("技术 · 算法", prompt)
        self.assertIn("运营 · 渠道运营", prompt)


class ConformTest(unittest.TestCase):
    tree = {("技术", "算法")}

    def test_pair_on_the_tree(self) -> None:
        self.assertEqual(A.conform({"l1": " 技术", "l2": "算法 "}, self.tree), ("技术", "算法"))

    def test_anything_else_is_unaligned(self) -> None:
        for raw in (
            {"l1": "技术", "l2": "推荐"},
            {"l1": "技术", "l2": ""},
            {"l1": "", "l2": ""},
            {"l1": "技术"},
            "技术 · 算法",
            None,
        ):
            with self.subTest(raw=raw):
                self.assertEqual(A.conform(raw, self.tree), ("", ""))


class AlignTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.enterContext(
            mock.patch.object(C, "EXTRACT_CACHE_PATH", Path(tmp.name) / "x.sqlite")
        )

    def test_external_segments_get_inferred_columns_and_idle_is_not_asked(self) -> None:
        frame = corpus(("推荐算法工程师", "负责召回"), (UNEMPLOYED, ""), ("厨师", ""))
        asked: list[str] = []

        def fake(system: str, schema: object, text: str, what: str) -> object:
            asked.append(text)
            return {"l1": "技术", "l2": "算法"} if "推荐" in text else {"l1": "", "l2": ""}

        with mock.patch.object(chat, "_request", fake), redirect_stdout(io.StringIO()):
            out = A.align(frame)
        self.assertEqual(len(asked), 2)
        self.assertEqual(
            list(zip(out.seq_inferred_l1, out.seq_inferred_l2, strict=True)),
            [("", ""), ("", ""), ("", ""), ("技术", "算法"), ("", ""), ("", "")],
        )
        # 登记的三列不被碰
        self.assertEqual(list(out.seq_l1[3:]), ["", "", ""])

    def test_no_registered_sequences_means_nothing_to_align(self) -> None:
        frame = corpus(("算法工程师", ""))
        frame = frame[frame.kind == "external"].reset_index(drop=True)
        with mock.patch.object(chat, "_request", side_effect=AssertionError("打了端点")), \
             redirect_stdout(io.StringIO()):
            out = A.align(frame)
        self.assertEqual(list(out.seq_inferred_l1), [""])

    def test_cache_key_changes_with_the_tree(self) -> None:
        frame = corpus(("算法工程师", ""))
        with mock.patch.object(chat, "_request", return_value={"l1": "", "l2": ""}) as request, \
             redirect_stdout(io.StringIO()):
            A.align(frame)
            A.align(frame)
            grown = pd.concat(
                [frame, corpus()[:1].assign(seq_l2="数据")], ignore_index=True
            )
            A.align(grown)
        self.assertEqual(request.call_count, 2)


if __name__ == "__main__":
    unittest.main()
