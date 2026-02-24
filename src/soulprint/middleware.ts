/**
 * mcp-colombia Soulprint Middleware
 * ====================================
 * Extrae y verifica el SPT de los headers o capabilities del cliente MCP.
 * El agente debe pasar su token en:
 *   - HTTP header X-Soulprint: <token>
 *   - MCP capabilities.identity.soulprint: <token>
 *   - Variable de entorno SOULPRINT_TOKEN (para tests/desarrollo)
 */
import { decodeToken, SoulprintToken } from "soulprint-core";

export interface SoulprintContext {
  token:    SoulprintToken & { sig: string };
  did:      string;
  score:    number;
  identity: number;
  botRep:   number;
  level:    string;
  country?: string;
}

/**
 * Extrae el SPT de las capabilities del cliente MCP.
 * El cliente incluye: capabilities.identity.soulprint = "<base64url-token>"
 */
export function extractToken(capabilities?: any): string | null {
  // 1. Desde capabilities del cliente MCP
  const fromCaps = capabilities?.identity?.soulprint;
  if (fromCaps && typeof fromCaps === "string") return fromCaps;

  // 2. Desde variable de entorno (tests / dev)
  const fromEnv = process.env.SOULPRINT_TOKEN;
  if (fromEnv) return fromEnv;

  return null;
}

/**
 * Verifica un SPT y retorna el contexto de identidad.
 * Retorna null si el token es inválido, expirado, o si el score es insuficiente.
 */
export function verifySoulprint(
  rawToken:  string,
  minScore?: number
): { ok: true; ctx: SoulprintContext } | { ok: false; error: string } {
  const token = decodeToken(rawToken);
  if (!token) {
    return { ok: false, error: "Invalid or expired Soulprint token" };
  }

  if (minScore !== undefined && token.score < minScore) {
    return {
      ok: false,
      error: `Score insuficiente: ${token.score} < ${minScore} requerido. ` +
             `Mejora tu reputación o verifica tu identidad en https://manuelariasfz.github.io/soulprint/`,
    };
  }

  return {
    ok:  true,
    ctx: {
      token,
      did:      token.did,
      score:    token.score,
      identity: token.identity_score ?? token.score,
      botRep:   token.bot_rep?.score ?? 10,
      level:    token.level,
      country:  token.country,
    },
  };
}

/**
 * Helper: require a Soulprint token with minScore.
 * Returns the context or throws a formatted MCP error response.
 */
export function requireSoulprint(
  capabilities: any,
  minScore:     number,
  toolName:     string
): { ok: true; ctx: SoulprintContext } | { ok: false; mcpError: any } {
  const raw = extractToken(capabilities);

  if (!raw) {
    return {
      ok: false,
      mcpError: {
        content: [{
          type: "text",
          text: JSON.stringify({
            error:   "Soulprint token required",
            tool:    toolName,
            message: `Este endpoint requiere identidad verificada (score >= ${minScore}).\n` +
                     `Obtén tu Soulprint en: npx soulprint verify-me\n` +
                     `Más info: https://manuelariasfz.github.io/soulprint/`,
            required_score: minScore,
          }, null, 2),
        }],
        isError: true,
      },
    };
  }

  const result = verifySoulprint(raw, minScore);
  if (!result.ok) {
    return {
      ok: false,
      mcpError: {
        content: [{
          type: "text",
          text: JSON.stringify({
            error:          result.error,
            tool:           toolName,
            required_score: minScore,
          }, null, 2),
        }],
        isError: true,
      },
    };
  }

  return { ok: true, ctx: result.ctx };
}
