# mcp-colombia-hub — Architecture (v1.2.0)

> Technical reference for the mcp-colombia-hub MCP server.  
> The first Soulprint-verified service in the ecosystem.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Request Lifecycle](#2-request-lifecycle)
3. [Soulprint Integration](#3-soulprint-integration)
4. [Behavior Tracker](#4-behavior-tracker)
5. [Tool Architecture](#5-tool-architecture)
6. [Data Sources](#6-data-sources)
7. [Service Identity](#7-service-identity)
8. [File Structure](#8-file-structure)
9. [Configuration](#9-configuration)
10. [Error Handling](#10-error-handling)

---

## 1. Overview

mcp-colombia-hub is an **MCP (Model Context Protocol) server** that exposes 10 tools covering Colombian services: product search, travel, finance, real estate, and premium job applications.

It is the **first verified service** in the [Soulprint](https://github.com/manuelariasfz/soulprint) ecosystem, meaning it:

- Has its own Soulprint DID (score = 80)
- Issues behavioral attestations (+1/-1) to bot DIDs
- Gates the `trabajo_aplicar` endpoint at score ≥ 95

```
Claude / Cursor / any MCP client
        │
        │ MCP protocol (stdio / HTTP)
        ▼
┌───────────────────────────────────────────────┐
│             mcp-colombia-hub                  │
│                                               │
│  ┌──────────────┐   ┌─────────────────────┐  │
│  │ MCP Server   │   │  Soulprint Layer     │  │
│  │              │   │                      │  │
│  │  10 tools    │──▶│  extractToken()      │  │
│  │  withTracking│   │  verifySoulprint()   │  │
│  │  wrapper     │   │  trackRequest()      │  │
│  └──────────────┘   │  trackCompletion()   │  │
│                     │  issueAttestation()  │  │
│  ┌──────────────┐   └─────────────────────┘  │
│  │  Data APIs   │                             │
│  │              │                             │
│  │  MercadoLibre│                             │
│  │  Booking/Awin│                             │
│  │  Finanzas    │                             │
│  │  Ciencuadras │                             │
│  └──────────────┘                             │
└───────────────────────────────────────────────┘
        │                   │
        ▼                   ▼
 Colombian APIs     Soulprint Validator Node
                    (localhost:4888 by default)
```

---

## 2. Request Lifecycle

Every tool call follows this pipeline:

```
MCP Client
    │
    │ tool call + optional capabilities.identity.soulprint
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    withTracking() wrapper                    │
│                                                             │
│  1. extractDID(extra?.capabilities)                         │
│     → "did:key:z6Mk..." (verified) OR "anon:<random>" (none)│
│                                                             │
│  2. trackRequest(botDid, toolName)                          │
│     → check spam window (>5 req/60s?)                       │
│     → if spam: issue -1 attestation, return error           │
│     → if ok: record request, continue                       │
│                                                             │
│  3. [PREMIUM ONLY] requireSoulprint(capabilities, 95)       │
│     → verifySoulprint(token, 95)                            │
│     → if score < 95: return MCP error                       │
│                                                             │
│  4. handler(args, botDid)                                   │
│     → call data API                                         │
│     → return result                                         │
│                                                             │
│  5a. trackCompletion(botDid, toolName)                      │
│      → if 3+ distinct tools + 3+ completions + no spam:    │
│           issue +1 attestation                              │
│                                                             │
│  5b. [on error] trackError(botDid, toolName, message)       │
│      → accumulate error count                              │
│      → if 3+ consecutive errors: log warning               │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
MCP Client ← tool result
```

---

## 3. Soulprint Integration

### middleware.ts

```typescript
// Token extraction — checks multiple locations in order
extractToken(capabilities):
  1. capabilities?.identity?.soulprint     ← MCP standard
  2. process.env.SOULPRINT_TOKEN           ← env var fallback
  3. null                                   ← anonymous

// Token verification
verifySoulprint(token, minScore?):
  1. decodeToken(token)                    ← base64url decode
  2. verifySig(decoded)                    ← Ed25519 verify
  3. check: decoded.expires > now          ← not expired
  4. check: decoded.score >= minScore      ← if minScore set
  → returns: { ok: true, ctx } OR { ok: false, error }

// Full requirement check (used by trabajo_aplicar)
requireSoulprint(capabilities, minScore, toolName):
  1. extractToken(capabilities)
  2. if null: return { ok: false, mcpError }
  3. verifySoulprint(token, minScore)
  4. if not ok: return { ok: false, mcpError with score info }
  5. return { ok: true, ctx }
```

### DID extraction for anonymous bots

```typescript
function extractDIDFromToken(capabilities) {
  const token = extractToken(capabilities);
  if (!token) return `anon:${randomHex(8)}`;     // anonymous session
  const decoded = decodeToken(token);
  if (!decoded) return `anon:${randomHex(8)}`;   // invalid token
  return decoded.did;                             // verified DID
}
```

Anonymous bots can still use all standard tools — they just can't access premium endpoints and their reputation isn't tracked across services (anonymous DIDs are ephemeral).

### Score requirements by tool

| Tool | Min Score | Why |
|---|---|---|
| `ml_buscar_productos` | None | Public search |
| `ml_detalle_producto` | None | Public data |
| `viajes_buscar_vuelos` | None | Public search |
| `viajes_buscar_hotel` | None | Public search |
| `finanzas_comparar_cdt` | None | Public rates |
| `finanzas_simular_credito` | None | Calculator |
| `finanzas_comparar_cuentas` | None | Public rates |
| `inmuebles_buscar` | None | Public listings |
| `soulprint_status` | None | Debug tool |
| **`trabajo_aplicar`** | **95** | Verified human required |

---

## 4. Behavior Tracker

### Session structure

```typescript
interface BotSession {
  did:          string;
  requests:     number[];   // unix timestamps of requests in last 60s
  toolsUsed:    Set<string>;
  completed:    number;     // successful completions
  errors:       number;     // consecutive errors (reset on completion)
  lastRequest:  number;
  spamWarnings: number;
  penalized:    boolean;    // true if -1 already issued this session
  rewarded:     boolean;    // true if +1 already issued this session
}
```

### Spam detection

```
SPAM_THRESHOLD = 5 requests
SPAM_WINDOW_MS = 60,000ms (60 seconds)

trackRequest(did, tool):
  1. Push timestamp to session.requests
  2. Filter: remove timestamps older than 60s
  3. if requests.length > 5:
       session.spamWarnings++
       if !session.penalized:
         issueAttestation(did, -1, "spam-detected")
         submitAttestation(att)  // async, fire-and-forget
         session.penalized = true
       return { allowed: false, reason: "Rate limit..." }
  4. session.toolsUsed.add(tool)
  5. return { allowed: true }
```

### Reward logic

```
REWARD_MIN_TOOLS       = 3 distinct tools
REWARD_MIN_COMPLETIONS = 3

trackCompletion(did, tool):
  session.completed++
  session.errors = 0   // reset consecutive errors
  if (session.completed >= 3
      && session.toolsUsed.size >= 3
      && session.spamWarnings === 0
      && !session.rewarded):
    issueAttestation(did, +1, "normal-usage-pattern")
    submitAttestation(att)
    session.rewarded = true
```

### Attestation submission

```typescript
async submitAttestation(att):
  const nodeUrl = process.env.SOULPRINT_NODE ?? "http://localhost:4888";
  const serviceToken = getServiceToken();
  try:
    POST ${nodeUrl}/reputation/attest
    body: { attestation: att, service_spt: serviceToken }
    timeout: 5000ms
  catch:
    console.error("[soulprint] offline — attestation logged to stderr")
    // Non-blocking: tool execution continues regardless
```

Sessions are **in-memory** (Map keyed by DID). They reset when the server restarts. This is intentional — the validator network provides cross-session persistence.

---

## 5. Tool Architecture

### withTracking() wrapper

```typescript
function withTracking(toolName: string, handler: ToolHandler): ToolHandler {
  return async (args, extra) => {
    const botDid = extractDIDFromToken(extra?.capabilities);

    // Spam check
    const check = trackRequest(botDid, toolName);
    if (!check.allowed) {
      return {
        content: [{ type: "text", text: `⛔ ${check.reason}` }],
        isError: true,
      };
    }

    try {
      const result = await handler(args, botDid);
      trackCompletion(botDid, toolName);
      return result;
    } catch (err) {
      trackError(botDid, toolName, err.message);
      throw err;
    }
  };
}
```

### Tool implementations

```
ml_buscar_productos
  ├── Primary:  GET https://api.mercadolibre.com/sites/MCO/search
  │             ?q=<query>&limit=10
  │             Headers: Authorization: Bearer <ML_TOKEN>
  └── Fallback: Brave Search API
                GET https://api.search.brave.com/res/v1/web/search
                ?q=<query> site:articulo.mercadolibre.com.co
                (used when ML API returns 403 from server IP)

ml_detalle_producto
  └── GET https://api.mercadolibre.com/items/<id>

viajes_buscar_vuelos / viajes_buscar_hotel
  └── Booking.com via Awin affiliate network
      GET https://api.awin.com/publishers/2784246/...
      Merchant: 6776 (Booking.com Colombia)

finanzas_comparar_cdt / finanzas_simular_credito / finanzas_comparar_cuentas
  └── Static/scraped data from Colombian financial institutions
      (Bancolombia, Davivienda, BBVA, Nequi, Nubank, etc.)

inmuebles_buscar
  └── Ciencuadras JSON-LD scraping
      GET https://www.ciencuadras.com/busqueda?...
      Extract: application/ld+json → ListingPage → offers[]

trabajo_aplicar  [PREMIUM — score >= 95]
  ├── requireSoulprint(capabilities, 95)
  ├── Verify: ctx.score >= 95
  ├── Build application object:
  │     application_id: SP-<timestamp>-<did_suffix>
  │     applicant: { did, score, level, verified: true }
  │     trust_guarantees: { human_verified, no_spam_history, zkp }
  └── Return verified application (no PII)

soulprint_status  [DEBUG]
  └── Returns: { token_present, did, score, identity, bot_rep,
                 level, country, session_stats, node_url }
```

---

## 6. Data Sources

| Tool | Source | Auth | Fallback |
|---|---|---|---|
| ML search | MercadoLibre API (MCO) | OAuth2 client_credentials | Brave Search |
| ML detail | MercadoLibre API | OAuth2 | None |
| Flights | Booking.com / Awin | Awin token | None |
| Hotels | Booking.com / Awin | Awin token | None |
| Finanzas | Static + scraped | None | None |
| Inmuebles | Ciencuadras JSON-LD | None (public) | None |
| trabajo_aplicar | Internal | Soulprint ≥ 95 | N/A |

### ML OAuth flow

```
Startup:
  POST https://api.mercadolibre.com/oauth/token
  body: grant_type=client_credentials
        &client_id=<ML_CLIENT_ID>
        &client_secret=<ML_CLIENT_SECRET>
  → access_token (valid ~6h)
  → stored in memory, auto-refreshed on 401
```

---

## 7. Service Identity

mcp-colombia-hub has its own **Soulprint DID and service token**. This is what qualifies it to issue attestations.

```typescript
// service-identity.ts

getServiceKeypair():
  1. Check ~/.soulprint/services/mcp-colombia/keypair.json
  2. If exists: load and return
  3. If not: generate Ed25519 keypair, save (mode 0600), return
  → { did: "did:key:z6Mk...", publicKey, privateKey }

getServiceToken():
  1. If cached token not expired: return cached
  2. Build token with credentials that yield score = 80:
       ["DocumentVerified","FaceMatch","BiometricBound","GitHubLinked"]
       identity = 20+16+8+16 = 60
       bot_rep  = { score: 20, ... }
       total    = 80
  3. Sign with service keypair
  4. Cache for 23h
  → base64url SPT string

issueAttestation(targetDid, value, context):
  1. getServiceKeypair()
  2. createAttestation(kp, targetDid, value, context)
  → BotAttestation (Ed25519 signed)
```

**Why score = 80?**  
The service achieves score 80 by combining 4 credentials (60 pts identity) + max reputation (20 pts). This gives it authority to issue attestations (requires ≥ 60) with significant weight.

---

## 8. File Structure

```
mcp-colombia/
├── src/
│   ├── index.ts                 Main MCP server (startup + tool registration)
│   ├── tools/
│   │   ├── mercadolibre.ts      ML search + detail + OAuth
│   │   ├── booking.ts           Flights + hotels (Booking/Awin)
│   │   ├── finanzas.ts          CDT + credit + accounts
│   │   └── inmuebles.ts         Ciencuadras JSON-LD
│   └── soulprint/
│       ├── service-identity.ts  Service DID + token + attestation issuer
│       ├── behavior-tracker.ts  Spam detection + reward logic + sessions
│       └── middleware.ts        extractToken + verifySoulprint + requireSoulprint
├── tests/
│   ├── soulprint.test.ts        37 tests (16 unit + 12 integration + 9 pen)
│   └── integration-runner.js    Nightly runner (431 tests × 5 modes)
├── dist/                        TypeScript compiled output
├── package.json                 v1.2.0
├── tsconfig.json                ES2022, NodeNext modules
├── README.md
└── ARCHITECTURE.md              ← this file
```

---

## 9. Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `SOULPRINT_TOKEN` | — | SPT token from the calling bot |
| `SOULPRINT_NODE` | `http://localhost:4888` | Soulprint validator node URL |
| `ML_CLIENT_ID` | — | MercadoLibre OAuth client ID |
| `ML_CLIENT_SECRET` | — | MercadoLibre OAuth secret |
| `BRAVE_API_KEY` | — | Brave Search fallback (ML 403 bypass) |
| `AWIN_TOKEN` | — | Awin affiliate API token |

### MCP client config

```json
{
  "mcpServers": {
    "mcp-colombia": {
      "command": "npx",
      "args": ["-y", "mcp-colombia-hub"],
      "env": {
        "SOULPRINT_TOKEN": "<bot-spt-token>",
        "ML_CLIENT_ID": "<id>",
        "ML_CLIENT_SECRET": "<secret>",
        "BRAVE_API_KEY": "<key>"
      }
    }
  }
}
```

---

## 10. Error Handling

### MCP error format

```typescript
// Standard error return for MCP tools
{
  content: [{ type: "text", text: "Error message" }],
  isError: true
}
```

### Error categories

| Category | HTTP equiv | When |
|---|---|---|
| Spam blocked | 429 | > 5 requests in 60s |
| No identity | 401 | trabajo_aplicar without token |
| Score too low | 403 | Score < 95 for premium endpoint |
| API failure | 502 | Upstream API unavailable |
| Invalid params | 400 | Missing required tool args |

### Soulprint node offline

If the Soulprint validator node is unreachable, attestations are logged to stderr but **do not block tool execution**. The service degrades gracefully — tools continue working, reputation updates are deferred.

```
[soulprint] Validator node offline — attestation queued to stderr
{
  "issuer_did": "did:key:z6Mk...",
  "target_did": "did:key:z6Mk...",
  "value": 1,
  "context": "normal-usage-pattern",
  ...
}
```

---

*Last updated: v1.2.0 — February 2026*  
*Soulprint protocol: https://github.com/manuelariasfz/soulprint*  
*GitHub: https://github.com/manuelariasfz/mcp-colombia*
