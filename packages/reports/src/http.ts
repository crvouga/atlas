/**
 * @module HTTP client port
 *
 * The one thing the reports readers need from the network, as a type, so a host can supply `fetch`, an
 * authenticating wrapper or a test double.
 */

/** Anything with a `fetch` of the standard signature. The readers only call it; they do not retry or add credentials. */
export type HttpClient = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
