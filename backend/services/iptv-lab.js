import { iptvLabWorkerEnv } from "../../lib/iptv-lab.js";
import { getXtreamCategories, getXtreamLive, getXtreamStatus, probeXtreamChannel } from "./xtream.js";

function labOrError(env) {
  const lab = iptvLabWorkerEnv(env);
  if (!lab.ok) return { error: lab.error, status: 404 };
  return lab;
}

function isolate(result) {
  return {
    ...result,
    body: { ...result.body, isolated: true, source: "IPTV_LAB_JSON" },
  };
}

function missingSecret(lab) {
  return {
    body: { ok: false, error: lab.error, isolated: true, source: "IPTV_LAB_JSON" },
    status: lab.status,
  };
}

export async function getIptvLabStatus(env, searchParams) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);
  return isolate(await getXtreamStatus(lab.env, searchParams));
}

export async function getIptvLabCategories(env, searchParams) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);
  return isolate(await getXtreamCategories(lab.env, searchParams));
}

export async function getIptvLabLive(env, searchParams) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);
  const params = new URLSearchParams(searchParams);
  params.delete("direct");
  return isolate(await getXtreamLive(lab.env, params));
}

export async function probeIptvLabChannel(env, searchParams) {
  const lab = labOrError(env);
  if (lab.error) return missingSecret(lab);
  return isolate(await probeXtreamChannel(lab.env, searchParams));
}
