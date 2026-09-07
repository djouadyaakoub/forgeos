/**
 * ForgeOS Runtime Backend Registry — Architecture 2.0 Stage 4
 *
 * Separate from Host Registry (Cursor / CLI / generic).
 * Registers RuntimeBackend contract implementations for the Runtime Router.
 *
 * Does NOT authorize operations (Policy Authority).
 * Does NOT start backends (execution lifecycle is later).
 */
import { validateRuntimeBackend } from './backend-interface.mjs';
import { PRODUCT_ID } from '../policy/identity.mjs';

/**
 * Create an isolated registry instance (preferred for tests).
 */
export function createRuntimeRegistry() {
  /** @type {Map<string, { backend: object, registered_at: string, order: number }>} */
  const entries = new Map();
  let nextOrder = 0;

  function register(backend) {
    const validation = validateRuntimeBackend(backend);
    if (!validation.valid) {
      return {
        ok: false,
        error: 'CONTRACT_INVALID',
        issues: validation.issues,
      };
    }
    if (entries.has(backend.id)) {
      return {
        ok: false,
        error: 'DUPLICATE_BACKEND_ID',
        issues: [`duplicate_id:${backend.id}`],
      };
    }
    entries.set(backend.id, {
      backend,
      registered_at: new Date().toISOString(),
      order: nextOrder++,
    });
    return { ok: true, backend_id: backend.id, order: entries.get(backend.id).order };
  }

  function unregister(id) {
    const key = String(id || '');
    if (!entries.has(key)) {
      return { ok: false, error: 'NOT_FOUND', backend_id: key };
    }
    entries.delete(key);
    return { ok: true, backend_id: key };
  }

  function get(id) {
    const entry = entries.get(String(id || ''));
    return entry ? entry.backend : null;
  }

  function list() {
    return [...entries.values()]
      .sort((a, b) => a.order - b.order)
      .map((e) => e.backend);
  }

  function listEntries() {
    return [...entries.values()]
      .sort((a, b) => a.order - b.order)
      .map((e) => ({
        id: e.backend.id,
        name: e.backend.name,
        version: e.backend.version,
        order: e.order,
        registered_at: e.registered_at,
        fixture: Boolean(e.backend._fixture),
      }));
  }

  function clear() {
    entries.clear();
    nextOrder = 0;
  }

  function size() {
    return entries.size;
  }

  return {
    product: PRODUCT_ID,
    register,
    unregister,
    get,
    list,
    listEntries,
    clear,
    size,
  };
}

/** Process-local default registry (empty — no production backends registered). */
export const defaultRuntimeRegistry = createRuntimeRegistry();

export function registerRuntimeBackend(backend, registry = defaultRuntimeRegistry) {
  return registry.register(backend);
}

export function unregisterRuntimeBackend(id, registry = defaultRuntimeRegistry) {
  return registry.unregister(id);
}

export function getRuntimeBackend(id, registry = defaultRuntimeRegistry) {
  return registry.get(id);
}

export function listRuntimeBackends(registry = defaultRuntimeRegistry) {
  return registry.list();
}
