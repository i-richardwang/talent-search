"""聊天端点调用：缓存与去重，以及响应的处理（JSON 内容、空内容、非 JSON、缺 choices）。"""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import chat
import config as C
import endpoint


def setUpModule() -> None:
    unittest.enterModuleContext(
        mock.patch.multiple(
            C,
            EXTRACT_BASE_URL="http://extract.test/v1",
            EXTRACT_MODEL="fake",
            EXTRACT_CONCURRENCY=2,
        )
    )


def chat_response(content: str | None, finish_reason: str = "stop") -> mock.MagicMock:
    response = mock.MagicMock()
    response.__enter__.return_value = io.StringIO(
        json.dumps(
            {"choices": [{"finish_reason": finish_reason, "message": {"content": content}}]}
        )
    )
    return response


SCHEMA = {"type": "object"}


class CompleteTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.enterContext(
            mock.patch.object(C, "EXTRACT_CACHE_PATH", Path(tmp.name) / "x.sqlite")
        )

    def complete(self, system: str, texts: list[str]) -> dict[str, object]:
        with redirect_stdout(io.StringIO()):
            return chat.complete(system, SCHEMA, texts, "抽取")

    def test_same_text_is_asked_once_and_answered_for_every_position(self) -> None:
        with mock.patch.object(chat, "_request", return_value={"a": 1}) as request:
            got = self.complete("提示", ["甲", "乙", "甲"])
        self.assertEqual(request.call_count, 2)
        self.assertEqual(got, {"甲": {"a": 1}, "乙": {"a": 1}})

    def test_second_run_reads_the_cache_and_another_prompt_or_model_asks_again(self) -> None:
        with mock.patch.object(chat, "_request", return_value={"a": 1}) as request:
            self.complete("提示", ["甲"])
            self.assertEqual(self.complete("提示", ["甲"]), {"甲": {"a": 1}})
            self.complete("另一份提示", ["甲"])
            with mock.patch.object(C, "EXTRACT_MODEL", "another"):
                self.complete("提示", ["甲"])
        self.assertEqual(request.call_count, 3)

    def test_rejected_text_is_not_cached(self) -> None:
        with mock.patch.object(chat, "_request", return_value=None) as request:
            self.assertEqual(self.complete("提示", ["甲"]), {})
            self.complete("提示", ["甲"])
        self.assertEqual(request.call_count, 2)


def post(content: str | None, finish_reason: str = "stop") -> object | None:
    with mock.patch.object(
        endpoint.urllib.request, "urlopen", return_value=chat_response(content, finish_reason)
    ):
        return chat._post("系统提示", SCHEMA, "x", "抽取")


class PostTest(unittest.TestCase):
    def test_parses_json_content(self) -> None:
        self.assertEqual(post('{"skills":["a"],"did":[]}'), {"skills": ["a"], "did": []})

    def test_empty_content_is_reported_and_dropped(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertIsNone(post("", "length"))
        self.assertIn("EXTRACT_MAX_OUTPUT_TOKENS", out.getvalue())

    def test_non_json_content_is_reported_and_dropped(self) -> None:
        with redirect_stdout(io.StringIO()):
            self.assertIsNone(post("好的，以下是……"))

    def test_missing_choices_is_fatal(self) -> None:
        response = mock.MagicMock()
        response.__enter__.return_value = io.StringIO(json.dumps({"error": "x"}))
        with mock.patch.object(endpoint.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(SystemExit):
                chat._post("系统提示", SCHEMA, "x", "抽取")


if __name__ == "__main__":
    unittest.main()
