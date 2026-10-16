import fcntl
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('local_tasks', Path(__file__).parents[1] / 'telemetry/local-tasks.py')
tasks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tasks)


class TaskReaderTest(unittest.TestCase):
    def test_requires_current_root_turn_and_live_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'thread-writer-locks').mkdir()
            state = sqlite3.connect(root / 'state_5.sqlite')
            state.execute('CREATE TABLE threads (id TEXT, source TEXT, archived INT)')
            state.executemany('INSERT INTO threads VALUES (?,?,?)', [
                ('running', 'vscode', 0), ('stale', 'vscode', 0),
                ('completed', 'vscode', 0), ('subagent', '{"subagent":{}}', 0),
                ('archived', 'vscode', 1),
            ])
            state.commit(); state.close()
            history = sqlite3.connect(root / 'thread_history_1.sqlite')
            history.execute('CREATE TABLE thread_turns (thread_id TEXT, status TEXT, rollout_ordinal INT)')
            history.executemany('INSERT INTO thread_turns VALUES (?,?,?)', [
                ('running', 'inProgress', 1), ('stale', 'inProgress', 1),
                ('completed', 'inProgress', 1), ('completed', 'completed', 2),
                ('subagent', 'inProgress', 1), ('archived', 'inProgress', 1),
            ])
            history.commit(); history.close()
            held = []
            try:
                for thread in ['running', 'completed', 'subagent', 'archived']:
                    stream = open(root / 'thread-writer-locks' / (thread + '.lock'), 'wb')
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    held.append(stream)
                result = tasks.read_tasks(root)
                self.assertEqual(result['activeTasks'], 1)
                self.assertEqual(result['tasksStatus'], 'live')
                self.assertNotIn('running', str(result))
            finally:
                for stream in held:
                    stream.close()
            self.assertEqual(tasks.read_tasks(root)['activeTasks'], 0)

    def test_missing_schema_is_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(RuntimeError):
                tasks.read_tasks(Path(directory))


if __name__ == '__main__':
    unittest.main()
