/**
 * Capability directory: a machine-readable catalog of what an OpenMimic
 * instance can do.
 *
 * Each plugin may declare capabilities in its manifest. The capabilities
 * endpoint aggregates them into a single directory that is publicly readable
 * (it contains no data, only the catalog).
 */

/* ------------------------------------------------------------------ */
/* Capability declaration                                              */
/* ------------------------------------------------------------------ */

export interface CapabilityDeclaration {
  /** Stable identifier, e.g. 'persona.chat'. */
  id: string;
  /** One-sentence human-readable description. */
  description: string;
  /** The scope required to use this capability. */
  requiredScope: string;
  /** HTTP method + path pattern, e.g. 'POST /v1/chat/completions'. */
  route: string;
  /** Whether calling this endpoint is idempotent (safe to retry). */
  idempotent: boolean;
  /** Stable error codes this capability may return. */
  errorCodes: string[];
}

/* ------------------------------------------------------------------ */
/* Built-in capability declarations                                    */
/* ------------------------------------------------------------------ */

/**
 * Capabilities declared by the three official mount plugins and the
 * core REST API.
 */
export const BUILTIN_CAPABILITIES: readonly CapabilityDeclaration[] = [
  // OpenAI-compatible surface
  {
    id: 'persona.chat',
    description: 'Converse with a persona via OpenAI-compatible chat completions.',
    requiredScope: 'persona.chat',
    route: 'POST /v1/chat/completions',
    idempotent: false,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject', 'rate_limited'],
  },
  {
    id: 'persona.models',
    description: 'List available persona models.',
    requiredScope: 'persona.read',
    route: 'GET /v1/models',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },

  // REST API — persona management
  {
    id: 'persona.list',
    description: 'List all subjects (personas).',
    requiredScope: 'persona.read',
    route: 'GET /api/subjects',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },
  {
    id: 'persona.progress',
    description: 'Read testimony and witness counts for a subject.',
    requiredScope: 'persona.read',
    route: 'GET /api/subjects/:id/progress',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },
  {
    id: 'persona.claims',
    description: 'List surviving claims for a subject.',
    requiredScope: 'persona.read',
    route: 'GET /api/subjects/:id/claims',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },

  // Testimony
  {
    id: 'testimony.read.corpus',
    description: 'Read corpus items for a subject.',
    requiredScope: 'testimony.read',
    route: 'GET /api/subjects/:id/corpus',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },
  {
    id: 'testimony.read.episodes',
    description: 'Read episodes for a subject.',
    requiredScope: 'testimony.read',
    route: 'GET /api/subjects/:id/episodes',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },
  {
    id: 'testimony.read.divergences',
    description: 'Read divergences for a subject.',
    requiredScope: 'testimony.read',
    route: 'GET /api/subjects/:id/divergences',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },

  // Court
  {
    id: 'court.run',
    description: 'Trigger a court session for a subject.',
    requiredScope: 'court.run',
    route: 'POST /api/subjects/:id/court',
    idempotent: false,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },
  {
    id: 'court.read',
    description: 'Read a court session by ID.',
    requiredScope: 'persona.read',
    route: 'GET /api/court/:sessionId',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },

  // Rooms
  {
    id: 'room.list',
    description: 'List rooms for a subject.',
    requiredScope: 'room.read',
    route: 'GET /api/subjects/:id/rooms',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },
  {
    id: 'room.create',
    description: 'Create a behind-the-scenes room for a subject.',
    requiredScope: 'room.run',
    route: 'POST /api/subjects/:id/rooms',
    idempotent: false,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },
  {
    id: 'room.door',
    description: 'Open the door of a room (subject enters).',
    requiredScope: 'room.run',
    route: 'POST /api/rooms/:id/door',
    idempotent: false,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },
  {
    id: 'room.read',
    description: 'Read a room by ID.',
    requiredScope: 'room.read',
    route: 'GET /api/rooms/:id',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },

  // Export
  {
    id: 'persona.export',
    description: 'Export a persona package (.persona).',
    requiredScope: 'export',
    route: 'GET /api/subjects/:id/export',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope', 'forbidden_subject'],
  },

  // MCP
  {
    id: 'mcp.dispatch',
    description: 'MCP JSON-RPC dispatch over stdio.',
    requiredScope: 'admin',
    route: 'stdio (MCP)',
    idempotent: false,
    errorCodes: [],
  },

  // Token management
  {
    id: 'tokens.create',
    description: 'Create a new scoped API token.',
    requiredScope: 'admin',
    route: 'POST /api/tokens',
    idempotent: false,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },
  {
    id: 'tokens.list',
    description: 'List all API tokens (no plaintext).',
    requiredScope: 'admin',
    route: 'GET /api/tokens',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },
  {
    id: 'tokens.revoke',
    description: 'Revoke an API token.',
    requiredScope: 'admin',
    route: 'DELETE /api/tokens/:id',
    idempotent: true,
    errorCodes: ['unauthorized', 'forbidden_scope'],
  },
];

/**
 * Build the full capability directory from built-in declarations and
 * any plugin-contributed capabilities.
 *
 * Plugin capabilities are appended to the built-in list; duplicates
 * (by id) are not removed — the first declaration wins.
 */
export function buildCapabilityDirectory(
  pluginCapabilities: readonly CapabilityDeclaration[] = [],
): CapabilityDeclaration[] {
  const seen = new Set<string>();
  const result: CapabilityDeclaration[] = [];

  for (const cap of [...BUILTIN_CAPABILITIES, ...pluginCapabilities]) {
    if (seen.has(cap.id)) continue;
    seen.add(cap.id);
    result.push(cap);
  }

  return result;
}
