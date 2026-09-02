"""语料暂存、说法规划与发布生命周期。"""

from __future__ import annotations

import io
import unittest
from contextlib import redirect_stdout
from unittest import mock

import load as loader
from load import _phrase_plan


def experience_row(
    experience_id: int,
    *,
    kind: str = "internal",
    org: str = "平台技术部",
    org_path: str = "示例科技/技术中心/平台技术部",
    title: str = "算法工程师",
    seq_l1: str = "技术",
    seq_l2: str = "算法",
    seq_l3: str = "",
    description: str = "",
) -> tuple:
    return (
        experience_id,
        kind,
        org,
        org_path,
        title,
        seq_l1,
        seq_l2,
        seq_l3,
        description,
    )


class PhrasePlanTest(unittest.TestCase):
    def test_repeated_text_has_one_phrase_and_multiple_edges(self):
        texts, links = _phrase_plan(
            [
                experience_row(1),
                experience_row(
                    2,
                    kind="external",
                    org="云枢智能",
                    org_path="",
                    seq_l1="",
                    seq_l2="",
                    description="负责推荐系统召回",
                ),
            ]
        )

        self.assertEqual(
            texts,
            [
                "技术 · 算法",
                "算法工程师",
                "示例科技/技术中心/平台技术部",
                "云枢智能",
                "负责推荐系统召回",
            ],
        )
        self.assertEqual(
            links,
            [
                (1, "seq", 1),
                (1, "title", 2),
                (1, "org", 3),
                (2, "title", 2),
                (2, "org", 4),
                (2, "description", 5),
            ],
        )

    def test_empty_corpus_has_no_phrases_or_edges(self):
        self.assertEqual(_phrase_plan([]), ([], []))


class ReloadLifecycleTest(unittest.TestCase):
    def test_imports_are_serialized_and_publish_starts_after_staging_commit(self):
        events: list[str] = []
        source = mock.MagicMock()
        source.extract.side_effect = lambda: events.append("extract") or "raw"

        connection = mock.MagicMock()
        connection.__enter__.return_value = connection
        connection.commit.side_effect = lambda: events.append("commit")
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.execute.side_effect = lambda *_: events.append("lock")
        connection.cursor.return_value = cursor

        with (
            mock.patch.object(
                loader.C,
                "require_database_url",
                return_value="postgres://test",
            ),
            mock.patch.object(loader.psycopg, "connect", return_value=connection),
            mock.patch.object(loader, "load_source", return_value=source),
            mock.patch.object(
                loader,
                "build",
                side_effect=lambda _: events.append("build")
                or ("employees", "experiences"),
            ),
            mock.patch.object(
                loader,
                "probe",
                side_effect=lambda _: events.append("probe") or [0.1],
            ),
            mock.patch.object(
                loader,
                "_create_staging_tables",
                side_effect=lambda *_: events.append("create staging"),
            ),
            mock.patch.object(
                loader,
                "_stage_corpus",
                side_effect=lambda *_: events.append("stage") or (3, 4),
            ),
            mock.patch.object(
                loader,
                "_publish_corpus",
                side_effect=lambda *_: events.append("publish")
                or (2, [("internal", 3)]),
            ),
            redirect_stdout(io.StringIO()),
        ):
            loader.load("sample")

        self.assertEqual(
            events,
            [
                "lock",
                "commit",
                "extract",
                "build",
                "probe",
                "create staging",
                "commit",
                "stage",
                "commit",
                "publish",
                "commit",
            ],
        )


if __name__ == "__main__":
    unittest.main()
