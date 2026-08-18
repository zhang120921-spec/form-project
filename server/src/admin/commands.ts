import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const SERVER_DIR = path.join(ROOT, "server");
const WEB_DIR = path.join(ROOT, "web");

export type CommandStatus = "idle" | "running" | "success" | "error";

export interface CommandSession {
  id: string;
  label: string;
  command: string;
  args: string[];
  cwd: string;
  status: CommandStatus;
  output: string[];
  exitCode: number | null;
  startedAt: string;
  finishedAt?: string;
  process?: ChildProcess;
}

const sessions = new Map<string, CommandSession>();
const listeners = new Map<string, Set<(line: string) => void>>();

let seq = 0;
function nextId(): string {
  seq++;
  return `cmd-${Date.now()}-${seq}`;
}

function emit(sessionId: string, line: string) {
  const s = sessions.get(sessionId);
  if (s) {
    s.output.push(line);
    // Keep last 2000 lines
    if (s.output.length > 2000) s.output.shift();
  }
  const set = listeners.get(sessionId);
  if (set) set.forEach((fn) => fn(line));
}

export function listSessions(): CommandSession[] {
  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export function getSession(id: string): CommandSession | undefined {
  return sessions.get(id);
}

export function subscribe(sessionId: string, fn: (line: string) => void): () => void {
  if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
  listeners.get(sessionId)!.add(fn);
  return () => listeners.get(sessionId)?.delete(fn);
}

export function runCommand(
  label: string,
  command: string,
  args: string[],
  cwd: string
): CommandSession {
  const id = nextId();
  const session: CommandSession = {
    id,
    label,
    command,
    args,
    cwd,
    status: "running",
    output: [`$ ${command} ${args.join(" ")}`, `cwd: ${cwd}`, ""],
    exitCode: null,
    startedAt: new Date().toISOString(),
  };
  sessions.set(id, session);

  const proc = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      NODE_PATH: path.join(ROOT, "node_modules"),
      FORCE_COLOR: "0",
      NPM_CONFIG_PROGRESS: "false",
      NPM_CONFIG_SPIN: "false",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  session.process = proc;

  proc.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString("utf-8").split(/\r?\n/);
    for (const line of lines) emit(id, line);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString("utf-8").split(/\r?\n/);
    for (const line of lines) emit(id, line);
  });

  proc.on("error", (err) => {
    emit(id, `ERROR: ${err.message}`);
    session.status = "error";
    session.finishedAt = new Date().toISOString();
  });

  proc.on("close", (code) => {
    session.exitCode = code ?? null;
    session.status = code === 0 ? "success" : "error";
    session.finishedAt = new Date().toISOString();
    emit(id, `\n--- exited with code ${code} ---`);
  });

  return session;
}

export function killSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s || !s.process || s.process.killed) return false;
  s.process.kill("SIGTERM");
  setTimeout(() => {
    if (s.process && !s.process.killed) s.process.kill("SIGKILL");
  }, 5000);
  return true;
}

// Convenience presets
export const PRESETS = {
  "server-install": () =>
    runCommand("Server: npm install", "/Users/michaelzhang/.workbuddy/binaries/node/versions/22.22.2/bin/npm", ["install"], SERVER_DIR),
  "server-migrate": () =>
    runCommand("Server: db migrate", "/Users/michaelzhang/.workbuddy/binaries/node/versions/22.22.2/bin/npm", ["run", "db:migrate"], SERVER_DIR),
  "server-seed": () =>
    runCommand("Server: db seed", "/Users/michaelzhang/.workbuddy/binaries/node/versions/22.22.2/bin/npm", ["run", "db:seed"], SERVER_DIR),
  "server-dev": () =>
    runCommand("Server: dev", "/Users/michaelzhang/.workbuddy/binaries/node/versions/22.22.2/bin/npm", ["run", "dev"], SERVER_DIR),
  "web-install": () =>
    runCommand("Web: npm install", "/Users/michaelzhang/.workbuddy/binaries/node/versions/22.22.2/bin/npm", ["install"], WEB_DIR),
  "web-dev": () =>
    runCommand("Web: dev", "/Users/michaelzhang/.workbuddy/binaries/node/versions/22.22.2/bin/npm", ["run", "dev"], WEB_DIR),
};
