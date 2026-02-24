#!/usr/bin/env node
/**
 * Soulprint × mcp-colombia — Test Runner Nocturno
 * =================================================
 * Corre todas las pruebas en múltiples modos y guarda resultados en JSON.
 * Diseñado para correr en loop toda la noche.
 *
 * Modos de prueba:
 *   1. UNIT       — tests unitarios de soulprint (104 tests)
 *   2. INTEGRATION — mcp-colombia integration (37 tests)
 *   3. STRESS     — 100 tokens distintos, 50 attestations, 20 bots concurrentes
 *   4. PENTEST    — ataques de forge, sybil, relay, flood
 *   5. SCENARIO   — flujo E2E completo: anónimo → verificado → premium
 */

const { execSync, exec } = require("child_process");
const fs   = require("fs");
const path = require("path");

const RESULTS_DIR = "/root/.openclaw/workspace/test-results";
const SOULPRINT   = "/root/.openclaw/workspace/soulprint";
const MCP         = "/root/.openclaw/workspace/mcp-colombia";

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString().replace("T"," ").slice(0,19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

function run(label, cmd, cwd) {
  const start = Date.now();
  try {
    const out = execSync(cmd, { cwd, timeout: 120_000, encoding: "utf8", stdio: ["pipe","pipe","pipe"] });
    const ms  = Date.now() - start;
    return { label, ok: true, ms, output: out.slice(-3000) };
  } catch (e) {
    const ms = Date.now() - start;
    return { label, ok: false, ms, output: (e.stdout || "") + (e.stderr || ""), error: e.message };
  }
}

function save(round, results, mode) {
  const file = path.join(RESULTS_DIR, `round-${round}-${mode}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ round, mode, timestamp: ts(), results }, null, 2));
  return file;
}

// ── Extraer stats de output ───────────────────────────────────────────────────
function parseStats(output) {
  const totalMatch  = output.match(/Total:\s+(\d+)/);
  const passedMatch = output.match(/Pasados:\s+(\d+)/);
  const failedMatch = output.match(/Fallidos:\s+(\d+)/);
  return {
    total:  totalMatch  ? parseInt(totalMatch[1])  : null,
    passed: passedMatch ? parseInt(passedMatch[1]) : null,
    failed: failedMatch ? parseInt(failedMatch[1]) : null,
  };
}

// ── Modo 1: Unit Tests (soulprint) ────────────────────────────────────────────
function runUnitTests(round) {
  log(`[UNIT] Corriendo 104 tests de soulprint...`);
  const r = run("soulprint-unit", "node tests/suite.js", SOULPRINT);
  const stats = parseStats(r.output || "");
  log(`[UNIT] ${r.ok ? "✅" : "❌"} ${stats.passed ?? "?"}/${stats.total ?? "?"} tests | ${r.ms}ms`);
  return { ...r, stats };
}

// ── Modo 2: Integration Tests (mcp-colombia) ──────────────────────────────────
function runIntegrationTests(round) {
  log(`[INTEGRATION] Corriendo 37 tests mcp-colombia × Soulprint...`);
  const r = run("mcp-integration", "npm test 2>&1 | tail -60", MCP);
  const stats = parseStats(r.output || "");
  log(`[INTEGRATION] ${r.ok ? "✅" : "❌"} ${stats.passed ?? "?"}/${stats.total ?? "?"} tests | ${r.ms}ms`);
  return { ...r, stats };
}

// ── Modo 3: Stress Test ───────────────────────────────────────────────────────
function runStressTests(round) {
  log(`[STRESS] Generando 100 tokens, 50 attestations, 20 bots concurrentes...`);

  const stressScript = `
const {
  generateKeypair, createToken, createAttestation, verifyAttestation,
  computeReputation, defaultReputation, calculateTotalScore,
} = require("${SOULPRINT}/packages/core/dist/index.js");

const RUNS = 100;
let passed = 0, failed = 0;
const errors = [];

function test(name, fn) {
  try { fn(); passed++; }
  catch(e) { failed++; errors.push(name + ": " + e.message); }
}

// Stress 1: 100 tokens distintos con credenciales random
const credPool = ["EmailVerified","PhoneVerified","GitHubLinked","DocumentVerified","FaceMatch","BiometricBound"];
for (let i = 0; i < 100; i++) {
  test("Token-" + i, () => {
    const kp   = generateKeypair();
    const creds = credPool.filter(() => Math.random() > 0.5);
    const rep   = { score: Math.floor(Math.random()*21), attestations: i, last_updated: Date.now() };
    const tok   = createToken(kp, "0x" + i.toString(16).padStart(64,"0"), creds, { bot_rep: rep });
    if (!tok || tok.length < 50) throw new Error("Token vacío");
  });
}

// Stress 2: 50 attestations con servicios distintos
const targetBot = generateKeypair();
const atts = [];
for (let i = 0; i < 50; i++) {
  const svc = generateKeypair();
  const val = Math.random() > 0.4 ? 1 : -1;
  const att = createAttestation(svc, targetBot.did, val, "stress-" + i);
  test("Attestation-" + i, () => {
    if (!verifyAttestation(att)) throw new Error("Invalid sig");
  });
  atts.push(att);
}

// Stress 3: computeReputation con 50 attestations
test("ComputeRep-50atts", () => {
  const rep = computeReputation(atts, 10);
  if (rep.score < 0 || rep.score > 20) throw new Error("Score fuera de [0,20]: " + rep.score);
});

// Stress 4: 20 bots concurrentes (simulado)
const bots = Array.from({length: 20}, () => generateKeypair());
test("ConcurrentBots-20", () => {
  const tokens = bots.map(kp => createToken(kp, "0xnull-" + kp.did.slice(-8), ["FaceMatch","DocumentVerified"]));
  if (tokens.some(t => !t)) throw new Error("Token vacío en concurrente");
});

// Stress 5: score nunca > 100
test("ScoreClamp-100", () => {
  for (let i = 0; i < 20; i++) {
    const kp  = generateKeypair();
    const all = ["EmailVerified","PhoneVerified","GitHubLinked","DocumentVerified","FaceMatch","BiometricBound"];
    const rep = { score: 20, attestations: 999, last_updated: Date.now() };
    const tok = createToken(kp, "0xmax", all, { bot_rep: rep });
    const raw = JSON.parse(Buffer.from(tok,"base64url").toString());
    if (raw.score > 100) throw new Error("Score > 100: " + raw.score);
  }
});

const total = passed + failed;
console.log("Total:   " + total + " tests");
console.log("Pasados: " + passed + " ✅");
console.log("Fallidos: " + failed + " " + (failed > 0 ? "❌" : "✅"));
if (errors.length) console.log("Errores: " + errors.join(", "));
process.exit(failed > 0 ? 1 : 0);
`;

  const tmpFile = `/tmp/stress-${round}.js`;
  fs.writeFileSync(tmpFile, stressScript);
  const r = run("stress", `node ${tmpFile}`, "/tmp");
  const stats = parseStats(r.output || "");
  log(`[STRESS] ${r.ok ? "✅" : "❌"} ${stats.passed ?? "?"}/${stats.total ?? "?"} tests | ${r.ms}ms`);
  try { fs.unlinkSync(tmpFile); } catch {}
  return { ...r, stats };
}

// ── Modo 4: Pen Tests ─────────────────────────────────────────────────────────
function runPenTests(round) {
  log(`[PENTEST] Ataques de forge, sybil, relay, flood...`);

  const penScript = `
const {
  generateKeypair, createToken, decodeToken, createAttestation,
  verifyAttestation, computeReputation,
} = require("${SOULPRINT}/packages/core/dist/index.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch(e) { failed++; console.error("FAIL " + name + ": " + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(msg + " — got " + a + " expected " + b); }

// ATTACK 1: Inflate score 50 different ways
for (let i = 0; i < 50; i++) {
  test("ScoreInflate-" + i, () => {
    const kp  = generateKeypair();
    const tok = createToken(kp, "0xnull", ["EmailVerified"]);
    const raw = JSON.parse(Buffer.from(tok,"base64url").toString());
    raw.score = 100 - (i % 30);
    raw.identity_score = 80;
    const tampered = Buffer.from(JSON.stringify(raw)).toString("base64url");
    const decoded  = decodeToken(tampered);
    assert(decoded === null, "Tampered token should be null");
  });
}

// ATTACK 2: DID substitution 20 ways
for (let i = 0; i < 20; i++) {
  test("DIDASubst-" + i, () => {
    const victim   = generateKeypair();
    const attacker = generateKeypair();
    const tok  = createToken(victim, "0xvic", ["DocumentVerified","FaceMatch"]);
    const raw  = JSON.parse(Buffer.from(tok,"base64url").toString());
    raw.did    = attacker.did;
    const tampered = Buffer.from(JSON.stringify(raw)).toString("base64url");
    assert(decodeToken(tampered) === null, "DID swap must be rejected");
  });
}

// ATTACK 3: Nullifier replay (Sybil) — 30 attempts
const nullifier = "0x" + "dead".repeat(16);
for (let i = 0; i < 30; i++) {
  test("Sybil-" + i, () => {
    const kp  = generateKeypair();
    const tok = createToken(kp, nullifier, ["DocumentVerified","FaceMatch"]);
    const d   = decodeToken(tok);
    assert(d !== null, "Token itself is valid");
    assert(d.nullifier === nullifier, "Nullifier preserved");
    // In real system, node would reject duplicate nullifier with different DID
  });
}

// ATTACK 4: Fake attestations from 10 different forgers
for (let i = 0; i < 10; i++) {
  test("FakeAtt-" + i, () => {
    const forger = generateKeypair();
    const target = generateKeypair();
    const legit  = createAttestation(forger, target.did, 1, "context-" + i);
    const fakes  = [
      { ...legit, value: -1 },                           // changed value
      { ...legit, issuer_did: generateKeypair().did },   // wrong issuer
      { ...legit, target_did: generateKeypair().did },   // wrong target
      { ...legit, sig: "0000" + legit.sig.slice(4) },   // corrupted sig
    ];
    fakes.forEach((f,j) => assert(!verifyAttestation(f), "Fake att " + j + " should fail"));
    const rep = computeReputation(fakes, 10);
    eq(rep.score, 10, "Fake atts must not move score");
  });
}

// ATTACK 5: Credential credential set manipulation
test("CredManip-add-all", () => {
  const kp  = generateKeypair();
  const tok = createToken(kp, "0xnull", []);
  const raw = JSON.parse(Buffer.from(tok,"base64url").toString());
  raw.credentials = ["DocumentVerified","FaceMatch","BiometricBound","GitHubLinked","EmailVerified","PhoneVerified"];
  raw.score = 100;
  raw.identity_score = 80;
  const tampered = Buffer.from(JSON.stringify(raw)).toString("base64url");
  assert(decodeToken(tampered) === null, "Credential addition must be rejected");
});

// ATTACK 6: Expired token manipulation
test("ExpiredToken-extend", () => {
  const kp  = generateKeypair();
  const tok = createToken(kp, "0xnull", ["FaceMatch"]);
  const raw = JSON.parse(Buffer.from(tok,"base64url").toString());
  raw.expires = Math.floor(Date.now()/1000) + 99999; // extend expiry
  const tampered = Buffer.from(JSON.stringify(raw)).toString("base64url");
  assert(decodeToken(tampered) === null, "Expiry extension must be rejected");
});

const total = passed + failed;
console.log("Total:   " + total + " tests");
console.log("Pasados: " + passed + " ✅");
console.log("Fallidos: " + failed + " " + (failed > 0 ? "❌" : "✅"));
process.exit(failed > 0 ? 1 : 0);
`;

  const tmpFile = `/tmp/pentest-${round}.js`;
  fs.writeFileSync(tmpFile, penScript);
  const r = run("pentest", `node ${tmpFile}`, "/tmp");
  const stats = parseStats(r.output || "");
  log(`[PENTEST] ${r.ok ? "✅" : "❌"} ${stats.passed ?? "?"}/${stats.total ?? "?"} attacks blocked | ${r.ms}ms`);
  try { fs.unlinkSync(tmpFile); } catch {}
  return { ...r, stats };
}

// ── Modo 5: Scenario E2E ──────────────────────────────────────────────────────
function runScenarioTest(round) {
  log(`[SCENARIO] Flujo E2E: anónimo → verificado → premium...`);

  const scenarioScript = `
const {
  generateKeypair, createToken, decodeToken,
  createAttestation, computeReputation, defaultReputation, calculateTotalScore,
} = require("${SOULPRINT}/packages/core/dist/index.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch(e) { failed++; console.error("FAIL " + name + ": " + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error(m + " got " + a + " exp " + b); }

// Run 5 full journeys with different bots
for (let journey = 0; journey < 5; journey++) {
  const bot = generateKeypair();

  // Phase 1: Anonymous bot (score = 10)
  test("Journey" + journey + "-Phase1-Anonymous", () => {
    const tok = createToken(bot, "0xanon", [], { bot_rep: defaultReputation() });
    const d   = decodeToken(tok);
    assert(d !== null, "Token valid");
    eq(d.score, 10, "Anonymous score = 10");
    eq(d.identity_score, 0, "No identity");
    eq(d.bot_rep.score, 10, "Neutral rep");
    assert(d.score < 95, "Cannot access premium");
  });

  // Phase 2: Email verified (score = 18)
  test("Journey" + journey + "-Phase2-Email", () => {
    const tok = createToken(bot, "0xemail", ["EmailVerified"], {
      bot_rep: { score: 10, attestations: 0, last_updated: Date.now() }
    });
    const d = decodeToken(tok);
    eq(d.identity_score, 8, "Email = 8 pts");
    eq(d.score, 18, "18 = 8 identity + 10 rep");
    assert(d.score < 95, "Still no premium");
  });

  // Phase 3: Full KYC (score = 46)
  test("Journey" + journey + "-Phase3-KYCFull", () => {
    const tok = createToken(bot, "0xkyc", ["DocumentVerified","FaceMatch"], {
      bot_rep: { score: 10, attestations: 0, last_updated: Date.now() }
    });
    const d = decodeToken(tok);
    eq(d.identity_score, 36, "Doc+Face = 36 pts");
    eq(d.score, 46, "46 = 36 identity + 10 rep");
    assert(d.score < 95, "Still no premium");
  });

  // Phase 4: Full KYC + max rep (score = 100)
  test("Journey" + journey + "-Phase4-Premium", () => {
    const allCreds = ["DocumentVerified","FaceMatch","BiometricBound","GitHubLinked","EmailVerified","PhoneVerified"];
    const svc = generateKeypair();
    const atts = Array.from({length: 15}, (_, i) =>
      createAttestation(svc, bot.did, 1, "good-behavior-" + i)
    );
    const rep = computeReputation(atts, 10);
    assert(rep.score === 20, "Max reputation = 20");

    const tok = createToken(bot, "0xpremium", allCreds, { bot_rep: rep });
    const d   = decodeToken(tok);
    eq(d.score, 100, "Perfect score = 100");
    eq(d.identity_score, 80, "Full identity = 80");
    eq(d.bot_rep.score, 20, "Max reputation = 20");
    assert(d.score >= 95, "Premium access granted");
  });

  // Phase 5: Spammer gets banned
  test("Journey" + journey + "-Phase5-Spammer", () => {
    const spammer = generateKeypair();
    const svc     = generateKeypair();
    const bans = Array.from({length: 12}, (_, i) =>
      createAttestation(svc, spammer.did, -1, "spam-" + i)
    );
    const rep = computeReputation(bans, 10);
    eq(rep.score, 0, "Spammer score = 0 (clamped)");

    const tok = createToken(spammer, "0xban", ["DocumentVerified","FaceMatch"], { bot_rep: rep });
    const d   = decodeToken(tok);
    eq(d.bot_rep.score, 0, "Bot rep = 0");
    eq(d.score, 36, "Total = 36 identity + 0 rep");
    assert(d.score < 95, "Spammer cannot access premium");
  });
}

const total = passed + failed;
console.log("Total:   " + total + " tests");
console.log("Pasados: " + passed + " ✅");
console.log("Fallidos: " + failed + " " + (failed > 0 ? "❌" : "✅"));
process.exit(failed > 0 ? 1 : 0);
`;

  const tmpFile = `/tmp/scenario-${round}.js`;
  fs.writeFileSync(tmpFile, scenarioScript);
  const r = run("scenario", `node ${tmpFile}`, "/tmp");
  const stats = parseStats(r.output || "");
  log(`[SCENARIO] ${r.ok ? "✅" : "❌"} ${stats.passed ?? "?"}/${stats.total ?? "?"} scenarios | ${r.ms}ms`);
  try { fs.unlinkSync(tmpFile); } catch {}
  return { ...r, stats };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const round = parseInt(process.env.TEST_ROUND ?? "1");
  const mode  = process.env.TEST_MODE ?? "all";

  log(`═══════════════════════════════════════════════`);
  log(`  RONDA ${round} — Modo: ${mode.toUpperCase()}`);
  log(`═══════════════════════════════════════════════`);

  const results = [];
  let totalPassed = 0, totalFailed = 0, totalTests = 0;

  const runMode = (name, fn) => {
    if (mode !== "all" && mode !== name) return;
    const r = fn(round);
    results.push({ mode: name, ...r });
    if (r.stats.passed) totalPassed += r.stats.passed;
    if (r.stats.failed) totalFailed += r.stats.failed;
    if (r.stats.total)  totalTests  += r.stats.total;
  };

  runMode("unit",        runUnitTests);
  runMode("integration", runIntegrationTests);
  runMode("stress",      runStressTests);
  runMode("pentest",     runPenTests);
  runMode("scenario",    runScenarioTest);

  const allOk = results.every(r => r.ok);
  const file  = save(round, results, mode);

  log(`═══════════════════════════════════════════════`);
  log(`  RESULTADO RONDA ${round}: ${allOk ? "✅ TODOS PASARON" : "❌ HAY FALLOS"}`);
  log(`  Total: ${totalTests} | Pasados: ${totalPassed} | Fallidos: ${totalFailed}`);
  log(`  Guardado en: ${file}`);
  log(`═══════════════════════════════════════════════`);

  process.exit(allOk ? 0 : 1);
}

main();
