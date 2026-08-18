// JWT auth middleware for Hono
import { createMiddleware } from "hono/factory";
import { jwtVerify, SignJWT } from "jose";
import crypto from "crypto";
import db from "../db/connection.js";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required. Set it to a random string (min 32 chars).");
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function createToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.sub as string;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Auth middleware — validates JWT and attaches userId
export const authMiddleware = createMiddleware(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = auth.slice(7);
  const userId = await verifyToken(token);
  if (!userId) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Check not suspended
  const user = db.prepare("SELECT is_suspended FROM users WHERE id = ?").get(userId) as any;
  if (user?.is_suspended) {
    return c.json({ error: "Account suspended" }, 403);
  }

  c.set("userId", userId);
  await next();
});

// Admin middleware
export const adminMiddleware = createMiddleware(async (c, next) => {
  const userId = c.get("userId");
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as any;
  if (!user?.is_admin) {
    return c.json({ error: "Admin only" }, 403);
  }
  await next();
});
