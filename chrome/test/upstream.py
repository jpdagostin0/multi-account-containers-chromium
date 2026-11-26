#!/usr/bin/env python3
"""A tiny upstream HTTP proxy for the per-container proxy test.

    upstream.py PORT NAME

Tunnels CONNECT, forwards absolute-URI requests adding `X-Upstream: NAME`,
and answers `GET /stats` (origin-form) with the number of CONNECTs and
forwarded requests it has seen, per target.
"""
import json
import select
import socket
import sys
import threading
import urllib.error
import urllib.request
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME = sys.argv[2]
stats = {"connect": Counter(), "forward": Counter()}
lock = threading.Lock()


class H(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002
        pass

    def do_CONNECT(self):
        with lock:
            stats["connect"][self.path] += 1
        host, port = self.path.rsplit(":", 1)
        try:
            upstream = socket.create_connection((host, int(port)), timeout=10)
        except OSError:
            self.send_error(502)
            return
        self.send_response(200, "Connection established")
        self.end_headers()
        conns = [self.connection, upstream]
        try:
            while True:
                r, _, _ = select.select(conns, [], [], 30)
                if not r:
                    break
                for s in r:
                    data = s.recv(65536)
                    if not data:
                        return
                    (upstream if s is self.connection else self.connection).sendall(data)
        finally:
            upstream.close()

    def do_GET(self):
        if not self.path.startswith("http://"):
            body = json.dumps({k: dict(v) for k, v in stats.items()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        with lock:
            stats["forward"][self.path.split("/")[2]] += 1
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("proxy-connection", "connection", "host")}
        headers["X-Upstream"] = NAME
        req = urllib.request.Request(self.path, headers=headers)
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10) as resp:
                body = resp.read()
                status = resp.status
                rh = resp.headers
        except urllib.error.HTTPError as e:
            body, status, rh = e.read(), e.code, e.headers
        self.send_response(status)
        for k, v in rh.items():
            if k.lower() not in ("transfer-encoding", "connection"):
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
