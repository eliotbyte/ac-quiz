from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import traceback


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        try:
            path = urlsplit(self.path).path
            if path == "/":
                self.path = "/index.html"
            super().do_GET()
        except Exception:
            traceback.print_exc()
            raise

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        try:
            super().log_message(format, *args)
        except Exception:
            traceback.print_exc()


def main() -> None:
    host = "127.0.0.1"
    port = 8000
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Serving on http://{host}:{port}/", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()

