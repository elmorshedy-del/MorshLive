import { assetsDataRoute } from "./assets-data.js";
import { healthRoute } from "./health.js";

/** Registered backend routes — add new modules here. */
export const backendRoutes = [healthRoute, assetsDataRoute];
