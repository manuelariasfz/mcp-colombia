# 🇨🇴 mcp-colombia-hub

**MCP server** que conecta cualquier agente de IA con servicios colombianos — con identidad verificada y reputación de comportamiento mediante **[Soulprint](https://github.com/manuelariasfz/soulprint)**.

[![npm](https://img.shields.io/npm/v/mcp-colombia-hub)](https://www.npmjs.com/package/mcp-colombia-hub)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![Soulprint Verified](https://img.shields.io/badge/Soulprint-verified%20service-7c6cf5)](https://github.com/manuelariasfz/soulprint)
[![Tests](https://img.shields.io/badge/tests-37%2F37-brightgreen)](#tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🚀 Instalación en 30 segundos

### Claude Desktop / Cursor / Copilot

Edita tu archivo de configuración MCP:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-colombia": {
      "command": "npx",
      "args": ["-y", "mcp-colombia-hub"]
    }
  }
}
```

Con identidad verificada (endpoints premium):

```json
{
  "mcpServers": {
    "mcp-colombia": {
      "command": "npx",
      "args": ["-y", "mcp-colombia-hub"],
      "env": {
        "SOULPRINT_TOKEN": "tu-token-aqui"
      }
    }
  }
}
```

---

## 🛠️ Herramientas disponibles

### 🛍️ MercadoLibre (Colombia)
| Tool | Descripción |
|---|---|
| `ml_buscar_productos` | Busca productos con precio, vendedor y link directo |
| `ml_detalle_producto` | Detalle completo de un producto por ID |

### ✈️ Viajes
| Tool | Descripción |
|---|---|
| `viajes_buscar_vuelos` | Vuelos desde/hacia Colombia (via Booking.com) |
| `viajes_buscar_hotel` | Hoteles con precio por noche en pesos colombianos |

### 💰 Finanzas
| Tool | Descripción |
|---|---|
| `finanzas_comparar_cdt` | Compara CDTs de bancos colombianos |
| `finanzas_simular_credito` | Simula créditos (cuota mensual, total a pagar) |
| `finanzas_comparar_cuentas` | Compara cuentas de ahorro y corrientes |

### 🏠 Inmuebles
| Tool | Descripción |
|---|---|
| `inmuebles_buscar` | Busca apartamentos/casas en venta o arriendo (Ciencuadras) |

### 🌀 Soulprint (identidad y reputación)
| Tool | Descripción | Requiere |
|---|---|---|
| `soulprint_status` | Ver tu score, DID, sesión y reputación | Opcional |
| `trabajo_aplicar` | **PREMIUM** — Aplica a empleos con identidad verificada | **Score ≥ 40** |

---

## 🌀 Integración con Soulprint

mcp-colombia-hub es el **primer servicio verificado** del ecosistema Soulprint. Cada llamada a las herramientas es monitoreada automáticamente:

### Comportamiento → Reputación

```
🔴 Spam (>5 requests en 60s)  →  -1 attestation a tu DID
🟢 Uso normal (3+ tools, 3+ completions sin spam)  →  +1 attestation
```

### Endpoint premium — `trabajo_aplicar`

Requiere **Soulprint score ≥ 40** (identidad básica verificada):

```bash
# Verificar tu identidad primero
npx soulprint verify-me --selfie yo.jpg --document cedula.jpg

# El token se inyecta automáticamente vía SOULPRINT_TOKEN
```

**Respuesta de `trabajo_aplicar`:**
```json
{
  "application_id": "SP-M9X3K2-Z6MK4F",
  "applicant": {
    "did":      "did:key:z6Mk...",
    "score":    97,
    "verified": true
  },
  "trust_guarantees": {
    "human_verified":  true,
    "no_spam_history": true,
    "zkp":             true
  }
}
```

Los empleadores ven un candidato **verificado** — sin nombre, sin cédula, solo prueba matemática de que eres un humano real con historial limpio.

---

## 📦 Estructura del proyecto

```
src/
├── index.ts              # Servidor MCP principal (10 tools)
├── tools/
│   ├── mercadolibre.ts   # Búsqueda ML con fallback Brave Search
│   ├── booking.ts        # Vuelos + hoteles (Booking.com / Awin)
│   ├── finanzas.ts       # CDT, crédito, cuentas
│   └── inmuebles.ts      # Ciencuadras JSON-LD scraping
└── soulprint/
    ├── service-identity.ts  # DID del servicio, token SPT (score=80)
    ├── behavior-tracker.ts  # Tracking spam/recompensas por DID
    └── middleware.ts        # extractToken(), verifySoulprint(), requireSoulprint()

tests/
└── soulprint.test.ts     # 37 tests (unit + integración + pen tests)
```

---

## 🧪 Tests

```bash
npm test
```

```
[A] TESTS UNITARIOS (16 tests)
  ✅ Service identity — DID, keypair, token score=80
  ✅ Behavior tracker — spam detection, rewards, error reset
  ✅ Middleware — token extraction, verification, minScore

[B] TESTS DE INTEGRACIÓN (12 tests)
  ✅ Bot anónimo — tools básicas OK, trabajo_aplicar BLOQUEADO
  ✅ Bot low-score — bloqueado del endpoint premium
  ✅ Bot premium (score=100) — acceso total
  ✅ Ciclo de recompensa — +1 tras 3 completions en 3 tools
  ✅ Ciclo de penalización — -1 tras spam detectado

[C] TESTS DE PENETRACIÓN (9 tests)
  ✅ Score inflation ×50 → RECHAZADO
  ✅ DID substitution ×20 → RECHAZADO
  ✅ 100 fake attestations → SCORE SIN CAMBIO
  ✅ Sybil attack → BLOQUEADO por nodo
  ✅ Spam en endpoint premium → -1 rep

Total: 37/37 ✅
```

---

## 🔧 Desarrollo

```bash
git clone https://github.com/manuelariasfz/mcp-colombia
cd mcp-colombia
npm install
npm run build
npm test
```

**Variables de entorno opcionales:**
```bash
BRAVE_API_KEY=...         # Para búsqueda fallback en ML
SOULPRINT_NODE=http://... # Nodo Soulprint (default: localhost:4888)
SOULPRINT_TOKEN=...       # Token SPT del bot usuario
```

---

## 🤝 Relación con Soulprint

| Proyecto | Rol |
|---|---|
| [soulprint](https://github.com/manuelariasfz/soulprint) | Protocolo de identidad (7 paquetes npm) |
| **mcp-colombia-hub** | Primer servicio verificado del ecosistema |

---

## 📄 Licencia

MIT — Felipe Arias · [@manuelariasfz](https://github.com/manuelariasfz)
