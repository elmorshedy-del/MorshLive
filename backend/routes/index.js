import { assetsDataRoute } from "./assets-data.js";
import { healthRoute } from "./health.js";
import { xtreamRoute } from "./xtream.js";

/** Registered backend routes — add new modules here. */
export const backendRoutes = [healthRoute, xtreamRoute, assetsDataRoute];
