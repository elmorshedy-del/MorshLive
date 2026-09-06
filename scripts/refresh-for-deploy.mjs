/**
 * Production build command helper. Workers CI skips the third-party crawl
 * so `npx wrangler deploy` can run immediately. Local/manual still crawls.
 */
import { spawnSync } from "node:child_process";
import { refreshStepsForDeploy } from "../lib/refresh-for-deploy.js";

const steps = refreshStepsForDeploy({ workersCi: process.env.WORKERS_CI });
for (const step of steps) {
  const result = spawnSync(process.execPath, [step], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
