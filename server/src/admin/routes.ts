import { Hono } from "hono";
import { runCommand, PRESETS, listSessions, getSession, subscribe, killSession } from "./commands.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const app = new Hono();

// Admin routes — protected by auth + admin middleware

// List command presets
app.get("/commands/presets", authMiddleware, adminMiddleware, (c) => {
  return c.json(Object.keys(PRESETS));
});

// Run a preset command
app.post("/commands/run/:preset", authMiddleware, adminMiddleware, (c) => {
  const preset = c.req.param("preset") as keyof typeof PRESETS;
  const fn = PRESETS[preset];
  if (!fn) return c.json({ error: "Unknown preset" }, 400);

  const running = listSessions().find(
    (s) => s.label === fn().label && s.status === "running"
  );
  if (running) {
    return c.json({ error: "Already running", sessionId: running.id }, 409);
  }

  const session = fn();
  return c.json({ sessionId: session.id, status: session.status });
});

// Run arbitrary command (admin only)
app.post("/commands/exec", authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  const { label, command, args = [], cwd } = body;
  if (!label || !command || !cwd) {
    return c.json({ error: "label, command, cwd required" }, 400);
  }
  const session = runCommand(label, command, args, cwd);
  return c.json({ sessionId: session.id, status: session.status });
});

// List sessions
app.get("/commands/sessions", authMiddleware, adminMiddleware, (c) => {
  return c.json(listSessions());
});

// Get session details
app.get("/commands/sessions/:id", authMiddleware, adminMiddleware, (c) => {
  const s = getSession(c.req.param("id"));
  if (!s) return c.json({ error: "Not found" }, 404);
  return c.json(s);
});

// Kill a session
app.post("/commands/sessions/:id/kill", authMiddleware, adminMiddleware, (c) => {
  const ok = killSession(c.req.param("id"));
  return c.json({ success: ok });
});

// Stream output via SSE
app.get("/commands/sessions/:id/stream", authMiddleware, adminMiddleware, async (c) => {
  const sessionId = c.req.param("id");
  const s = getSession(sessionId);
  if (!s) return c.json({ error: "Not found" }, 404);

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  const stream = new ReadableStream({
    start(controller) {
      // Send existing output
      for (const line of s.output) {
        controller.enqueue(`data: ${JSON.stringify({ type: "out", text: line })}\n\n`);
      }
      if (s.status !== "running") {
        controller.enqueue(`data: ${JSON.stringify({ type: "status", status: s.status, exitCode: s.exitCode })}\n\n`);
      }

      const unsub = subscribe(sessionId, (line) => {
        controller.enqueue(`data: ${JSON.stringify({ type: "out", text: line })}\n\n`);
      });

      // Check for completion every second
      const interval = setInterval(() => {
        const cur = getSession(sessionId);
        if (cur && cur.status !== "running") {
          controller.enqueue(`data: ${JSON.stringify({ type: "status", status: cur.status, exitCode: cur.exitCode })}\n\n`);
          clearInterval(interval);
          unsub();
          controller.close();
        }
      }, 1000);

      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(interval);
        unsub();
        controller.close();
      });
    },
  });

  return c.body(stream);
});

export default app;
