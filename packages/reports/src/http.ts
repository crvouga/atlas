export type HttpClient = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
