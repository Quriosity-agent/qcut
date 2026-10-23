"""Chinese CLI output works with Windows encodings and captured text streams."""
import io
import sys
import unittest
from unittest.mock import patch

from body.cli_console import configure_console


class ConsoleTests(unittest.TestCase):
    def test_cp1252_stdout_and_stderr_write_chinese_as_utf8(self):
        output_bytes, error_bytes = io.BytesIO(), io.BytesIO()
        output = io.TextIOWrapper(output_bytes, encoding="cp1252", errors="strict", newline="\n")
        error = io.TextIOWrapper(error_bytes, encoding="cp1252", errors="strict", newline="\n")
        try:
            with patch.object(sys, "stdout", output), patch.object(sys, "stderr", error):
                configure_console()
                self.assertIs(sys.stdout, output)
                self.assertIs(sys.stderr, error)
                print("独立美体已启动")
                print("照片处理未完成", file=sys.stderr)
                output.flush()
                error.flush()
                self.assertEqual(output.encoding, "utf-8")
                self.assertEqual(error.encoding, "utf-8")
                self.assertEqual(output.errors, "backslashreplace")
                self.assertEqual(error.errors, "backslashreplace")
                self.assertEqual(output_bytes.getvalue(), "独立美体已启动\n".encode("utf-8"))
                self.assertEqual(error_bytes.getvalue(), "照片处理未完成\n".encode("utf-8"))
        finally:
            output.close()
            error.close()

    def test_unpaired_surrogates_are_escaped_instead_of_crashing(self):
        buffer = io.BytesIO()
        stream = io.TextIOWrapper(buffer, encoding="cp1252", errors="strict", newline="\n")
        try:
            with patch.object(sys, "stdout", stream), patch.object(sys, "stderr", io.StringIO()):
                configure_console()
                stream.write("文件名\ud800")
                stream.flush()
                self.assertEqual(buffer.getvalue(), "文件名".encode("utf-8") + b"\\ud800")
        finally:
            stream.close()

    def test_stringio_is_preserved_and_still_captures_chinese(self):
        output, error = io.StringIO(), io.StringIO()
        with patch.object(sys, "stdout", output), patch.object(sys, "stderr", error):
            configure_console()
            self.assertIs(sys.stdout, output)
            self.assertIs(sys.stderr, error)
            print("正常输出")
            print("错误输出", file=sys.stderr)
        self.assertEqual(output.getvalue(), "正常输出\n")
        self.assertEqual(error.getvalue(), "错误输出\n")
        self.assertFalse(output.closed)
        self.assertFalse(error.closed)

    def test_absent_console_streams_are_left_alone(self):
        with patch.object(sys, "stdout", None), patch.object(sys, "stderr", None):
            configure_console()
            self.assertIsNone(sys.stdout)
            self.assertIsNone(sys.stderr)


if __name__ == "__main__":
    unittest.main()
