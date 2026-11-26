#!/usr/bin/env python3
"""Tiny cookie test server for the Chromium port's isolation tests."""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PAGE = """<!doctype html><meta charset=utf-8><title>macc test</title>
<script>
window.report = () => ({
  cookie: document.cookie,
  ls: Object.assign({}, localStorage),
  lsLen: localStorage.length,
});
</script><body>macc test page</body>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/set":
            self.send_response(200)
            self.send_header("Set-Cookie", f"{q['n']}={q['v']}; Path=/; Max-Age=3600")
            self.send_header("Set-Cookie", f"http_{q['n']}={q['v']}; Path=/; HttpOnly")
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(PAGE.encode())
        elif u.path == "/echo":
            body = json.dumps({"cookie": self.headers.get("Cookie", "")}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            if u.path == "/csp":
                self.send_header("Content-Security-Policy", "script-src 'self'")
            self.end_headers()
            self.wfile.write(PAGE.encode())


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
