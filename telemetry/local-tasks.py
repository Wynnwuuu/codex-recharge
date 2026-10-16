#!/usr/bin/env python3
"""Read aggregate local Codex task state; never read messages or credentials."""
import fcntl
import glob
import json
import os
from pathlib import Path
import sqlite3
import sys
from urllib.parse import quote


def readonly_database(path):
    return sqlite3.connect('file:' + quote(str(path)) + '?mode=ro', uri=True, timeout=1)


def writer_is_present(path):
    try:
        with open(path, 'rb') as lock_file:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            return False
    except FileNotFoundError:
        return False


def read_tasks(codex_home):
    state_files = sorted(glob.glob(str(codex_home / 'state_*.sqlite')),
                         key=lambda p: int(Path(p).stem.split('_')[-1]), reverse=True)
    history_files = sorted(glob.glob(str(codex_home / 'thread_history_*.sqlite')),
                           key=lambda p: int(Path(p).stem.split('_')[-1]), reverse=True)
    if not state_files or not history_files:
        raise RuntimeError('SCHEMA_UNAVAILABLE')
    connection = readonly_database(history_files[0])
    try:
        connection.execute('PRAGMA query_only = ON')
        connection.execute('ATTACH DATABASE ? AS state',
                           ('file:' + quote(state_files[0]) + '?mode=ro',))
        # source=vscode is the local desktop/IDE root-chat source in the current
        # Codex schema. Subagent source JSON is excluded. A persisted inProgress
        # row alone is insufficient: interrupted/crashed app runs may leave it.
        # Require the latest turn AND a writer process currently holding its lock.
        rows = connection.execute('''
          SELECT turn.thread_id FROM thread_turns AS turn
          JOIN state.threads AS thread ON thread.id = turn.thread_id
          WHERE turn.status = 'inProgress'
            AND thread.source = 'vscode' AND thread.archived = 0
            AND turn.rollout_ordinal = (
              SELECT MAX(latest.rollout_ordinal) FROM thread_turns AS latest
              WHERE latest.thread_id = turn.thread_id
            )
        ''').fetchall()
        active = sum(writer_is_present(codex_home / 'thread-writer-locks' / (thread_id + '.lock'))
                     for (thread_id,) in rows)
        return {'activeTasks': active, 'tasksStatus': 'live',
                'scope': 'local-desktop-root-chats',
                'source': 'readonly-sqlite-and-held-writer-locks'}
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        root = Path(os.environ.get('CODEX_HOME') or (Path.home() / '.codex'))
        result = read_tasks(root)
    except Exception:
        # Do not emit exception text or paths: SDK/schema/permission failures are
        # represented as unknown, never as zero active tasks.
        result = {'activeTasks': None, 'tasksStatus': 'unavailable',
                  'scope': 'local-desktop-root-chats', 'source': 'unavailable'}
    print(json.dumps(result, separators=(',', ':')))
