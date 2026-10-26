#!/usr/bin/env python3
"""Scripted OpenAI-compatible fake LLM for agy hook capture (issue 33973).

usage: fake_server.py <port> <log_dir> <variant>   variant: 1 | 2
Logs every request to <log_dir>/server-requests.jsonl and a timeline to
<log_dir>/server-timeline.jsonl.
"""
import json
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
LOG_DIR = sys.argv[2]
VARIANT = sys.argv[3] if len(sys.argv) > 3 else "1"
REQ_LOG = LOG_DIR + "/server-requests.jsonl"
TL_LOG = LOG_DIR + "/server-timeline.jsonl"
LOCK = threading.Lock()
SUB_DELAY = {"SUB_A": 3, "SUB_B": 8, "SUB_C": 16}
WAIT_TOOL = "wait"
WAIT_ARGS = {}


def now_ms():
    return int(time.time() * 1000)


def append(path, obj):
    with LOCK:
        with open(path, "a") as f:
            f.write(json.dumps(obj) + "\n")


def text_of(content):
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for part in content:
            if isinstance(part, dict):
                out.append(str(part.get("text", "")) if "text" in part else json.dumps(part))
            else:
                out.append(str(part))
        return "\n".join(out)
    return json.dumps(content)


def first_user_text(body):
    for m in body.get("messages") or []:
        if m.get("role") == "user":
            return text_of(m.get("content"))
    return ""


def classify(body):
    msgs = body.get("messages") or []
    sys_text = "\n".join(text_of(m.get("content")) for m in msgs if m.get("role") == "system")
    if "conversation title generator" in sys_text:
        return "TITLE"
    u = first_user_text(body)
    for k in ("SUB_A", "SUB_B", "SUB_C"):
        if k + "_TASK" in u:
            return k
    if "PARENT_TASK" in u:
        return "PARENT"
    return "OTHER"


def all_text(body):
    return "\n".join(text_of(m.get("content")) for m in body.get("messages") or [])


def invoke_args(marker):
    return {
        "TypeName": "self",
        "Role": "Worker " + marker,
        "Prompt": marker + "_TASK: you are subagent " + marker[-1] + ". Reply with your report and nothing else.",
        "Workspace": "inherit",
    }


def tc(name, args):
    return {"id": "call_" + name + "_" + uuid.uuid4().hex[:8], "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)}}


def decide(body):
    """Return (kind, reply_text or None, tool_calls or None, delay_s)."""
    kind = classify(body)
    msgs = body.get("messages") or []
    if kind in SUB_DELAY:
        return kind, kind + "_REPORT done", None, SUB_DELAY[kind]
    if kind == "TITLE":
        return kind, "Fake Title", None, 0
    if kind != "PARENT":
        return kind, "ok", None, 0
    assistants = "\n".join(text_of(m.get("content")) for m in msgs if m.get("role") == "assistant")
    if "invoke_subagent" not in assistants and not any(m.get("tool_calls") for m in msgs):
        return "PARENT:launch", None, [tc("invoke_subagent", invoke_args(x)) for x in ("SUB_A", "SUB_B", "SUB_C")], 0
    txt = all_text(body)
    done = all(("SUB_%s_REPORT" % x) in txt for x in "ABC")
    if VARIANT == "2":
        n_wait = assistants.count("<" + WAIT_TOOL + ">")
        if not done and n_wait < 8:
            return "PARENT:wait-tool#%d" % (n_wait + 1), None, [tc(WAIT_TOOL, WAIT_ARGS)], 0
        if done:
            return "PARENT:final", "PARENT_FINAL_REPORT", None, 0
        return "PARENT:still", "PARENT_STILL_WAITING", None, 0
    if "PARENT_WAITING" not in assistants:
        return "PARENT:waiting", "PARENT_WAITING: launched three subagents, waiting", None, 0
    if done:
        return "PARENT:final", "PARENT_FINAL_REPORT", None, 0
    return "PARENT:still", "PARENT_STILL_WAITING", None, 0


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send_json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        append(REQ_LOG, {"ts": now_ms(), "method": "GET", "path": self.path,
                         "headers": {k: v for k, v in self.headers.items() if k.lower() != "authorization"}})
        if "models" in self.path:
            self._send_json(200, {"object": "list", "data": [
                {"id": "fake-model", "object": "model", "created": 0, "owned_by": "fake"}]})
        else:
            self._send_json(200, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        t0 = now_ms()
        try:
            body = json.loads(raw or b"{}")
        except Exception:
            body = {"_raw": raw.decode("utf-8", "replace")}
        append(REQ_LOG, {"ts": t0, "method": "POST", "path": self.path, "body": body,
                         "headers": {k: v for k, v in self.headers.items() if k.lower() != "authorization"}})
        if "chat/completions" not in self.path:
            append(TL_LOG, {"ts": t0, "path": self.path, "kind": "NON_CHAT"})
            self._send_json(200, {})
            return
        kind, text, calls, delay = decide(body)
        append(TL_LOG, {"ts": t0, "event": "request", "kind": kind, "path": self.path,
                        "n_messages": len(body.get("messages") or []), "stream": bool(body.get("stream"))})
        if delay:
            time.sleep(delay)
        cid = "chatcmpl-" + uuid.uuid4().hex[:12]
        finish = "tool_calls" if calls else "stop"
        if body.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()

            def chunk(delta, fr=None):
                obj = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                       "model": body.get("model", "fake-model"),
                       "choices": [{"index": 0, "delta": delta, "finish_reason": fr}]}
                self.wfile.write(("data: " + json.dumps(obj) + "\n\n").encode())
                self.wfile.flush()

            chunk({"role": "assistant", "content": ""})
            if text:
                chunk({"content": text})
            if calls:
                for i, c in enumerate(calls):
                    chunk({"tool_calls": [{"index": i, "id": c["id"], "type": "function",
                                           "function": {"name": c["function"]["name"], "arguments": c["function"]["arguments"]}}]})
            chunk({}, finish)
            usage = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                     "model": body.get("model", "fake-model"), "choices": [],
                     "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}
            self.wfile.write(("data: " + json.dumps(usage) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            self.close_connection = True
        else:
            msg = {"role": "assistant", "content": text}
            if calls:
                msg["tool_calls"] = calls
            self._send_json(200, {"id": cid, "object": "chat.completion", "created": int(time.time()),
                                  "model": body.get("model", "fake-model"),
                                  "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
                                  "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})
        append(TL_LOG, {"ts": now_ms(), "event": "reply", "kind": kind, "text": text,
                        "tool_calls": [c["function"]["name"] + " " + c["function"]["arguments"][:160] for c in (calls or [])]})


if __name__ == "__main__":
    if len(sys.argv) > 4 and sys.argv[4]:
        WAIT_TOOL = sys.argv[4]
    if len(sys.argv) > 5 and sys.argv[5]:
        WAIT_ARGS = json.loads(sys.argv[5])
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    srv.daemon_threads = True
    srv.serve_forever()
