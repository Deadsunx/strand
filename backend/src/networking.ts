import os from "os";
import type { IncomingMessage } from "http";
import ipaddr from "ipaddr.js";
import proxyaddr from "proxy-addr";
import config from "./config";

const trustSingleProxyHop = (_addr: string, index: number): boolean => index < 1;

function parseIp(ip: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
    try {
        return ipaddr.process(ip);
    } catch {
        return null;
    }
}

function normalizeOrigin(origin: string): string {
    try {
        return new URL(origin).origin;
    } catch {
        return origin.trim();
    }
}

function ipv6NetworkPrefix(ip: ipaddr.IPv6): string {
    return ip.parts.slice(0, 4).join(":");
}

export function getClientIp(req: IncomingMessage): string {
    const proxiedAddress = proxyaddr(req, trustSingleProxyHop);
    return getCleanIp(proxiedAddress);
}

export function getCleanIp(ip: string | undefined | null): string {
    if (!ip || typeof ip !== "string") {
        return "unknown";
    }

    const parsed = parseIp(ip);
    if (!parsed) {
        return ip;
    }

    if (parsed.kind() === "ipv6" && parsed.range() === "loopback") {
        return "127.0.0.1";
    }

    return parsed.toString();
}

export function isPrivateIP(ip: string | undefined | null): boolean {
    if (!ip || typeof ip !== "string") {
        return false;
    }

    const parsed = parseIp(ip);
    if (!parsed) {
        return false;
    }

    return [
        "private",
        "loopback",
        "linkLocal",
        "uniqueLocal",
        "carrierGradeNat",
    ].includes(parsed.range());
}

export function getNetworkGroup(ip: string | undefined | null): string {
    if (!ip || typeof ip !== "string") {
        return "unknown";
    }

    const parsed = parseIp(ip);
    if (!parsed) {
        return ip;
    }

    if (!isPrivateIP(parsed.toString())) {
        return parsed.toString();
    }

    if (parsed.kind() === "ipv4") {
        const ipv4 = parsed as ipaddr.IPv4;
        return ipv4.octets.slice(0, 3).join(".");
    }

    return ipv6NetworkPrefix(parsed as ipaddr.IPv6);
}

export function determineConnectionType(firstIp: string, secondIp: string): "lan" | "wan" {
    if (firstIp === secondIp) {
        return "lan";
    }

    return getNetworkGroup(firstIp) === getNetworkGroup(secondIp) ? "lan" : "wan";
}

export function isAllowedOrigin(origin: string): boolean {
    const normalizedOrigin = normalizeOrigin(origin);
    return (
        config.ALLOWED_ORIGINS.has(normalizedOrigin) ||
        config.VERCEL_PREVIEW_ORIGIN_REGEX.test(normalizedOrigin)
    );
}

export function getLocalIpForDisplay(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const ifaces = interfaces[name];
        if (!ifaces) continue;
        for (const iface of ifaces) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
}
