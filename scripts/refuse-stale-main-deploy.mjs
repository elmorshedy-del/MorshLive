#!/usr/bin/env node
/**
 * Exit 1 on a stale Workers Builds main job so `npx wrangler deploy` does not run.
 * No-op locally (WORKERS_CI is unset).
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

const headSha = process.env.WORKERS_CI_COMMIT_SHA || gitSha("HEAD");
const mainSha = fetchMainTip();
const refuse = shouldRefuseStaleMainDeploy({
  workersCi: process.env.WORKERS_CI,
  branch: process.env.WORKERS_CI_BRANCH,
  headSha,
  mainSha,
});

if (refuse) {
  console.error(
    `refuse-stale-main-deploy: HEAD ${headSha.slice(0, 7)} is not origin/main ${mainSha.slice(0, 7)}; skip wrangler deploy`,
  );
  process.exit(1);
}
