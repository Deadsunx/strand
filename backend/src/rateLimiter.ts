// --- src/rateLimiter.ts ---
// Small, dependency-free in-memory rate limiter for Hono routes.
//
// Uses a fixed-window counter keyed by client IP. This is intentionally simple:
// the signaling server is a single process, so a shared in-memory map is enough
// to blunt scripted abuse (e.g. draining TURN credentials or flooding the room
// table). It is NOT a distributed limiter — if the backend is ever scaled to
// multiple instances, move this to Redis or a shared store.

import type { Context, MiddlewareHandler } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { getClientIp } from "./networking";
import { emit } from "./gossamer";

interface WindowEntry {
    count: number;
    resetAt: number;
}

export interface RateLimitOptions {
    /** Number of requests allowed per window, per IP. */
    limit: number;
    /** Window length in milliseconds. */
    windowMs: number;
    /** Label used in telemetry + the Retry-After response. */
    name: string;
}

type RateLimitBindings = { Bindings: HttpBindings };

const DEFAULT_MAX_TRACKED_IPS = 50_000;

/**
 * Creates a Hono middleware that limits requests per client IP.
 * Each call owns its own window map, so different routes are limited
 * independently.
 */
export function createRateLimiter(
    options: RateLimitOptions
): MiddlewareHandler<RateLimitBindings> {
    const windows = new Map<string, WindowEntry>();

    const sweep = (now: number): void => {
        for (const [key, entry] of windows) {
            if (entry.resetAt <= now) {
                windows.delete(key);
            }
        }
    };

    return async (c: Context<RateLimitBindings>, next) => {
        const now = Date.now();
        const ip = getClientIp(c.env.incoming);

        // Opportunistically bound memory: if the map grows unusually large,
        // drop everything already expired before inserting anything new.
        if (windows.size > DEFAULT_MAX_TRACKED_IPS) {
            sweep(now);
        }

        let entry = windows.get(ip);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + options.windowMs };
            windows.set(ip, entry);
        }

        entry.count++;

        const remaining = Math.max(0, options.limit - entry.count);
        const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

        c.header("RateLimit-Limit", String(options.limit));
        c.header("RateLimit-Remaining", String(remaining));
        c.header("RateLimit-Reset", String(retryAfterSec));

        if (entry.count > options.limit) {
            emit("ratelimit:exceeded", {
                limiter: options.name,
                clientIp: ip,
                limit: options.limit,
                windowMs: options.windowMs,
            });
            c.header("Retry-After", String(retryAfterSec));
            return c.json(
                {
                    error: "Too many requests. Please slow down and try again shortly.",
                },
                429
            );
        }

        await next();
    };
}
