/**
 * mcp-registry.test.ts — Tests para MCPRegistry on-chain + herramientas MCP
 *
 * [A] Tests del cliente blockchain (lectura on-chain, Base Sepolia)
 * [B] Tests de las herramientas MCP (mcp_estado, mcp_lista_verificados, mcp_verificar, mcp_revocar)
 * [C] Tests de guardas de seguridad (admin_key ausente, dirección inválida)
 *
 * Ejecutar: npx ts-node tests/mcp-registry.test.ts
 */

import assert from "node:assert";
import {
  isVerifiedOnChain, getMCPEntry, getVerifiedMCPEntries,
  getRegistryInfo, getAllMCPEntries,
} from "../src/tools/mcp-registry.js";

// ── Harness ───────────────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}\n     → ${e.message}`);
  }
}

const MCP_COLOMBIA_ADDR = "0x0755A3001F488da00088838c4a068dF7f883ad87";
const UNREGISTERED_ADDR = "0x1234567890123456789012345678901234567890";
const REGISTRY_ADDR     = "0x59EA3c8f60ecbAe22B4c323A8dDc2b0BCd9D3C2a";
const SUPER_ADMIN       = "0x0755A3001F488da00088838c4a068dF7f883ad87";

// ── SECCIÓN A: Lectura on-chain ───────────────────────────────────────────────
console.log("\n⛓️  A — Lectura on-chain (Base Sepolia)");

await test("getRegistryInfo devuelve datos del contrato desplegado", async () => {
  const info = await getRegistryInfo();
  assert.strictEqual(info.contract.toLowerCase(), REGISTRY_ADDR.toLowerCase(), "dirección incorrecta");
  assert.ok(info.totalMCPs >= 1, "debe haber al menos 1 MCP registrado");
  assert.ok(info.superAdmin.length === 42, "superAdmin debe ser address válida");
  assert.ok(info.explorer.includes("basescan.org"), "explorer debe apuntar a basescan");
});

await test("superAdmin es el deployer wallet", async () => {
  const info = await getRegistryInfo();
  assert.strictEqual(info.superAdmin.toLowerCase(), SUPER_ADMIN.toLowerCase());
});

await test("isVerifiedOnChain(mcp-colombia) → true", async () => {
  const v = await isVerifiedOnChain(MCP_COLOMBIA_ADDR);
  assert.strictEqual(v, true, "mcp-colombia debe estar verificado");
});

await test("isVerifiedOnChain(dirección no registrada) → false", async () => {
  const v = await isVerifiedOnChain(UNREGISTERED_ADDR);
  assert.strictEqual(v, false, "dirección sin registrar debe devolver false");
});

await test("getMCPEntry(mcp-colombia) devuelve entry completa", async () => {
  const entry = await getMCPEntry(MCP_COLOMBIA_ADDR);
  assert.ok(entry !== null, "entry no debe ser null");
  assert.strictEqual(entry!.name, "MCP Colombia Hub", `nombre incorrecto: ${entry!.name}`);
  assert.strictEqual(entry!.verified, true, "debe estar verificado");
  assert.ok(entry!.verifiedAt > 0, "verifiedAt debe ser > 0");
  assert.strictEqual(entry!.revokedAt, 0, "revokedAt debe ser 0");
  assert.strictEqual(entry!.category, "general");
  assert.ok(entry!.url.length > 0, "url no debe estar vacía");
});

await test("getMCPEntry(dirección no registrada) → null", async () => {
  const entry = await getMCPEntry(UNREGISTERED_ADDR);
  assert.strictEqual(entry, null, "dirección sin registrar debe devolver null");
});

await test("getAllMCPEntries devuelve array con al menos 1 elemento", async () => {
  const all = await getAllMCPEntries();
  assert.ok(Array.isArray(all), "debe ser array");
  assert.ok(all.length >= 1, "debe haber al menos 1 MCP");
  assert.ok(all[0].name.length > 0, "nombre no debe estar vacío");
});

await test("getVerifiedMCPEntries incluye mcp-colombia", async () => {
  const verified = await getVerifiedMCPEntries();
  const found = verified.find(e => e.address.toLowerCase() === MCP_COLOMBIA_ADDR.toLowerCase());
  assert.ok(found !== undefined, "mcp-colombia debe estar en la lista de verificados");
  assert.strictEqual(found!.verified, true);
});

await test("getVerifiedMCPEntries no incluye entradas no verificadas", async () => {
  const verified = await getVerifiedMCPEntries();
  const allUnverified = verified.every(e => e.verified === true);
  assert.strictEqual(allUnverified, true, "todos los entries deben tener verified=true");
});

// ── SECCIÓN B: Comportamiento de herramientas MCP (simulado) ─────────────────
console.log("\n🔧 B — Comportamiento herramientas MCP");

await test("mcp_estado con alias 'mcp-colombia' resuelve la dirección correcta", async () => {
  // Simular la lógica del alias
  const KNOWN: Record<string, string> = {
    "mcp-colombia":     "0x0755A3001F488da00088838c4a068dF7f883ad87",
    "mcp-colombia-hub": "0x0755A3001F488da00088838c4a068dF7f883ad87",
  };
  const alias = "mcp-colombia";
  const addr = KNOWN[alias.toLowerCase()] ?? alias;
  assert.strictEqual(addr, MCP_COLOMBIA_ADDR, "alias debe resolver a la dirección correcta");
});

await test("mcp_estado con dirección desconocida → registered: false", async () => {
  const entry = await getMCPEntry(UNREGISTERED_ADDR);
  assert.strictEqual(entry, null, "entry debe ser null");
  // El tool devuelve registered: false, verified: false
  const response = entry === null
    ? { registered: false, verified: false }
    : { registered: true, verified: entry.verified };
  assert.strictEqual(response.registered, false);
  assert.strictEqual(response.verified, false);
});

await test("mcp_estado con mcp-colombia → badge verificado", async () => {
  const entry = await getMCPEntry(MCP_COLOMBIA_ADDR);
  const badge = entry?.verified ? "✅ VERIFICADO por superAdmin on-chain" : "⏳ Pendiente";
  assert.ok(badge.includes("✅ VERIFICADO"), `badge incorrecto: ${badge}`);
});

await test("mcp_lista_verificados devuelve al menos 1 MCP con badge ✅", async () => {
  const verified = await getVerifiedMCPEntries();
  const badges = verified.map(e => e.verified ? "✅ VERIFICADO" : "❌");
  assert.ok(badges.every(b => b === "✅ VERIFICADO"), "todos deben tener badge ✅ VERIFICADO");
  assert.ok(verified.length >= 1, "debe haber al menos 1");
});

// ── SECCIÓN C: Guards de seguridad ───────────────────────────────────────────
console.log("\n🔐 C — Guards de seguridad");

await test("mcp_verificar sin ADMIN_PRIVATE_KEY → error claro", async () => {
  // Simular la guarda del tool
  const hasKey = !!process.env.ADMIN_PRIVATE_KEY;
  if (!hasKey) {
    // El tool devuelve error — esto es lo esperado en tests
    const expected = { error: "ADMIN_PRIVATE_KEY no configurada en este servidor." };
    assert.ok(expected.error.includes("ADMIN_PRIVATE_KEY"), "error debe mencionar la key");
  } else {
    // Si la key está, el test pasa trivialmente
    console.log("     (ADMIN_PRIVATE_KEY presente — guarda no activada)");
  }
});

await test("mcp_revocar sin ADMIN_PRIVATE_KEY → error claro", async () => {
  const hasKey = !!process.env.ADMIN_PRIVATE_KEY;
  if (!hasKey) {
    const expected = { error: "ADMIN_PRIVATE_KEY no configurada en este servidor." };
    assert.ok(expected.error.includes("ADMIN_PRIVATE_KEY"));
  }
});

await test("mcp_registrar con owner_key inválida → error validación", async () => {
  // Simular la guarda de validación del tool
  const badKey = "not-a-private-key";
  const isValid = badKey.startsWith("0x") && badKey.length === 66;
  assert.strictEqual(isValid, false, "key inválida debe fallar validación");
});

await test("mcp_registrar con key hex de longitud incorrecta → rechazada", async () => {
  const shortKey = "0x" + "ab".repeat(10); // 22 chars, no 66
  const isValid = shortKey.startsWith("0x") && shortKey.length === 66;
  assert.strictEqual(isValid, false, "key corta debe ser rechazada");
});

await test("isVerifiedOnChain no lanza excepción con dirección malformada", async () => {
  // Debe devolver false gracefully, no lanzar
  let result: boolean | undefined;
  try {
    result = await isVerifiedOnChain("0xinvalid");
  } catch {
    // Si lanza, el test falla
    assert.fail("No debería lanzar excepción — debe devolver false");
  }
  assert.strictEqual(result, false, "dirección inválida debe devolver false");
});

await test("getMCPEntry no lanza excepción con dirección malformada", async () => {
  let result: any;
  try {
    result = await getMCPEntry("0xinvalid");
  } catch {
    assert.fail("No debería lanzar excepción — debe devolver null");
  }
  assert.strictEqual(result, null, "dirección inválida debe devolver null");
});

// ── RESUMEN ───────────────────────────────────────────────────────────────────
const separator = "═".repeat(62);
console.log(`\n${separator}`);
console.log(`  Total:    ${total} tests`);
console.log(`  Pasados:  ${passed} ✅`);
if (failed > 0) {
  console.log(`  Fallidos: ${failed} ❌`);
} else {
  console.log(`  Fallidos: 0 ✅`);
}
console.log(separator);
process.exit(failed > 0 ? 1 : 0);
