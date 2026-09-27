import type { Request, Response, Router } from "express";

interface DispatchOptions {
  method?: string;
  url: string;
  query?: Record<string, unknown>;
  body?: unknown;
  cookies?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function dispatch(
  router: Router,
  { method = "GET", url, query = {}, body, cookies = {}, headers = {} }: DispatchOptions,
) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const req = {
      method,
      url,
      query,
      body,
      cookies,
      headers,
      ip: "127.0.0.1",
      get: (name: string) => headers[name.toLowerCase()],
    };
    const res = {
      locals: {},
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status, body: payload });
      },
      send(payload?: unknown) {
        resolve({ status, body: payload });
      },
      sendStatus(code: number) {
        status = code;
        resolve({ status, body: undefined });
      },
    };
    router(
      req as unknown as Request,
      res as unknown as Response,
      (error?: unknown) => reject(error ?? new Error(`No route for ${method} ${url}`)),
    );
  });
}
