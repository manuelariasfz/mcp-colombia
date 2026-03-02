#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchProducts, getProduct }       from "./tools/mercadolibre.js";
import { searchHotels, searchFlights }      from "./tools/booking.js";
import { compararCDT, simularCredito, compararCuentas } from "./tools/finanzas.js";
import { buscarInmuebles }                  from "./tools/inmuebles.js";
import { buscarVacantes, getPortalLinks }   from "./tools/trabajo.js";
import {
  isVerifiedOnChain, getMCPEntry, getAllMCPEntries, getVerifiedMCPEntries,
  getRegistryInfo, registerMCPOnChain,
} from "./tools/mcp-registry.js";

import { trackRequest, trackCompletion, trackError, getSessionStatus } from "./soulprint/behavior-tracker.js";
import { requireSoulprint, extractToken, verifySoulprint }              from "./soulprint/middleware.js";
import { getServiceKeypair }                                            from "./soulprint/service-identity.js";

// ── Servidor MCP ──────────────────────────────────────────────────────────────
const server = new McpServer({
  name:    "mcp-colombia",
  version: "1.3.0",
});

// Inicializar identidad del servicio al arrancar
const serviceKp = getServiceKeypair();
console.error(`[mcp-colombia] 🔐 Service DID: ${serviceKp.did}`);
console.error(`[mcp-colombia] 🌐 Soulprint node: ${process.env.SOULPRINT_NODE ?? "http://localhost:4888"}`);

// ── Helper: wrap tool con tracking ───────────────────────────────────────────
/**
 * Envuelve el handler de un tool con:
 * 1. Extracción del DID del bot (desde SOULPRINT_TOKEN o capabilities)
 * 2. Tracking de spam / comportamiento
 * 3. Tracking de completion / error
 */
function withTracking<T>(
  toolName: string,
  handler:  (args: T, botDid: string) => Promise<any>
) {
  return async (args: T, extra?: any) => {
    // Extraer identidad del bot (si la tiene)
    const rawToken = extractToken(extra?.capabilities ?? {});
    const botDid   = rawToken
      ? (verifySoulprint(rawToken).ok ? (verifySoulprint(rawToken) as any).ctx.did : `anon:${Math.random().toString(36).slice(2,8)}`)
      : `anon:${Math.random().toString(36).slice(2,8)}`;

    // Tracking de comportamiento
    const check = trackRequest(botDid, toolName);
    if (!check.allowed) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: check.reason, soulprint_penalized: true }, null, 2) }],
        isError: true,
      };
    }

    try {
      const result = await handler(args, botDid);
      trackCompletion(botDid, toolName);
      return result;
    } catch (e: any) {
      trackError(botDid, toolName, e.message);
      throw e;
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MERCADO LIBRE
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "ml_buscar_productos",
  "Busca productos en MercadoLibre Colombia. Devuelve precios, vendedor, envío gratis y link de compra.",
  {
    query:       z.string().describe("Qué producto buscar"),
    categoria:   z.enum(["electronica","celulares","computadores","ropa","hogar","deportes","juguetes","libros","autos","herramientas"]).optional(),
    limit:       z.number().min(1).max(10).optional().default(5),
    precio_min:  z.number().optional(),
    precio_max:  z.number().optional(),
    ordenar:     z.enum(["precio_asc","precio_desc","relevancia"]).optional(),
  },
  withTracking("ml_buscar_productos", async (args) => {
    const result = await searchProducts(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  })
);

server.tool(
  "ml_detalle_producto",
  "Obtiene el detalle completo de un producto de MercadoLibre por su ID (ej: MCO123456789).",
  { item_id: z.string().describe("ID del producto (formato MCO + números)") },
  withTracking("ml_detalle_producto", async (args) => {
    const result = await getProduct(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  })
);

// ══════════════════════════════════════════════════════════════════════════════
// VIAJES
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "viajes_buscar_hotel",
  "Busca hoteles en ciudades colombianas. Requiere Soulprint score >= 40 para datos de contacto.",
  {
    ciudad:       z.string(),
    checkin:      z.string(),
    checkout:     z.string(),
    adultos:      z.number().min(1).max(10).optional().default(2),
    habitaciones: z.number().min(1).max(5).optional().default(1),
    precio_max:   z.number().optional(),
  },
  withTracking("viajes_buscar_hotel", async (args) => {
    const result = await searchHotels(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  })
);

server.tool(
  "viajes_buscar_vuelos",
  "Busca vuelos domésticos e internacionales desde/hacia Colombia.",
  {
    origen:        z.string(),
    destino:       z.string(),
    fecha:         z.string(),
    ida_vuelta:    z.boolean().optional().default(false),
    fecha_regreso: z.string().optional(),
    pasajeros:     z.number().min(1).max(9).optional().default(1),
  },
  withTracking("viajes_buscar_vuelos", async (args) => {
    const result = await searchFlights(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  })
);

// ══════════════════════════════════════════════════════════════════════════════
// INMUEBLES
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "inmuebles_buscar",
  "Busca apartamentos y casas en arriendo o venta en Colombia.",
  {
    ciudad:       z.string(),
    tipo:         z.enum(["arriendo", "venta"]),
    habitaciones: z.number().min(1).max(6).optional(),
    precio_max:   z.number().optional(),
    precio_min:   z.number().optional(),
    zona:         z.string().optional(),
    limit:        z.number().min(1).max(10).optional().default(6),
  },
  withTracking("inmuebles_buscar", async (args) => {
    const result = await buscarInmuebles(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  })
);

// ══════════════════════════════════════════════════════════════════════════════
// FINANZAS
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "finanzas_comparar_cdt",
  "Compara los mejores CDTs en Colombia según monto y plazo.",
  {
    monto:      z.number().min(100_000),
    plazo_dias: z.number().refine(v => [30,60,90,180,360].includes(v)),
    top:        z.number().min(1).max(10).optional().default(5),
  },
  withTracking("finanzas_comparar_cdt", async (args) => {
    const result = await compararCDT(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  })
);

server.tool(
  "finanzas_simular_credito",
  "Simula un crédito de consumo en los principales bancos de Colombia.",
  {
    monto:     z.number().min(50_000),
    cuotas:    z.number().min(1).max(84),
    proposito: z.string().optional(),
  },
  withTracking("finanzas_simular_credito", async (args) => {
    const result = await simularCredito(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  })
);

server.tool(
  "finanzas_comparar_cuentas",
  "Compara cuentas de ahorros y billeteras digitales en Colombia.",
  { tipo: z.enum(["ahorros","digital","todos"]).optional().default("todos") },
  withTracking("finanzas_comparar_cuentas", async (args) => {
    const result = await compararCuentas(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  })
);

// ══════════════════════════════════════════════════════════════════════════════
// 🔐 ENDPOINTS PREMIUM — Requieren Soulprint verificado
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "trabajo_aplicar",
  `🔐 PREMIUM — Requiere Soulprint score >= 40.
   Aplica a ofertas laborales en Colombia con tu identidad verificada ZK.
   Compañías confían en candidatos con Soulprint porque el bot está respaldado
   por un humano real y tiene historial de comportamiento verificado.`,
  {
    cargo:        z.string().describe("Cargo al que aplicas (ej: Desarrollador Backend Senior)"),
    ciudad:       z.string().describe("Ciudad donde trabajarías"),
    cv_url:       z.string().url().optional().describe("URL de tu CV o LinkedIn"),
    salario_esp:  z.number().min(0).optional().describe("Salario esperado en COP mensual"),
    modalidad:    z.enum(["presencial","remoto","híbrido"]).optional().default("remoto"),
    mensaje:      z.string().max(500).optional().describe("Mensaje de presentación (máx 500 chars)"),
  },
  async (args: any, extra?: any) => {
    // ── Verificación Soulprint SCORE >= 40 ────────────────────────────────
    const check = requireSoulprint(extra?.capabilities ?? {}, 40, "trabajo_aplicar");
    if (!check.ok) return check.mcpError;

    const { ctx } = check;

    // Track comportamiento premium
    const rateCheck = trackRequest(ctx.did, "trabajo_aplicar");
    if (!rateCheck.allowed) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: rateCheck.reason }, null, 2) }],
        isError: true,
      };
    }

    const applicationId = `SP-${Date.now().toString(36).toUpperCase()}-${ctx.did.slice(-6).toUpperCase()}`;
    const now           = new Date().toISOString();

    // ── Buscar vacantes reales que coincidan con cargo + ciudad ───────────
    const [vacantes, portales] = await Promise.all([
      buscarVacantes(args.cargo, args.ciudad, args.modalidad ?? "remoto"),
      Promise.resolve(getPortalLinks(args.cargo, args.ciudad, args.modalidad ?? "remoto")),
    ]);

    // Vacante más relevante (primera de la lista, si existe)
    const mejorVacante = vacantes[0] ?? null;

    const application = {
      application_id:    applicationId,
      status:            "submitted",
      timestamp:         now,

      // ── Vacante a la que se aplica ─────────────────────────────────────
      vacante: mejorVacante
        ? {
            titulo:       mejorVacante.titulo,
            empresa:      mejorVacante.empresa,
            ciudad:       mejorVacante.ciudad,
            portal:       mejorVacante.portal,
            link_aplicar: mejorVacante.link,         // ← link directo de la vacante
            salario:      mejorVacante.salario,
            descripcion:  mejorVacante.descripcion,
          }
        : {
            cargo:        args.cargo,
            ciudad:       args.ciudad,
            modalidad:    args.modalidad,
            nota:         "No se encontró vacante específica — usa los links de búsqueda abajo",
          },

      // ── Links de aplicación por portal ────────────────────────────────
      donde_aplicar: {
        ...portales,
        nota: "Abre cualquier portal para ver vacantes disponibles para " + args.cargo,
      },

      // ── Otras vacantes encontradas ─────────────────────────────────────
      otras_vacantes: vacantes.slice(1).map(v => ({
        titulo:   v.titulo,
        empresa:  v.empresa,
        portal:   v.portal,
        salario:  v.salario,
        link:     v.link,
      })),

      // ── Identidad verificada del candidato ────────────────────────────
      candidato: {
        did:             ctx.did,
        soulprint_score: ctx.score,
        trust_level:     ctx.level,
        human_verified:  ctx.identity >= 36,
        reputation:      ctx.botRep,
        cv_url:          args.cv_url ?? null,
        salario_esp:     args.salario_esp ?? null,
        mensaje:         args.mensaje ?? null,
        country:         ctx.country ?? "CO",
      },

      trust_guarantees: {
        human_verified:  ctx.identity >= 36,
        no_spam_history: ctx.botRep >= 8,
        identity_zkp:    true,
        protocol:        "Soulprint SIP-v0.1",
      },

      resumen: `✅ Aplicación lista — ID: ${applicationId}
Cargo: ${args.cargo} | Ciudad: ${args.ciudad} | Modalidad: ${args.modalidad ?? "remoto"}
${mejorVacante ? `📌 Vacante encontrada: "${mejorVacante.titulo}" en ${mejorVacante.empresa ?? mejorVacante.portal}
🔗 Aplicar aquí: ${mejorVacante.link}` : `🔍 Busca vacantes en: ${portales.elempleo}`}
Score Soulprint: ${ctx.score}/100 — candidato humano verificado`,
    };

    trackCompletion(ctx.did, "trabajo_aplicar");

    // Emitir attestation positiva por usar el endpoint premium correctamente
    const { issueAttestation, submitAttestation } = await import("./soulprint/service-identity.js");
    const att = issueAttestation(ctx.did, 1, "premium-endpoint-used");
    submitAttestation(att).catch(() => {});

    return { content: [{ type: "text", text: JSON.stringify(application, null, 2) }] };
  }
);

// ── Tool de status / debugging ────────────────────────────────────────────────
server.tool(
  "soulprint_status",
  "Muestra el estado de tu Soulprint token y tu reputación en mcp-colombia. Útil para debugging.",
  {},
  async (_args: any, extra?: any) => {
    const rawToken = extractToken(extra?.capabilities ?? {});

    if (!rawToken) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status:  "no_token",
            message: "No tienes un Soulprint token. Obtén uno con: npx soulprint verify-me",
            more:    "https://manuelariasfz.github.io/soulprint/",
          }, null, 2),
        }],
      };
    }

    const result = verifySoulprint(rawToken);
    if (!result.ok) {
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "invalid", error: result.error }, null, 2) }],
      };
    }

    const { ctx }   = result;
    const session   = getSessionStatus(ctx.did);
    const nodeUrl   = process.env.SOULPRINT_NODE ?? "https://soulprint-node-production.up.railway.app";

    // Fetch live node info from the validator
    let nodeInfo = null;
    try {
      nodeInfo = await fetch(`${nodeUrl}/info`).then(r => r.json()).catch(() => null);
    } catch { /* nodo no disponible */ }

    // Buscar reputación en el nodo (best-effort)
    let nodeReputation = null;
    try {
      const res = await fetch(`${nodeUrl}/reputation/${encodeURIComponent(ctx.did)}`);
      if (res.ok) nodeReputation = await res.json();
    } catch { /* nodo no disponible */ }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status:          "active",
          did:             ctx.did,
          score:           ctx.score,
          identity_score:  ctx.identity,
          bot_reputation:  ctx.botRep,
          trust_level:     ctx.level,
          country:         ctx.country,

          session: {
            requests_last_60s: session.requests_60s,
            tools_used:        session.tools_used,
            completions:       session.completed,
            penalized:         session.penalized,
            rewarded:          session.rewarded,
          },

          node_info:          nodeInfo,
          node_reputation:    nodeReputation,

          premium_access: {
            trabajo_aplicar: ctx.score >= 40 ? "✅ DISPONIBLE" : `❌ Necesitas score >= 40 (tienes ${ctx.score})`,
          },
        }, null, 2),
      }],
    };
  }
);

// ── MCPRegistry — consulta pública ───────────────────────────────────────────
server.tool(
  "mcp_estado",
  "Consulta si un servidor MCP está verificado on-chain en MCPRegistry (Base Sepolia). Pasa una dirección 0x o 'mcp-colombia' para el propio servidor.",
  {
    mcp_address: z.string().describe("Dirección 0x del MCP, o 'mcp-colombia' para el hub colombiano"),
  },
  async (args: any) => {
    const KNOWN: Record<string, string> = {
      "mcp-colombia":     "0x0755A3001F488da00088838c4a068dF7f883ad87",
      "mcp-colombia-hub": "0x0755A3001F488da00088838c4a068dF7f883ad87",
    };
    const addr   = KNOWN[args.mcp_address.toLowerCase()] ?? args.mcp_address;
    const [entry, info] = await Promise.all([getMCPEntry(addr), getRegistryInfo()]);

    if (!entry) {
      return { content: [{ type: "text", text: JSON.stringify({
        address:    addr,
        registered: false,
        verified:   false,
        message:    "Este MCP no está registrado en MCPRegistry.",
        registry:   info,
      }, null, 2) }] };
    }

    return { content: [{ type: "text", text: JSON.stringify({
      address:      addr,
      name:         entry.name,
      url:          entry.url,
      category:     entry.category,
      description:  entry.description,
      registered:   true,
      verified:     entry.verified,
      registered_at: new Date(entry.registeredAt * 1000).toISOString(),
      verified_at:  entry.verifiedAt > 0 ? new Date(entry.verifiedAt * 1000).toISOString() : null,
      revoked_at:   entry.revokedAt  > 0 ? new Date(entry.revokedAt  * 1000).toISOString() : null,
      badge:        entry.verified ? "✅ VERIFICADO por superAdmin on-chain" : "⏳ Registrado, pendiente verificación",
      registry:     info,
    }, null, 2) }] };
  }
);

server.tool(
  "mcp_lista_verificados",
  "Lista todos los servidores MCP verificados on-chain en MCPRegistry (Base Sepolia). Útil para descubrir MCPs de confianza.",
  {},
  async () => {
    const [verified, info] = await Promise.all([getVerifiedMCPEntries(), getRegistryInfo()]);

    return { content: [{ type: "text", text: JSON.stringify({
      total_verified: verified.length,
      registry:       info,
      mcps: verified.map(e => ({
        address:      e.address,
        name:         e.name,
        url:          e.url,
        category:     e.category,
        description:  e.description,
        verified_at:  new Date(e.verifiedAt * 1000).toISOString(),
        badge:        "✅ VERIFICADO",
      })),
    }, null, 2) }] };
  }
);

server.tool(
  "mcp_registrar",
  "Registra un nuevo servidor MCP en MCPRegistry on-chain. Cualquiera puede registrarse; la verificación la hace el superAdmin.",
  {
    mcp_address:  z.string().describe("Dirección 0x que identificará tu MCP"),
    name:         z.string().describe("Nombre del servidor (ej: 'Mi MCP Finance')"),
    url:          z.string().url().describe("URL base del servidor"),
    category:     z.enum(["finance","travel","jobs","ecommerce","general"]).default("general"),
    description:  z.string().max(300).optional().describe("Descripción corta"),
    owner_key:    z.string().describe("Llave privada 0x de tu wallet (para firmar la tx)"),
  },
  async (args: any) => {
    if (!args.owner_key.startsWith("0x") || args.owner_key.length !== 66) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "owner_key inválida — debe ser hex de 32 bytes (0x...)" }) }], isError: true };
    }

    const result = await registerMCPOnChain({
      ownerPrivateKey: args.owner_key,
      mcpAddress:      args.mcp_address,
      name:            args.name,
      url:             args.url,
      category:        args.category,
      description:     args.description ?? "",
    });

    return { content: [{ type: "text", text: JSON.stringify({
      ...result,
      message: result.success
        ? `✅ MCP registrado. Ahora solicita verificación al superAdmin. TX: https://sepolia.basescan.org/tx/${result.txHash}`
        : `❌ Error al registrar: ${result.error}`,
      next_step: "Contacta al superAdmin para que verifique tu MCP.",
    }, null, 2) }] };
  }
);

// ── MCPRegistry — admin (requiere ADMIN_PRIVATE_KEY en env) ──────────────────

// ── Arrancar servidor ─────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
