# Local Codex telemetry

```sh
node telemetry/cli.mjs
node telemetry/cli.mjs --watch --interval 30000 --task-interval 1000
```

The CLI emits one compact JSON status per read; `--watch` keeps a child Codex app-server alive between reads. Independent loops refresh quota every 30 seconds (`--interval`) and local task counts approximately every second (`--task-interval`), emitting a combined snapshot when either read finishes. Quota latency does not block task refreshes. The intervals start after each corresponding read completes; the minimum accepted intervals are 5 seconds for quota and 250 ms for tasks. The CLI shuts down its child when terminated. It never starts a model turn or modifies Codex settings.

- **Quota:** the signed-in local Codex CLI's official [`account/rateLimits/read`](https://learn.chatgpt.com/docs/app-server) method. Each window is `100 - usedPercent`, clamped to 0–100. The gauge uses the smallest available percentage across the Codex bucket's quota windows. It does not consume a quota reset. An account without supported rate-limit data is shown as unavailable.
- **Running tasks:** a read-only query of local `~/.codex/thread_history_*.sqlite` and `state_*.sqlite`, requiring both the latest turn to be `inProgress` and a writer process to hold that thread's writer lock. This avoids counting abandoned persisted turns. It counts local root chats with the desktop/IDE `vscode` source, and excludes subagents and cloud-only chats. This adapter depends on Codex's local schema and returns unavailable when the schema cannot be read. No messages, titles, tokens, or authentication files are read.
- **Freshness:** successful reads are `live`. A failed read can show the prior quota as `stale` for up to 24 hours and the prior task count for up to 2 minutes, with their original update times. After that the value is `null`, never a fabricated 0 or 100.

Requirements: Node.js 20+ and a signed-in Codex CLI. macOS local task counting additionally uses Python 3 and its standard-library SQLite/fcntl modules; no Python package installation is needed. macOS may require the existing Command Line Tools Python runtime. If Python or the Codex CLI is unavailable, the corresponding metric remains unavailable.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `CODEX_CLI_PATH` | Existing Codex CLI executable override. Common macOS app paths are also detected. |
| `CODEX_HOME` | Existing Codex state directory override; the adapter does not write to it. |
| `CODEX_RECHARGE_PYTHON` | Python 3 executable override (default `/usr/bin/python3`). |
| `CODEX_RECHARGE_DATA_DIR` | Optional directory for a normalized quota cache. No cache file is written by default. The cache contains percentages and reset times only; task counts are not persisted. |

Offline verification:

```sh
node --test tests/telemetry.test.mjs
python3 -B tests/telemetry-tasks.py
```

On 2026-10-16 a live local verification returned 55% quota remaining and 1 running local root chat, both marked `live`. These values are verification evidence and are never hardcoded as runtime telemetry.
