/**
 * Safe log summary for ardrive-core-js ArFSResult objects. [SEC-1]
 *
 * NEVER log a raw ArFSResult (neither JSON.stringify nor passing the object
 * to console.*): for private entities, `created[].key` is an EntityKey whose
 * toJSON()/toString() return the url-encoded RAW drive/file key, and
 * util.inspect exposes its underlying key bytes. This helper copies only a
 * whitelist of non-sensitive identifiers (entity types, entity IDs,
 * transaction IDs) so key material can never reach stdout/logs.
 */

export interface ArFSCreatedEntitySummary {
  type?: string;
  entityId?: string;
  metadataTxId?: string;
  dataTxId?: string;
  bundledIn?: string;
}

export interface ArFSResultSummary {
  created: ArFSCreatedEntitySummary[];
  tipCount: number;
  feeTxIds: string[];
}

function safeIdString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return String(value);
  } catch {
    return undefined;
  }
}

export function summarizeArFSResult(result: unknown): ArFSResultSummary {
  const summary: ArFSResultSummary = { created: [], tipCount: 0, feeTxIds: [] };

  if (!result || typeof result !== 'object') {
    return summary;
  }

  const { created, tips, fees } = result as {
    created?: unknown;
    tips?: unknown;
    fees?: unknown;
  };

  if (Array.isArray(created)) {
    for (const item of created) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const entity = item as Record<string, unknown>;
      summary.created.push({
        type: typeof entity.type === 'string' ? entity.type : undefined,
        entityId: safeIdString(entity.entityId),
        metadataTxId: safeIdString(entity.metadataTxId),
        dataTxId: safeIdString(entity.dataTxId),
        bundledIn: safeIdString(entity.bundledIn)
      });
    }
  }

  if (Array.isArray(tips)) {
    summary.tipCount = tips.length;
  }

  if (fees && typeof fees === 'object') {
    summary.feeTxIds = Object.keys(fees);
  }

  return summary;
}
