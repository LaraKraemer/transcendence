import express from "express";
import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of completed public HTTP requests in seconds.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});
export const usersRegistered = new Counter({
  name: "users_registered_total",
  help: "Successfully stored user registrations since process start.",
  registers: [metricsRegistry],
});
export const logins = new Counter({
  name: "logins_total",
  help: "Completed password/Google logins or rejected credentials, including second-factor codes.",
  labelNames: ["result"] as const,
  registers: [metricsRegistry],
});
logins.inc({ result: "success" }, 0);
logins.inc({ result: "failure" }, 0);
export const transactionsCreated = new Counter({
  name: "transactions_created_total",
  help: "Successfully stored transaction rows, including imports and both transfer legs.",
  registers: [metricsRegistry],
});
const poolConnections = new Gauge({
  name: "pg_pool_connections",
  help: "Application pool connections by state (total or idle).",
  labelNames: ["state"] as const,
  registers: [metricsRegistry],
});
const poolWaiting = new Gauge({
  name: "pg_pool_waiting_count",
  help: "Requests waiting for an application database connection.",
  registers: [metricsRegistry],
});

/** Retains the mount prefix because Express restores req.baseUrl after router errors. */
export const captureMetricsRoutePrefix: RequestHandler = (req, res, next) => {
  res.locals.metricsRoutePrefix = req.baseUrl;
  next();
};

/** Times completed responses; route labels contain patterns only, never client URLs. */
export const measureHttpRequests: RequestHandler = (req, res, next) => {
  const endTimer = httpRequestDuration.startTimer();
  res.once("finish", () => {
    const routePath: unknown = req.route?.path;
    const route = typeof routePath === "string" ? `${res.locals.metricsRoutePrefix ?? ""}${routePath}` : "unmatched";
    endTimer({ method: req.method, route, status_code: res.statusCode });
  });
  next();
};

/** Creates the internal-only app; its port must never be published or proxied. */
export function createMetricsApp(pool: Pick<Pool, "totalCount" | "idleCount" | "waitingCount">) {
  const app = express();
  app.get("/metrics", async (_req, res) => {
    try {
      poolConnections.set({ state: "total" }, pool.totalCount);
      poolConnections.set({ state: "idle" }, pool.idleCount);
      poolWaiting.set(pool.waitingCount);
      res.set("Content-Type", metricsRegistry.contentType).send(await metricsRegistry.metrics());
    } catch (error) {
      console.error("Metrics collection failed:", error);
      res.status(500).send("Metrics collection failed");
    }
  });
  return app;
}
