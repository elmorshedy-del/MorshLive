/**
 * Workers Builds can publish the whole production Worker from any branch unless
 * the build itself refuses. Production is main-only and must also be the current
 * origin/main tip. Fail closed when Workers CI cannot prove that state.
 */

export function shouldRefuseStaleMainDeploy({ workersCi, branch, headSha, mainSha } = {}) {
  if (String(workersCi || "") !== "1") return false;

  const branchName = String(branch || "").trim();
  if (branchName && branchName !== "main") return true;

  const head = String(headSha || "").trim();
  const tip = String(mainSha || "").trim();
  if (!head || !tip) return true;

  return head !== tip;
}
