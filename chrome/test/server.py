#!/usr/bin/env python3
"""Test target for the Chromium port's isolation/proxy tests.

    server.py PORT [HOST] [TLS_PORT]

Serves plain HTTP on HOST:PORT and, if TLS_PORT is given, the same handler over
HTTPS (self-signed) on HOST:TLS_PORT.
"""
import base64
import json
import os
import ssl
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PAGE = """<!doctype html><meta charset=utf-8><title>macc test</title>
<body>macc test page</body>"""


def _png(size, rgb):
    import struct
    import zlib
    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


ICON = _png(16, (0, 0, 255))  # solid blue


class H(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002 - signature from base
        pass

    def reply(self, code, body, ctype="text/html", headers=()):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode())

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        cookie = self.headers.get("Cookie", "")
        if u.path == "/set":
            self.reply(200, PAGE, headers=[
                ("Set-Cookie", f"{q['n']}={q['v']}; Path=/; Max-Age=3600"),
                ("Set-Cookie", f"http_{q['n']}={q['v']}; Path=/; HttpOnly"),
            ])
        elif u.path == "/echo":
            self.reply(200, json.dumps({
                "cookie": cookie,
                "upstream": self.headers.get("X-Upstream", ""),
            }), "application/json")
        elif u.path == "/favicon.ico":
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.end_headers()
            self.wfile.write(ICON)
        elif u.path == "/cached":
            # Personalised but cacheable: the classic shared-cache leak.
            self.reply(200, cookie, "text/plain", [("Cache-Control", "max-age=600")])
        elif u.path == "/auth":
            want = "Basic " + base64.b64encode(b"user:pass").decode()
            if self.headers.get("Authorization") == want:
                self.reply(200, "authed", "text/plain")
            else:
                self.reply(401, "no", "text/plain", [("WWW-Authenticate", 'Basic realm="t"')])
        else:
            headers = []
            if u.path == "/csp":
                headers.append(("Content-Security-Policy", "script-src 'self'"))
            self.reply(200, PAGE, headers=headers)


def serve(server):
    threading.Thread(target=server.serve_forever, daemon=True).start()


def main():
    port = int(sys.argv[1])
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    serve(ThreadingHTTPServer((host, port), H))
    if len(sys.argv) > 3:
        d = tempfile.mkdtemp()
        key, crt = os.path.join(d, "k.pem"), os.path.join(d, "c.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=macc-test", "-keyout", key, "-out", crt],
                       check=True, capture_output=True)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(crt, key)
        tls = ThreadingHTTPServer((host, int(sys.argv[3])), H)
        tls.socket = ctx.wrap_socket(tls.socket, server_side=True)
        serve(tls)
    threading.Event().wait()


if __name__ == "__main__":
    main()
