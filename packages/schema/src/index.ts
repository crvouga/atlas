/**
 * @module Schema package entry point (`@crvouga/atlas/schema`)
 *
 * Re-exports every Zod schema, constant and inferred type of the Atlas contract: the layer format and report status
 * (`layer`), the statechart run manifest (`manifest`, `common`), the spec file formats (`spec`), the run index and
 * report sources the viewer reads (`runs-index`, `report-sources`) and the server configuration (`server-config`).
 * The JSON Schemas shipped in `schemas/` are generated from these by `bun run schemas`.
 *
 * @see docs/report-contract.md
 */
export * from './common';
export * from './manifest';
export * from './runs-index';
export * from './spec';
export * from './report-sources';
export * from './layer';
export * from './server-config';
export * from './api';
export * from './cli-results';

export * from './live-run';
export * from './project';
