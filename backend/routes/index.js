import { assetsDataRoute } from "./assets-data.js";
import { footballRoute } from "./football.js";
import { healthRoute } from "./health.js";
import { iptvLabRoute } from "./iptv-lab.js";
import { matchSeoRoute } from "./match-seo.js";
import { streamPlanRoute } from "./stream-plan.js";
import { tournamentSeoRoute } from "./tournament-seo.js";
import { xtreamRoute } from "./xtream.js";

/** Registered backend routes — add new modules here. */
export const backendRoutes = [
  matchSeoRoute,
  tournamentSeoRoute,
  healthRoute,
  footballRoute,
  streamPlanRoute,
  iptvLabRoute,
  xtreamRoute,
  assetsDataRoute,
];
