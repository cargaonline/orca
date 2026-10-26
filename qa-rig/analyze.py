#!/usr/bin/env python3
"""usage: analyze.py <run_dir>  -> prints merged chronological table"""
import json
import os
import sys

RUN = sys.argv[1]
hooks = [json.loads(l) for l in open(RUN + "/hooks.jsonl") if l.strip()]
tl = []
try:
    tl = [json.loads(l) for l in open(RUN + "/server-timeline.jsonl")]
except FileNotFoundError:
    pass
start = None
if os.path.exists(RUN + "/driver.log"):
    for l in open(RUN + "/driver.log"):
        if "started agy" in l:
            start = int(l.split()[0])
            break
if start is None:
    start = min([h["ts"] for h in hooks] + [t["ts"] for t in tl])
LINK_KEYS = ("parentConversationId", "rootConversationId", "callerContext", "parentId", "subagent", "isSubagent")


def idle(p):
    for k in ("fullyIdle", "fully_idle"):
        if k in p:
            return "%s=%s" % (k, json.dumps(p[k]))
    return "ABSENT"


def lui(p):
    if "lastUserInput" not in p:
        return "(absent)"
    v = p["lastUserInput"]
    if v in ("", None):
        return "(empty)"
    return json.dumps(str(v)[:40])


rows = []
all_keys = set()
for h in hooks:
    p = h["payload"]
    all_keys.update(p.keys())
    f = []
    if h["event"] == "Stop":
        f.append(idle(p))
        f.append("terminationReason=%s" % p.get("terminationReason", "(absent)"))
        if "executionNum" in p:
            f.append("executionNum=%s" % p["executionNum"])
    if h["event"] in ("Stop", "PreInvocation", "PostInvocation", "SessionStart"):
        f.append("lastUserInput=" + lui(p))
    if "invocationNum" in p:
        f.append("inv=%s/steps=%s" % (p.get("invocationNum"), p.get("initialNumSteps")))
    if "toolCall" in p:
        f.append("tool=%s" % (p["toolCall"] or {}).get("name"))
    if "stepIdx" in p:
        f.append("stepIdx=%s" % p["stepIdx"])
    for k in LINK_KEYS:
        if k in p:
            f.append("%s=%s" % (k, json.dumps(p[k])[:40]))
    if "error" in p and p["error"]:
        f.append("error=%s" % json.dumps(p["error"])[:60])
    f.append("tp=" + os.path.basename(p.get("transcriptPath", "")))
    rows.append((h["ts"], "HOOK", "%-15s %s  %s" % (h["event"], p.get("conversationId", "?")[:8], "  ".join(f))))
for t in tl:
    if t.get("event") == "request":
        rows.append((t["ts"], "LLM", "request  %s (n_msgs=%s)" % (t["kind"], t.get("n_messages"))))
    elif t.get("event") == "reply":
        what = t.get("text") or ""
        if t.get("tool_calls"):
            what += " tool_calls=" + "; ".join(c.split(" ")[0] for c in t["tool_calls"])
        rows.append((t["ts"], "LLM", "reply    %s -> %s" % (t["kind"], what)))
rows.sort(key=lambda r: r[0])
for ts, src, txt in rows:
    print("%7d  %-4s %s" % (ts - start, src, txt))
print()
print("payload keys seen across all hooks:", sorted(all_keys))
