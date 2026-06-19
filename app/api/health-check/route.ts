import { NextRequest, NextResponse } from "next/server";
import { ProxyAgent, request } from "undici";
import { z } from "zod";
import { HealthCheckResult } from "@/lib/types";
import { checkRateLimit } from "@/lib/rateLimit";
import { isUrlAllowed } from "@/lib/urlPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  ipAddress: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  type: z.enum(["Residential", "Datacenter", "Tailscale"]),
  protocol: z.enum(["http", "https", "socks5"]),
  location: z.string().min(1).max(120),
  status: z.enum(["Online", "Offline", "Unknown"]),
  username: z.string().optional(),
  password: z.string().optional(),
  tailscaleName: z.string().optional(),
  notes: z.string().optional(),
  lastCheckedAt: z.string().optional(),
  lastLatencyMs: z.number().optional(),
  lastHttpStatus: z.number().optional()
});

const HealthCheckSchema = z.object({
  targetUrl: z.string().url().max(2048),
  node: NodeSchema
});

const ACCESS_DENIED_PATTERNS = [
  /access\s+denied/i,
  /request\s+blocked/i,
  /forbidden/i,
  /not\s+authorized/i,
  /captcha/i,
  /unusual\s+traffic/i,
  /attention\s+required/i,
  /security\s+check/i,
  /cloudflare/i,
  /akamai/i,
  /incapsula/i,
  /imperva/i,
  /datadome/i,
  /perimeterx/i,
  /waf/i
];

function result(payload: Omit<HealthCheckResult, "checkedAt">, status = 200) {
  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      ...payload
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

function clientKey(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

function buildProxyUri(node: z.infer<typeof NodeSchema>) {
  if (node.protocol === "socks5") {
    throw new Error("SOCKS5 proxies need a SOCKS-capable dispatcher. The included health check supports HTTP and HTTPS proxy endpoints.");
  }

  const auth = node.username
    ? `${encodeURIComponent(node.username)}:${encodeURIComponent(node.password ?? "")}@`
    : "";

  return `${node.protocol}://${auth}${node.ipAddress}:${node.port}`;
}

function isLikelyInternalTarget(targetUrl: string) {
  const { hostname } = new URL(targetUrl);
  const lower = hostname.toLowerCase();

  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;

  return false;
}

async function readLimitedBody(body: AsyncIterable<Uint8Array>, maxBytes = 131_072) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;

    if (total > maxBytes) {
      const remaining = Math.max(maxBytes - (total - buffer.byteLength), 0);
      if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
      break;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function detectAccessDenied(statusCode: number, text: string) {
  if ([401, 403, 407, 429, 451].includes(statusCode)) return true;
  return ACCESS_DENIED_PATTERNS.some((pattern) => pattern.test(text));
}

function safeEvidence(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

export async function POST(requestObject: NextRequest) {
  const rate = checkRateLimit(clientKey(requestObject));
  if (!rate.allowed) {
    return result(
      {
        ok: false,
        targetUrl: "unknown",
        nodeName: "unknown",
        exitNode: "unknown",
        classification: "POLICY_BLOCKED",
        message: "Rate limit exceeded. Reduce health-check frequency and try again shortly."
      },
      429
    );
  }

  let parsed: z.infer<typeof HealthCheckSchema>;

  try {
    const json = await requestObject.json();
    parsed = HealthCheckSchema.parse(json);
  } catch (error) {
    return result(
      {
        ok: false,
        targetUrl: "unknown",
        nodeName: "unknown",
        exitNode: "unknown",
        classification: "VALIDATION_ERROR",
        message: error instanceof Error ? error.message : "Invalid request payload."
      },
      400
    );
  }

  const { targetUrl, node } = parsed;

  if (node.type === "Tailscale") {
    return result(
      {
        ok: false,
        targetUrl,
        nodeName: node.name,
        exitNode: node.tailscaleName || node.ipAddress,
        classification: "VALIDATION_ERROR",
        message: "Tailscale exit nodes must be checked locally after enabling the exit node on the client device."
      },
      400
    );
  }

  if (isLikelyInternalTarget(targetUrl)) {
    return result(
      {
        ok: false,
        targetUrl,
        nodeName: node.name,
        exitNode: node.ipAddress,
        classification: "POLICY_BLOCKED",
        message: "Internal or loopback targets are blocked to prevent SSRF-style misuse."
      },
      403
    );
  }

  const policy = isUrlAllowed(targetUrl);
  if (!policy.allowed) {
    return result(
      {
        ok: false,
        targetUrl,
        nodeName: node.name,
        exitNode: node.ipAddress,
        classification: "POLICY_BLOCKED",
        message: policy.reason
      },
      403
    );
  }

  const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 12_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const proxyUri = buildProxyUri(node);
    const dispatcher = new ProxyAgent(proxyUri);

    const response = await request(targetUrl, {
      dispatcher,
      method: "GET",
      signal: controller.signal,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      maxRedirections: 0,
      headers: {
        "User-Agent": "PrivateProxyNetworkManager/1.0 HealthCheck",
        Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8"
      }
    });

    const latencyMs = Math.round(performance.now() - started);
    const text = await readLimitedBody(response.body);
    const denied = detectAccessDenied(response.statusCode, text);
    const ok = response.statusCode >= 200 && response.statusCode < 400 && !denied;

    if (denied) {
      return result({
        ok: false,
        statusCode: response.statusCode,
        latencyMs,
        targetUrl,
        nodeName: node.name,
        exitNode: node.ipAddress,
        classification: "ACCESS_DENIED_DETECTED",
        message: "The target responded, but the response looks like an access-denied, CAPTCHA, throttling, or security-filter page.",
        evidence: safeEvidence(text)
      });
    }

    if (!ok) {
      return result({
        ok: false,
        statusCode: response.statusCode,
        latencyMs,
        targetUrl,
        nodeName: node.name,
        exitNode: node.ipAddress,
        classification: "HTTP_ERROR",
        message: `The target responded with HTTP ${response.statusCode}.`,
        evidence: safeEvidence(text)
      });
    }

    return result({
      ok: true,
      statusCode: response.statusCode,
      latencyMs,
      targetUrl,
      nodeName: node.name,
      exitNode: node.ipAddress,
      classification: "SUCCESS",
      message: "Connection succeeded through the selected authorized node."
    });
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const message = error instanceof Error ? error.message : "Unknown network error";
    const timedOut = /aborted|timeout/i.test(message);

    return result(
      {
        ok: false,
        latencyMs,
        targetUrl,
        nodeName: node.name,
        exitNode: node.ipAddress,
        classification: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
        message: timedOut
          ? `Connection timed out after ${timeoutMs} ms.`
          : `Health check failed: ${message}`
      },
      timedOut ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }
}
