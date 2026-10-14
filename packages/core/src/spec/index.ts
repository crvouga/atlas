/**
 * @module Spec entry point (browser-safe)
 *
 * Re-exports the parts of the spec layer that need no Node built-ins: the spec types, chart and
 * journey parsing, SCXML conversion and static composition. `loadSpecDirectory` (which reads the
 * file system) is deliberately not here; import it from the package root.
 *
 * @see docs/statecharts.md
 */
export * from './types';
export { parseChart, parseJourneys } from './parse';
export { scxmlToMachine, machineToScxml, scxmlToken, ATLAS_NS } from './scxml';
export { composeCharts, type Composition, type HandOff } from './compose';
