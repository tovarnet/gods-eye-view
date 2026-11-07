export const GROUND_FLOOR_CLAMP_RADIUS_KM = 150;

export const GROUND_FLOOR_WARM_MAX_ALT_M = 4500;

/** Maximum observed fixes retained. Also feeds the honest far-zoom trail. */
export const POSITION_HISTORY_LIMIT = 40;

export const LANDED_MISSING_POLL_LIMIT = 1;

export const MISSING_POLL_LIMIT = 6;

/** Cooldown in milliseconds after a transient source error. */
export const ERROR_BACKOFF_INTERVAL = 20000;

/** Local equirectangular distance used for viewer-proximate floor sampling. */
export { approxDistanceKm } from '../../data/approxDistance.js';
