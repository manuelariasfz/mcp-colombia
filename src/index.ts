#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchProducts, getProduct }       from "./tools/mercadolibre.js";
import { searchHotels, searchFlights }      from "./tools/booking.js";
import { compararCDT, simularCredito, compararCuentas } from "./tools/finanzas.js";
import { buscarInmuebles }                  from "./tools/inmuebles.js";

// ── Servidor MCP ────────────────────────────────────────────────────────────
const server = new McpServer({
  name:    "mcp-colombia",
  version: "0.1.0",
});

// ══════════════════════════════════════════════════════════════════════════════
// MERCADO LIBRE
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "ml_buscar_productos",
  "Busca productos en MercadoLibre Colombia. Devuelve precios, vendedor, envío gratis y link de compra.",
  {
    query:       z.string().describe("Qué producto buscar"),
    categoria:   z.enum(["electronica","celulares","computadores","ropa","hogar","deportes","juguetes","libros","autos","herramientas"]).optional().describe("Filtrar por categoría"),
    limit:       z.number().min(1).max(10).optional().default(5).describe("Cantidad de resultados (máx 10)"),
    precio_min:  z.number().optional().describe("Precio mínimo en COP"),
    precio_max:  z.number().optional().describe("Precio máximo en COP"),
    ordenar:     z.enum(["precio_asc","precio_desc","relevancia"]).optional().describe("Ordenar resultados"),
  },
  async (args) => {
    const result = await searchProducts(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "ml_detalle_producto",
  "Obtiene el detalle completo de un producto de MercadoLibre por su ID (ej: MCO123456789).",
  {
    item_id: z.string().describe("ID del producto en MercadoLibre (formato MCO + números)"),
  },
  async (args) => {
    const result = await getProduct(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// VIAJES
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "viajes_buscar_hotel",
  "Busca hoteles en ciudades colombianas para las fechas indicadas. Devuelve sugerencias y link directo a Booking.com.",
  {
    ciudad:       z.string().describe("Ciudad destino (Bogotá, Medellín, Cartagena, Cali, Santa Marta, Barranquilla, San Andrés...)"),
    checkin:      z.string().describe("Fecha de llegada en formato YYYY-MM-DD"),
    checkout:     z.string().describe("Fecha de salida en formato YYYY-MM-DD"),
    adultos:      z.number().min(1).max(10).optional().default(2).describe("Número de adultos"),
    habitaciones: z.number().min(1).max(5).optional().default(1).describe("Número de habitaciones"),
    precio_max:   z.number().optional().describe("Precio máximo por noche en COP"),
  },
  async (args) => {
    const result = await searchHotels(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "viajes_buscar_vuelos",
  "Busca vuelos domésticos e internacionales desde/hacia Colombia. Devuelve links a Avianca, LATAM y Skyscanner.",
  {
    origen:         z.string().describe("Ciudad/aeropuerto de origen (código IATA o nombre, ej: BOG, Bogotá)"),
    destino:        z.string().describe("Ciudad/aeropuerto de destino (ej: MDE, Medellín, MIA, Miami)"),
    fecha:          z.string().describe("Fecha de salida YYYY-MM-DD"),
    ida_vuelta:     z.boolean().optional().default(false).describe("Si es ida y vuelta"),
    fecha_regreso:  z.string().optional().describe("Fecha de regreso YYYY-MM-DD (solo si ida_vuelta=true)"),
    pasajeros:      z.number().min(1).max(9).optional().default(1).describe("Número de pasajeros"),
  },
  async (args) => {
    const result = await searchFlights(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// INMUEBLES
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "inmuebles_buscar",
  "Busca apartamentos y casas en arriendo o venta en Colombia. Busca en FincaRaíz y MetroCuadrado. Filtra por ciudad, precio, habitaciones y zona.",
  {
    ciudad:       z.string().describe("Ciudad (Bogotá, Medellín, Cali, Barranquilla, Bucaramanga, Cartagena, Pereira...)"),
    tipo:         z.enum(["arriendo", "venta"]).describe("Tipo de negocio: arriendo o venta"),
    habitaciones: z.number().min(1).max(6).optional().describe("Número de habitaciones (1-6)"),
    precio_max:   z.number().optional().describe("Precio máximo en COP (ej: 2000000 para $2M arriendo)"),
    precio_min:   z.number().optional().describe("Precio mínimo en COP"),
    zona:         z.string().optional().describe("Barrio o zona (ej: Chapinero, Laureles, El Poblado)"),
    limit:        z.number().min(1).max(10).optional().default(6).describe("Cantidad de resultados"),
  },
  async (args) => {
    const result = await buscarInmuebles(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// FINANZAS
// ══════════════════════════════════════════════════════════════════════════════

server.tool(
  "finanzas_comparar_cdt",
  "Compara los mejores CDTs (Certificados de Depósito a Término) disponibles en Colombia según monto y plazo. Muestra tasas, rendimiento real y links al banco.",
  {
    monto:      z.number().min(100_000).describe("Monto a invertir en COP (mínimo $100,000)"),
    plazo_dias: z.number().refine(v => [30,60,90,180,360].includes(v), { message: "Plazo debe ser 30, 60, 90, 180 o 360" }).describe("Plazo en días: 30, 60, 90, 180 o 360"),
    top:        z.number().min(1).max(10).optional().default(5).describe("Cuántos bancos mostrar"),
  },
  async (args) => {
    const result = await compararCDT(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "finanzas_simular_credito",
  "Simula un crédito de consumo o libre inversión en los principales bancos y fintechs de Colombia. Muestra cuota mensual, total a pagar y costo del crédito.",
  {
    monto:    z.number().min(50_000).describe("Monto del crédito en COP"),
    cuotas:   z.number().min(1).max(84).describe("Número de cuotas mensuales"),
    proposito: z.string().optional().describe("Para qué es el crédito (ej: comprar moto, viaje, deudas)"),
  },
  async (args) => {
    const result = await simularCredito(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "finanzas_comparar_cuentas",
  "Compara cuentas de ahorros y billeteras digitales en Colombia. Muestra rendimiento, cuota de manejo y GMF.",
  {
    tipo: z.enum(["ahorros","digital","todos"]).optional().default("todos").describe("Tipo de cuenta a comparar"),
  },
  async (args) => {
    const result = await compararCuentas(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Arrancar servidor ───────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
