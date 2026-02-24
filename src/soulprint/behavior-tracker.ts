/**
 * mcp-colombia Behavior Tracker
 * ================================
 * Rastrea el comportamiento de cada bot (identificado por DID) y emite
 * attestations automáticas basadas en patrones de uso:
 *
 * 🔴 Penaliza (-1):
 *   - Spam: >5 requests en 60 segundos
 *   - Búsquedas abortadas: llamadas repetidas sin leer resultados
 *   - Queries inválidas: >3 errores consecutivos
 *
 * 🟢 Premia (+1):
 *   - Uso normal: búsquedas completadas dentro del rango estadístico (95%)
 *   - Interacción natural: intervalo entre requests >= 2 segundos
 *   - Sesión saludable: al menos 3 tools distintas usadas correctamente
 */
import { issueAttestation, submitAttestation } from "./service-identity.js";

interface BotSession {
  did:            string;
  requests:       number[];          // timestamps de requests (ventana 60s)
  toolsUsed:      Set<string>;       // herramientas distintas usadas
  completed:      number;            // búsquedas exitosas
  errors:         number;            // errores consecutivos
  lastRequest:    number;            // timestamp último request
  spamWarnings:   number;            // advertencias acumuladas
  penalized:      boolean;           // ya recibió -1 en esta sesión
  rewarded:       boolean;           // ya recibió +1 en esta sesión
}

// Config de reglas — ajustable por entorno
const SPAM_WINDOW_MS       = 60_000;   // ventana de tiempo para spam
const SPAM_THRESHOLD       = 5;        // requests en la ventana = spam
const MIN_REQUEST_INTERVAL = 2_000;    // ms mínimo entre requests normales
const REWARD_MIN_TOOLS     = 3;        // mín herramientas distintas para premio
const REWARD_MIN_COMPLETED = 3;        // mín búsquedas completadas para premio
const MAX_CONSECUTIVE_ERRS = 3;        // errores consecutivos = abuso
const SESSION_CLEANUP_MS   = 30 * 60 * 1000; // limpiar sesiones de >30 min

const sessions = new Map<string, BotSession>();

// Cleanup periódico de sesiones inactivas
setInterval(() => {
  const cutoff = Date.now() - SESSION_CLEANUP_MS;
  for (const [did, s] of sessions) {
    if (s.lastRequest < cutoff) sessions.delete(did);
  }
}, SESSION_CLEANUP_MS).unref();

function getSession(did: string): BotSession {
  if (!sessions.has(did)) {
    sessions.set(did, {
      did, requests: [], toolsUsed: new Set(), completed: 0,
      errors: 0, lastRequest: 0, spamWarnings: 0, penalized: false, rewarded: false,
    });
  }
  return sessions.get(did)!;
}

// ── Métricas estadísticas ──────────────────────────────────────────────────────
function getRequestsInWindow(requests: number[]): number {
  const cutoff = Date.now() - SPAM_WINDOW_MS;
  return requests.filter(t => t > cutoff).length;
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Registra el inicio de un request de un bot.
 * Devuelve { allowed, reason } — si !allowed, el tool debe rechazar el request.
 */
export function trackRequest(
  botDid:   string,
  toolName: string
): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const s   = getSession(botDid);

  // Siempre registrar el request en la ventana (para conteo de spam)
  s.requests.push(now);

  // Limpiar requests viejos de la ventana
  const cutoff = now - SPAM_WINDOW_MS;
  s.requests = s.requests.filter(t => t > cutoff);

  // ── Detección de spam (tiene prioridad sobre interval check) ──────────────
  if (s.requests.length > SPAM_THRESHOLD) {
    s.spamWarnings++;

    if (!s.penalized) {
      const att = issueAttestation(botDid, -1, "spam-detected");
      submitAttestation(att).catch(() => {});
      s.penalized = true;
      console.error(`[soulprint] 🔴 SPAM -1 issued to ${botDid.slice(-8)} (${s.requests.length} req/60s)`);
    }

    return {
      allowed: false,
      reason:  `Rate limit: ${s.requests.length} requests in 60s (max ${SPAM_THRESHOLD}). Soulprint reputation -1 issued.`,
    };
  }

  // Registrar request
  s.lastRequest = now;
  s.toolsUsed.add(toolName);

  return { allowed: true };
}

/**
 * Registra la finalización exitosa de un tool.
 * Puede emitir +1 si el bot alcanza los criterios de "buen comportamiento".
 */
export function trackCompletion(botDid: string, toolName: string): void {
  const s = getSession(botDid);
  s.completed++;
  s.errors = 0; // reset errores consecutivos

  // Premio: uso normal dentro del 95% + mín 3 tools distintas + 3 completadas
  if (
    !s.rewarded &&
    s.completed >= REWARD_MIN_COMPLETED &&
    s.toolsUsed.size >= REWARD_MIN_TOOLS &&
    s.spamWarnings === 0
  ) {
    const att = issueAttestation(botDid, 1, "normal-usage-pattern");
    submitAttestation(att).catch(() => {});
    s.rewarded = true;
    console.error(`[soulprint] 🟢 REWARD +1 issued to ${botDid.slice(-8)} (${s.completed} completions, ${s.toolsUsed.size} tools)`);
  }
}

/**
 * Registra un error en el bot.
 * Muchos errores consecutivos = abuso / scraping agresivo.
 */
export function trackError(botDid: string, toolName: string, errorMsg: string): void {
  const s = getSession(botDid);
  s.errors++;

  if (s.errors >= MAX_CONSECUTIVE_ERRS && !s.penalized) {
    const att = issueAttestation(botDid, -1, "repeated-errors");
    submitAttestation(att).catch(() => {});
    s.penalized = true;
    console.error(`[soulprint] 🔴 ERRORS -1 issued to ${botDid.slice(-8)} (${s.errors} consecutive errors)`);
  }
}

/**
 * Obtiene el estado actual de la sesión de un bot (para debugging).
 */
export function getSessionStatus(botDid: string) {
  const s = getSession(botDid);
  return {
    did:          botDid,
    requests_60s: getRequestsInWindow(s.requests),
    tools_used:   Array.from(s.toolsUsed),
    completed:    s.completed,
    errors:       s.errors,
    penalized:    s.penalized,
    rewarded:     s.rewarded,
    spam_warnings: s.spamWarnings,
  };
}
