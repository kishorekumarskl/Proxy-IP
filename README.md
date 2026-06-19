# Private Proxy & Network Manager

A user-friendly Next.js dashboard for managing **your own authorized** private proxies, VM exit IPs, and Tailscale exit nodes. It helps you register nodes, view connection details, run health checks through selected HTTP/HTTPS proxy nodes, measure latency, and detect blocked or access-denied responses.

This application is designed for legitimate private network operations, QA, internal access testing, and connectivity monitoring. It is **not** an open proxy, crawler, scraper, or bypass tool.

## Features

- Node dashboard with name, IP/host, port, type, location, status, and latency.
- Add/edit/delete node modal for residential proxies, datacenter proxies, and Tailscale exit nodes.
- Live health checker through selected HTTP/HTTPS proxy node.
- Robust handling for timeouts, HTTP errors, and access-denied/security-filter pages.
- Target allowlist to prevent the health-check endpoint from becoming a generic URL fetcher.
- Dynamic copy-paste connection instructions for browser/system proxy, mobile Wi‑Fi proxy, cURL, and Tailscale.
- Responsive Tailwind CSS interface.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Next.js API routes running on Node.js
- `undici` `ProxyAgent` for server-side HTTP/HTTPS proxy health checks
- `zod` request validation

## Project Structure

```txt
app/
  api/health-check/route.ts     # Server-side health-check API
  globals.css                   # Tailwind + global styles
  layout.tsx                    # Root layout
  page.tsx                      # Dashboard page
components/
  ConnectionInstructions.tsx
  CopyButton.tsx
  HealthCheckPanel.tsx
  NodeFormModal.tsx
  NodeManager.tsx
  NodeTable.tsx
  StatusBadge.tsx
lib/
  rateLimit.ts                  # Simple in-memory API rate limiter
  sampleNodes.ts                # Placeholder demo nodes
  storage.ts                    # Browser localStorage persistence
  types.ts                      # Shared TypeScript types
  urlPolicy.ts                  # Target URL allowlist enforcement
  utils.ts
```

## Getting Started

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env.local
```

Start the development server:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

## Environment Variables

```env
HEALTHCHECK_ALLOWED_TARGETS=https://example.com,https://api.ipify.org
HEALTHCHECK_TIMEOUT_MS=12000
HEALTHCHECK_RATE_LIMIT_PER_MINUTE=30
```

### `HEALTHCHECK_ALLOWED_TARGETS`

Comma-separated allowed URL prefixes for health checks. Keep this restrictive in production.

Good examples:

```env
HEALTHCHECK_ALLOWED_TARGETS=https://example.com,https://api.mycompany.com/health,https://ifconfig.me
```

The API route rejects targets outside this allowlist and blocks obvious loopback/private targets to reduce SSRF risk.

## Important Security Notes

1. The included dashboard stores nodes in browser `localStorage` for simple self-hosted use and fast prototyping. For a multi-user production deployment, move node credentials to a database and encrypt secrets at rest.
2. Do not expose this dashboard publicly without authentication. Add SSO, NextAuth, Clerk, or your preferred auth provider before internet deployment.
3. Keep the health-check allowlist strict. Do not allow arbitrary user-supplied URLs in production.
4. Use only proxy credentials, residential IPs, VM IPs, and Tailscale nodes you own or are explicitly authorized to use.
5. The health checker reports access-denied or blocked pages. It does not attempt to bypass them.

## Production Hardening Checklist

- Add authentication and role-based access control.
- Move node persistence from localStorage to a database.
- Encrypt proxy credentials with KMS or a server-side encryption key.
- Add audit logs for node creation, edits, deletes, and health checks.
- Restrict API access using CSRF protection and session checks.
- Add a persistent rate limiter such as Redis/Upstash instead of in-memory rate limiting.
- Deploy only behind HTTPS.
- Add alerting for repeated failures or high latency.

## Supported Proxy Types

The UI supports Residential, Datacenter, and Tailscale node records.

The server-side health-check API supports HTTP and HTTPS proxy endpoints via `undici` `ProxyAgent`. Tailscale checks should be performed locally after activating the exit node using the generated Tailscale command. SOCKS5 appears as a UI placeholder; add a SOCKS dispatcher if your provider specifically requires SOCKS5.

## Build

```bash
npm run build
npm run start
```

## License

Private/internal use. Review dependencies and legal requirements before commercial deployment.
