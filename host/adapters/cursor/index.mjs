/** Thin Cursor facade over the canonical interactive host contract. */
import { createInteractiveHostAdapter, discoverInteractiveHostCapabilities,
  INTERACTIVE_CAPABILITIES as CURSOR_CAPABILITIES, INTERACTIVE_CLASSES as CURSOR_CLASSES } from '../../interactive.mjs';
export { HOST_CAPABILITY_CLASSES } from '../../adapter.mjs';
export { CURSOR_CAPABILITIES, CURSOR_CLASSES };
export const CURSOR_HOST_ID = 'cursor';
export const CURSOR_ADAPTER_VERSION = '0.2.0-stage23';
export const discoverCursorHostCapabilities = () => discoverInteractiveHostCapabilities(CURSOR_HOST_ID, 'Cursor');
export const createCursorHostAdapter = (overrides = {}) => createInteractiveHostAdapter(CURSOR_HOST_ID, 'Cursor', overrides);
export const getCursorHostAdapter = createCursorHostAdapter;
