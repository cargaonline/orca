#!/bin/sh
# usage: hook_log.sh <EventName> <log.jsonl>  -- appends {event, ts, payload}; prints the allow/no-op decision.
EV="$1"
LOG="$2"
python3 -I -c '
import json,sys,time
ev,log=sys.argv[1],sys.argv[2]
ts=int(time.time()*1000)
raw=sys.stdin.read()
try: p=json.loads(raw)
except Exception: p={"_raw":raw}
with open(log,"a") as f: f.write(json.dumps({"event":ev,"ts":ts,"payload":p})+"\n")
' "$EV" "$LOG"
if [ "$EV" = "PreToolUse" ]; then echo '{"decision":"allow"}'; else echo '{}'; fi
