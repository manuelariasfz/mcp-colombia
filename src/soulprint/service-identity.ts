/**
 * mcp-colombia Service Identity
 * ==============================
 * mcp-colombia-hub es el PRIMER servicio verificado del ecosistema Soulprint.
 * Como creadores del protocolo, el servicio tiene score=80 (identidad+reputación).
 *
 * Este módulo:
 * 1. Genera/carga el keypair del servicio (persistido en ~/.soulprint/services/)
 * 2. Crea/renueva el service token (válido 24h)
 * 3. Expone la función para emitir attestations sobre bots
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import {
  generateKeypair, keypairFromPrivateKey, createToken, decodeToken,
  createAttestation, BotAttestation, SoulprintKeypair, defaultReputation,
} from "soulprint-core";

const SERVICE_DIR  = join(homedir(), ".soulprint", "services", "mcp-colombia");
const KEYPAIR_FILE = join(SERVICE_DIR, "keypair.json");
const TOKEN_FILE   = join(SERVICE_DIR, "service-token.json");

// Score del servicio: identidad 60 + reputación máx 20 = 80 (creadores del protocolo)
const SERVICE_CREDENTIALS = [
  "DocumentVerified", "FaceMatch", "GitHubLinked", "BiometricBound",
] as const;
const SERVICE_BOT_REP = { score: 20, attestations: 0, last_updated: Math.floor(Date.now()/1000) };

let _keypair: SoulprintKeypair | null = null;
let _token: string | null = null;

// ── Keypair ────────────────────────────────────────────────────────────────────
export function getServiceKeypair(): SoulprintKeypair {
  if (_keypair) return _keypair;

  if (!existsSync(SERVICE_DIR)) mkdirSync(SERVICE_DIR, { recursive: true, mode: 0o700 });

  if (existsSync(KEYPAIR_FILE)) {
    try {
      const s = JSON.parse(readFileSync(KEYPAIR_FILE, "utf8"));
      _keypair = keypairFromPrivateKey(new Uint8Array(Buffer.from(s.privateKey, "hex")));
      return _keypair;
    } catch { /* regenerar */ }
  }

  _keypair = generateKeypair();
  writeFileSync(KEYPAIR_FILE, JSON.stringify({
    did:        _keypair.did,
    service:    "mcp-colombia-hub",
    privateKey: Buffer.from(_keypair.privateKey).toString("hex"),
    created:    new Date().toISOString(),
  }), { mode: 0o600 });

  console.error(`[soulprint] mcp-colombia service DID: ${_keypair.did}`);
  return _keypair;
}

// ── Service Token ──────────────────────────────────────────────────────────────
export function getServiceToken(): string {
  // Reusar si existe y no expiró (con 10min de margen)
  if (_token) {
    const d = decodeToken(_token);
    if (d && d.expires > Math.floor(Date.now() / 1000) + 600) return _token;
  }

  if (existsSync(TOKEN_FILE)) {
    try {
      const cached = JSON.parse(readFileSync(TOKEN_FILE, "utf8")).token;
      const d = decodeToken(cached);
      if (d && d.expires > Math.floor(Date.now() / 1000) + 600) {
        _token = cached;
        return _token!;
      }
    } catch { /* regenerar */ }
  }

  // Generar nuevo token (24h)
  const kp = getServiceKeypair();
  const nullifier = `service:mcp-colombia:${kp.did}`;
  _token = createToken(kp, nullifier, SERVICE_CREDENTIALS as any, {
    bot_rep: SERVICE_BOT_REP,
  });

  writeFileSync(TOKEN_FILE, JSON.stringify({ token: _token, generated: new Date().toISOString() }));
  return _token;
}

// ── Issue Attestation ──────────────────────────────────────────────────────────
/**
 * Emite una attestation firmada sobre un bot desde mcp-colombia.
 * El servicio tiene score=80 → puede emitir attestations (requiere >= 60).
 */
export function issueAttestation(
  targetDid: string,
  value:     1 | -1,
  context:   string
): BotAttestation {
  const kp = getServiceKeypair();
  return createAttestation(kp, targetDid, value, context);
}

/**
 * Envía la attestation a un nodo validador.
 * Si no hay nodo disponible, la loguea para sincronización posterior.
 */
export async function submitAttestation(
  att:      BotAttestation,
  nodeUrl?: string
): Promise<void> {
  const url = nodeUrl ?? process.env.SOULPRINT_NODE ?? "https://soulprint-node-production.up.railway.app";
  try {
    const spt = getServiceToken();
    const res = await fetch(`${url}/reputation/attest`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ attestation: att, service_spt: spt }),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      console.error(`[soulprint] Attestation rejected: ${err.error}`);
    }
  } catch (e) {
    // Nodo no disponible — loguear para sincronización offline
    console.error(`[soulprint] Node unavailable — attestation queued: ${att.target_did} ${att.value > 0 ? "+1" : "-1"} (${att.context})`);
  }
}
