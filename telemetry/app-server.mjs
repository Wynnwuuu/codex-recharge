import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createInterface} from 'node:readline';

export async function findCodexBinary() {
  for (const candidate of [
    process.env.CODEX_CLI_PATH,
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ].filter(Boolean)) {
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  return 'codex';
}

// Only initialize and read quota. Never starts/resumes a thread, reads auth files,
// logs RPC bodies, consumes reset credits, or changes the user's configuration.
export class CodexAppServer {
  constructor({binary, timeoutMs = 20000, spawnProcess = spawn} = {}) {
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.spawnProcess = spawnProcess;
    this.pending = new Map();
    this.nextId = 1;
    this.child = null;
    this.connecting = null;
  }

  async connect() {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const child = this.spawnProcess(this.binary || await findCodexBinary(),
        ['app-server', '--stdio', '-c', 'analytics.enabled=false'],
        {stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true});
      this.child = child;
      const lines = createInterface({input: child.stdout, crlfDelay: Infinity});
      lines.on('line', (line) => {
        if (line.length > 8 * 1024 * 1024) return;
        let message;
        try { message = JSON.parse(line); } catch { return; }
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new Error('CODEX_RPC_ERROR'));
        else waiting.resolve(message.result);
      });
      const disconnected = () => {
        lines.close();
        if (this.child === child) {
          this.child = null;
          this.connecting = null;
          for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new Error('CODEX_DISCONNECTED'));
          }
          this.pending.clear();
        }
      };
      child.on('error', disconnected);
      child.on('exit', disconnected);
      child.stdin.on('error', () => {});
      await this.request('initialize', {
        clientInfo: {name: 'codex_recharge', title: 'Codex Recharge', version: '1.0.0'},
      });
      if (this.child !== child) throw new Error('CODEX_DISCONNECTED');
      child.stdin.write(JSON.stringify({method: 'initialized', params: {}}) + '\n');
    })().catch((error) => {
      this.close();
      throw error;
    });
    return this.connecting;
  }

  request(method, params) {
    const child = this.child;
    if (!child || child.stdin.destroyed) return Promise.reject(new Error('CODEX_UNAVAILABLE'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CODEX_TIMEOUT'));
        this.close();
      }, this.timeoutMs);
      this.pending.set(id, {resolve, reject, timer});
      child.stdin.write(JSON.stringify({id, method, ...(params ? {params} : {})}) + '\n');
    });
  }

  async readRateLimits() {
    await this.connect();
    return this.request('account/rateLimits/read');
  }

  close() {
    const child = this.child;
    this.child = null;
    this.connecting = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CODEX_DISCONNECTED'));
    }
    this.pending.clear();
    if (child && !child.killed) {
      child.stdin.end();
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    }
  }
}
