// Print installed/hasSwitchRouter for every CLI tool from a running dashboard.
// Usage: node scripts/check-cli-statuses.mjs [port]
const port = process.argv[2] || "28701";
const res = await fetch(`http://127.0.0.1:${port}/api/cli-tools/all-statuses`);
const data = await res.json();
for (const [k, v] of Object.entries(data)) {
  console.log(k.padEnd(10), "installed:", String(v && v.installed).padEnd(6), "hasSwitchRouter:", v && v.hasSwitchRouter);
}
