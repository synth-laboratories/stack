#!/usr/bin/env python3
"""Serve Stack's terminal UI through a local browser PTY.

This is a development/operator bridge for environments where direct GUI control
of terminal apps is unavailable. It runs the real `stack` TUI in a PTY and
connects it to xterm.js in the browser over a minimal local WebSocket server.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import os
import pty
import select
import signal
import socket
import socketserver
import struct
import sys
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


INDEX = """<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stack Browser TUI</title>
    <style>
      html, body { height: 100%; width: 100%; margin: 0; background: #0f0f10; color: #f4f4f5; }
      #terminal {
        box-sizing: border-box;
        height: 100%;
        width: 100%;
        margin: 0;
        overflow: auto;
        padding: 10px;
        white-space: pre-wrap;
        word-break: break-word;
        font: 13px/1.25 Menlo, Monaco, monospace;
        outline: none;
      }
      #status {
        position: fixed;
        right: 8px;
        top: 8px;
        padding: 3px 6px;
        border-radius: 4px;
        background: #242428;
        color: #a1a1aa;
        font: 11px Menlo, Monaco, monospace;
      }
    </style>
  </head>
  <body>
    <pre id="terminal" tabindex="0" aria-label="Stack browser terminal"></pre>
    <div id="status">connecting</div>
    <script>
      const terminal = document.getElementById('terminal');
      const status = document.getElementById('status');
      const decoder = new TextDecoder();
      let rawBuffer = '';
      const ansi = /\\x1b\\][^\\x07]*(?:\\x07|\\x1b\\\\)|\\x1b\\[[0-?]*[ -/]*[@-~]|\\x1b[@-Z\\\\-_]/g;
      const keyMap = {
        Enter: '\\r',
        Tab: '\\t',
        Backspace: '\\x7f',
        Escape: '\\x1b',
        ArrowUp: '\\x1b[A',
        ArrowDown: '\\x1b[B',
        ArrowRight: '\\x1b[C',
        ArrowLeft: '\\x1b[D',
        PageUp: '\\x1b[5~',
        PageDown: '\\x1b[6~',
        Home: '\\x1b[H',
        End: '\\x1b[F',
        Delete: '\\x1b[3~'
      };
      function colsRows() {
        const style = getComputedStyle(terminal);
        const fontSize = Number.parseFloat(style.fontSize) || 13;
        const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.25;
        return {
          cols: Math.max(40, Math.floor(terminal.clientWidth / (fontSize * 0.62))),
          rows: Math.max(16, Math.floor(terminal.clientHeight / lineHeight))
        };
      }
      function clean(data) {
        return data
          .replace(ansi, '')
          .replace(/\\r/g, '\\n')
          .replace(/\\x0f/g, '')
          .replace(/\\x0e/g, '');
      }
      function render(data) {
        rawBuffer += data;
        if (rawBuffer.length > 120000) rawBuffer = rawBuffer.slice(-120000);
        terminal.textContent = clean(rawBuffer).slice(-80000);
        terminal.scrollTop = terminal.scrollHeight;
      }
      const socket = new WebSocket(`ws://${location.host}/pty`);
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', () => {
        status.textContent = 'connected';
        socket.send(JSON.stringify({ type: 'resize', ...colsRows() }));
        terminal.focus();
      });
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') render(event.data);
        else render(decoder.decode(new Uint8Array(event.data), { stream: true }));
      });
      socket.addEventListener('close', () => { status.textContent = 'closed'; });
      socket.addEventListener('error', () => { status.textContent = 'error'; });
      function send(data) {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      }
      terminal.addEventListener('keydown', (event) => {
        if (event.metaKey) return;
        let data = keyMap[event.key];
        if (event.ctrlKey && event.key.length === 1) {
          const code = event.key.toLowerCase().charCodeAt(0) - 96;
          if (code >= 1 && code <= 26) data = String.fromCharCode(code);
        } else if (!data && event.key.length === 1) {
          data = event.altKey ? '\\x1b' + event.key : event.key;
        }
        if (data) {
          event.preventDefault();
          send(data);
        }
      });
      terminal.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData('text');
        if (text) {
          event.preventDefault();
          send(text);
        }
      });
      window.addEventListener('resize', () => {
        send(JSON.stringify({ type: 'resize', ...colsRows() }));
      });
    </script>
  </body>
</html>
"""


class PtySession:
    def __init__(self, command: list[str], cwd: Path):
        self.command = command
        self.cwd = cwd
        self.master_fd: int | None = None
        self.pid: int | None = None
        self.lock = threading.Lock()

    def start(self) -> None:
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(self.cwd)
            os.environ.setdefault("TERM", "xterm-256color")
            os.execvp(self.command[0], self.command)
        self.pid = pid
        self.master_fd = fd

    def write(self, data: bytes) -> None:
        if self.master_fd is None:
            return
        with self.lock:
            os.write(self.master_fd, data)

    def read(self) -> bytes:
        if self.master_fd is None:
            return b""
        return os.read(self.master_fd, 65536)

    def resize(self, cols: int, rows: int) -> None:
        if self.master_fd is None:
            return
        packed = struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0)
        import fcntl
        import termios

        fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, packed)

    def stop(self) -> None:
        if self.pid is not None:
            try:
                os.kill(self.pid, signal.SIGHUP)
            except ProcessLookupError:
                pass


def websocket_accept(key: str) -> str:
    digest = hashlib.sha1((key + GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


def read_frame(sock: socket.socket) -> bytes | None:
    header = sock.recv(2)
    if not header:
        return None
    first, second = header
    opcode = first & 0x0F
    if opcode == 0x8:
        return None
    masked = second & 0x80
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", sock.recv(8))[0]
    mask = sock.recv(4) if masked else b""
    payload = b""
    while len(payload) < length:
        chunk = sock.recv(length - len(payload))
        if not chunk:
            return None
        payload += chunk
    if masked:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return payload


def send_frame(sock: socket.socket, payload: bytes) -> None:
    if len(payload) < 126:
        header = struct.pack("!BB", 0x82, len(payload))
    elif len(payload) < 65536:
        header = struct.pack("!BBH", 0x82, 126, len(payload))
    else:
        header = struct.pack("!BBQ", 0x82, 127, len(payload))
    sock.sendall(header + payload)


class Handler(http.server.BaseHTTPRequestHandler):
    session: PtySession

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def do_GET(self) -> None:
        if self.path == "/":
            body = INDEX.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/pty":
            self.handle_pty()
            return
        self.send_error(404)

    def handle_pty(self) -> None:
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(400, "missing websocket key")
            return
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", websocket_accept(key))
        self.end_headers()
        sock = self.connection
        sock.setblocking(False)
        fd = self.session.master_fd
        if fd is None:
            return
        while True:
            readable, _, _ = select.select([sock, fd], [], [], 0.2)
            if fd in readable:
                try:
                    data = self.session.read()
                except OSError:
                    break
                if not data:
                    break
                send_frame(sock, data)
            if sock in readable:
                try:
                    frame = read_frame(sock)
                except (BlockingIOError, ConnectionError, OSError):
                    break
                if frame is None:
                    break
                if frame.startswith(b'{"type":"resize"'):
                    try:
                        import json

                        msg = json.loads(frame.decode("utf-8"))
                        self.session.resize(int(msg["cols"]), int(msg["rows"]))
                    except Exception:
                        pass
                else:
                    self.session.write(frame)


class ReusableThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


def main() -> int:
    parser = argparse.ArgumentParser(description="Expose Stack TUI through a local browser PTY.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("stack_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = [str(ROOT / "bin" / "stack"), *args.stack_args]
    session = PtySession(command, ROOT)
    session.start()
    Handler.session = session

    with ReusableThreadingTCPServer((args.host, args.port), Handler) as server:
        print(f"Stack browser TUI: http://{args.host}:{args.port}", flush=True)
        try:
            server.serve_forever()
        finally:
            session.stop()
            time.sleep(0.1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
