/**
 * Production build command helper.
 *
 * Every deploy — CI or local — refreshes the fixtures, because nothing else
 * writes today.json and a stale fixture list silently drops every channel
 * binding. Crawl steps are best-effort with a time budget, so an upstream
 * outage costs freshness rather than the deploy.
 */
import { spawnSync } from "node:child_process";
import { isRequiredStep, refreshStepsForDeploy } from "../lib/refresh-for-deploy.js";

for (const step of refreshStepsForDeploy()) {
  const result = spawnSync(process.execPath, [step.script], {
    stdio: "inherit",
    ...(step.timeoutMs ? { timeout: step.timeoutMs } : {}),
  });

  if (result.status === 0) continue;

  if (isRequiredStep(step)) {
    console.error(`[refresh] ${step.script} failed — stopping the deploy.`);
    process.exit(result.status || 1);
  }

  const reason =
    result.signal === "SIGTERM" && step.timeoutMs
      ? `exceeded its ${Math.round(step.timeoutMs / 1000)}s budget`
      : `exited ${result.status ?? result.signal}`;
  console.warn(
    `[refresh] ${step.script} ${reason} — continuing with the committed data. ` +
      "The deploy is fine; today.json may be older than this build.",
  );
}
