#!/usr/bin/env node
/**
 * Refuse a Cloudflare Workers Build unless it can prove it is the current main
 * tip. This blocks non-main branch publishes and stale main jobs from replacing
 * the production morshlive Worker. No-op locally (WORKERS_CI is unset).
 */
import { execSync } from "node:child_process";
import { shouldRefuseStaleMainDeploy } from "../lib/stale-main-deploy.js";

function gitSha(ref) {
  try {
    return execSync(`git rev-parse ${ref}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function fetchMainTip() {
  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" });
    return gitSha("origin/main");
  } catch {
    return "";
  }
}

const branch = String(process.env.WORKERS_CI_BRANCH || "").trim();
const headSha = process.env.WORKERS_CI_COMMIT_SHA || gitSha("HEAD");
const mainSha = fetchMainTip();
const refuse = shouldRefuseStaleMainDeploy({
  workersCi: process.env.WORKERS_CI,
  branch,
  headSha,
  mainSha,
});

if (refuse) {
  console.error(
    `production-deploy-guard: refuse branch=${branch || "unknown"} HEAD=${headSha.slice(0, 7) || "unknown"} origin/main=${mainSha.slice(0, 7) || "unknown"}`,
  );
  process.exit(1);
}
