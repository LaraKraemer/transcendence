// With make up running: NODE_EXTRA_CA_CERTS=nginx/certs/ca/rootCA.pem node scripts/grafana-https.check.mjs
import assert from "node:assert/strict";

const grafanaUrl = "https://localhost:3002";
const redirect = await fetch("http://localhost:3002/login", { redirect: "manual" });
assert.equal(redirect.status, 301);
assert.equal(redirect.headers.get("location"), `${grafanaUrl}/login`);

const login = await fetch(`${grafanaUrl}/login`);
assert.equal(login.status, 200);
assert.match(await login.text(), /<title>Grafana<\/title>/);

const health = await fetch(`${grafanaUrl}/api/health`);
assert.equal(health.status, 200);
assert.equal((await health.json()).database, "ok");

const dashboards = await fetch(`${grafanaUrl}/api/search`, { redirect: "manual" });
assert.equal(dashboards.status, 401);

console.log("Grafana HTTPS, HTTP redirect, health and anonymous access checks passed");
