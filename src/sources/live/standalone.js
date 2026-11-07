import {
  finite,
  httpError,
  LiveSourceError,
  readResponse,
} from './contract.js';
import {
  normalizeAircraftTrack,
  openSkySnapshot,
  readsbSnapshot,
  readsbIdentities,
} from './aircraft.js';
import { normalizeVesselTrack, vesselSnapshot } from './vessels.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const header = (response, name) => response.headers?.get?.(name);

function greatCircleKm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stableFlightRank(id) {
  let hash = 2166136261;
  for (const char of String(id || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function flightPriority(record, trackedId) {
  if (trackedId && record.id === trackedId) return 0;
  if (
    record.emergency ||
    record.squawk === '7500' ||
    record.squawk === '7600' ||
    record.squawk === '7700'
  )
    return 1;
  return 2;
}

const GLOBAL_GRID_DEG = 10;
const GLOBAL_SPARSE_CANDIDATE_THRESHOLD = 500;
const GLOBAL_MEXICO_RESERVE = 170;
const GLOBAL_NORTH_AMERICA_RESERVE = 300;
const MEXICO_CONTEXT_MAX = 100;

// Coarse operational footprint of Mexico used only for display admission.
// Separate polygons avoid the old rectangular mask that accidentally admitted
// Texas/Arizona/Florida as "Mexico". Coordinates are [longitude, latitude].
const MEXICO_MAINLAND_POLYGON = Object.freeze([
  [-114.72, 32.72],
  [-111.08, 31.33],
  [-109.05, 31.33],
  [-108.21, 31.78],
  [-106.53, 31.78],
  [-105.0, 30.7],
  [-103.0, 29.2],
  [-101.0, 29.0],
  [-100.0, 28.3],
  [-99.5, 27.6],
  [-99.0, 26.4],
  [-97.15, 25.96],
  [-97.0, 22.3],
  [-96.1, 19.2],
  [-94.5, 18.2],
  [-91.5, 18.7],
  [-90.5, 21.6],
  [-86.7, 21.6],
  [-87.5, 18.3],
  [-89.1, 17.8],
  [-91.4, 17.2],
  [-92.2, 14.55],
  [-94.0, 15.8],
  [-96.8, 15.7],
  [-99.8, 16.8],
  [-103.7, 18.7],
  [-105.7, 20.4],
  [-106.5, 23.0],
  [-109.0, 25.5],
  [-110.7, 27.5],
  [-112.0, 29.5],
  [-114.8, 31.8],
  [-114.72, 32.72],
]);

const MEXICO_BAJA_POLYGON = Object.freeze([
  [-117.13, 32.54],
  [-114.72, 32.72],
  [-114.5, 30.0],
  [-112.3, 28.0],
  [-111.0, 24.5],
  [-109.9, 22.9],
  [-110.1, 22.8],
  [-112.5, 24.5],
  [-114.6, 27.0],
  [-115.8, 29.5],
  [-117.13, 32.54],
]);

function pointInPolygon(longitude, latitude, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses =
      yi > latitude !== yj > latitude &&
      longitude <
        ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointIsInMexico(longitude, latitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < 14 || latitude > 33 || longitude < -118 || longitude > -86)
    return false;
  return (
    pointInPolygon(longitude, latitude, MEXICO_MAINLAND_POLYGON) ||
    pointInPolygon(longitude, latitude, MEXICO_BAJA_POLYGON)
  );
}

function inMexicoRegion(record) {
  return pointIsInMexico(record?.longitude, record?.latitude);
}

function inNorthAmericaRegion(record) {
  return (
    Number.isFinite(record?.latitude) &&
    Number.isFinite(record?.longitude) &&
    record.latitude >= 7 &&
    record.latitude <= 75 &&
    record.longitude >= -170 &&
    record.longitude <= -50
  );
}

function pointIsInMexicoFocus(latitude, longitude) {
  return pointIsInMexico(longitude, latitude);
}

function mexicoFocusedFlights(records, candidates, trackedId) {
  const selected = [];
  const selectedIds = new Set();
  const add = (record) => {
    if (!record?.id || selectedIds.has(record.id)) return false;
    selected.push(record);
    selectedIds.add(record.id);
    return true;
  };

  // Mexico view is intentionally lossless for verified Mexican contacts:
  // every fresh observed position OpenSky supplied inside the Mexico region
  // is rendered. We only thin the surrounding regional context.
  for (const record of records || []) {
    if (inMexicoRegion(record)) add(record);
  }

  // Tracked/emergency contacts outside Mexico remain visible.
  for (const item of candidates) {
    if (flightPriority(item.record, trackedId) <= 1) add(item.record);
  }

  const context = candidates
    .filter(({ record }) => !inMexicoRegion(record) && !selectedIds.has(record.id))
    .sort((a, b) => {
      const priority =
        flightPriority(a.record, trackedId) -
        flightPriority(b.record, trackedId);
      if (priority) return priority;
      return a.distanceKm - b.distanceKm;
    });

  for (const { record } of context.slice(0, MEXICO_CONTEXT_MAX)) add(record);
  return selected;
}

function globallyDistributedFlights(records, maxRows, trackedId) {
  if (!Array.isArray(records) || records.length <= maxRows) return records || [];

  const selected = [];
  const selectedIds = new Set();
  const add = (record) => {
    if (!record?.id || selectedIds.has(record.id) || selected.length >= maxRows)
      return false;
    selected.push(record);
    selectedIds.add(record.id);
    return true;
  };

  // Never lose an actively tracked or emergency contact.
  for (const record of records) {
    if (flightPriority(record, trackedId) <= 1) add(record);
  }

  // Mexico is the operator's primary region. Reserve enough global slots for
  // its observed contacts so zooming to the globe never makes Mexico vanish.
  const mexico = records
    .filter((record) => inMexicoRegion(record) && !selectedIds.has(record.id))
    .sort((a, b) => stableFlightRank(a.id) - stableFlightRank(b.id));
  for (const record of mexico.slice(0, GLOBAL_MEXICO_RESERVE)) add(record);

  // The operator frequently moves between Mexico and the United States.
  // Keep a meaningful North-American density at globe scale while preserving
  // more than half the global budget for the rest of the world.
  const northAmerica = records
    .filter(
      (record) =>
        inNorthAmericaRegion(record) &&
        !inMexicoRegion(record) &&
        !selectedIds.has(record.id),
    )
    .sort((a, b) => stableFlightRank(a.id) - stableFlightRank(b.id));
  for (const record of northAmerica.slice(0, GLOBAL_NORTH_AMERICA_RESERVE))
    add(record);

  const buckets = new Map();
  for (const record of records) {
    if (
      selectedIds.has(record.id) ||
      !Number.isFinite(record.latitude) ||
      !Number.isFinite(record.longitude)
    )
      continue;
    const y = Math.floor((record.latitude + 90) / GLOBAL_GRID_DEG);
    const x = Math.floor((record.longitude + 180) / GLOBAL_GRID_DEG);
    const key = `${y}:${x}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }

  const orderedBuckets = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, rows]) =>
      rows.sort((a, b) => stableFlightRank(a.id) - stableFlightRank(b.id)),
    );

  // Round-robin across geographic cells. Busy regions still receive multiple
  // contacts, but they can no longer consume the whole global budget.
  let round = 0;
  while (selected.length < maxRows) {
    let addedThisRound = 0;
    for (const bucket of orderedBuckets) {
      if (round < bucket.length && add(bucket[round])) addedThisRound += 1;
      if (selected.length >= maxRows) break;
    }
    if (!addedThisRound) break;
    round += 1;
  }

  return selected;
}

/**
 * Scope a real upstream snapshot to the operator's current view. This does not
 * synthesize, extrapolate or alter positions; it only chooses which observed
 * contacts are useful to render at the current zoom.
 */
export function scopeFlightSnapshot(snapshot, query = {}) {
  const latitude = Number(query.latitude);
  const longitude = Number(query.longitude);
  const radiusKm = Number(query.radiusKm);
  const maxRows = Math.max(1, Math.floor(Number(query.maxRows)));
  if (!Number.isFinite(maxRows)) return snapshot;

  const trackedId = String(query.trackedId || '').trim().toLowerCase();
  const baseCoverage = String(snapshot.coverage || '').trim();

  if (query.globalView === true) {
    const candidates = snapshot.records || [];
    const records = globallyDistributedFlights(candidates, maxRows, trackedId);
    const sparse =
      candidates.length < GLOBAL_SPARSE_CANDIDATE_THRESHOLD
        ? ' · upstream sparse'
        : '';
    const viewCoverage = `global distributed · ${records.length}/${candidates.length} shown · Mexico + North America priority${sparse}`;
    return {
      ...snapshot,
      records,
      retainIds: new Set(),
      complete: true,
      viewportScoped: true,
      scope: {
        globalView: true,
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
        radiusKm: null,
      },
      totalViewCandidates: candidates.length,
      coverage: baseCoverage ? `${baseCoverage}; ${viewCoverage}` : viewCoverage,
    };
  }

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(radiusKm) ||
    radiusKm <= 0
  )
    return snapshot;

  const candidates = [];
  for (const record of snapshot.records || []) {
    if (
      !Number.isFinite(record.latitude) ||
      !Number.isFinite(record.longitude)
    )
      continue;
    const distanceKm = greatCircleKm(
      latitude,
      longitude,
      record.latitude,
      record.longitude,
    );
    if (record.id === trackedId || distanceKm <= radiusKm) {
      candidates.push({ record, distanceKm });
    }
  }

  const mexicoFocus = pointIsInMexicoFocus(latitude, longitude);
  let records;
  if (mexicoFocus) {
    records = mexicoFocusedFlights(snapshot.records || [], candidates, trackedId);
  } else {
    let selected = candidates;
    if (candidates.length > maxRows) {
      selected = [...candidates]
        .sort((a, b) => {
          const priority =
            flightPriority(a.record, trackedId) -
            flightPriority(b.record, trackedId);
          if (priority) return priority;
          const rank =
            stableFlightRank(a.record.id) - stableFlightRank(b.record.id);
          if (rank) return rank;
          return a.distanceKm - b.distanceKm;
        })
        .slice(0, maxRows);
    }
    records = selected.map(({ record }) => record);
  }

  const mexicoCount = mexicoFocus
    ? records.filter((record) => inMexicoRegion(record)).length
    : 0;
  const viewCoverage = mexicoFocus
    ? `Mexico full verified · ${mexicoCount} Mexico + ${records.length - mexicoCount} context`
    : `view ${Math.round(radiusKm)} km · ${records.length}/${candidates.length} shown`;
  return {
    ...snapshot,
    records,
    retainIds: new Set(),
    complete: true,
    viewportScoped: true,
    scope: {
      globalView: false,
      latitude,
      longitude,
      radiusKm,
    },
    totalViewCandidates: candidates.length,
    coverage: baseCoverage ? `${baseCoverage}; ${viewCoverage}` : viewCoverage,
  };
}

function openSkyError(response) {
  const error = httpError(response, 'Flights');
  const mode = String(
    header(response, 'x-opensky-auth-mode-used') ||
      header(response, 'x-opensky-auth') ||
      '',
  ).toLowerCase();
  const reason = String(
    header(response, 'x-opensky-auth-reason') || '',
  ).toLowerCase();
  if (response.status === 429 && (!mode || mode === 'anon'))
    error.message = 'OpenSky rate limited (anonymous)';
  if (response.status === 401 || response.status === 403) {
    const reasons = {
      oauth_invalid_or_missing: 'OpenSky OAuth client missing/invalid',
      oauth_invalid_credentials: 'OpenSky OAuth rejected credentials',
      missing_oauth_creds: 'OpenSky auth missing',
      auth_required: 'OpenSky auth required',
      forced_anonymous: 'OpenSky auth required',
    };
    error.message =
      reasons[reason] ||
      (/^(oauth_|basic_)/.test(reason)
        ? 'OpenSky auth invalid'
        : mode === 'anon'
          ? 'OpenSky auth required'
          : 'OpenSky auth failed');
  }
  return error;
}

/**
 * The provider a feed response names in `X-Feed-Source`, so a server that
 * answers a feed route from another provider is reported as that provider.
 */
function feedSource(response, fallback) {
  const named = header(response, 'x-feed-source');
  return typeof named === 'string' && named.trim()
    ? named.trim().slice(0, 80)
    : fallback;
}

/** The flights feed (/api/flights); no request starts during construction. */
export function createFlightSource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    // i18n-ignore: feed source name, replaced by the provider from each snapshot and reported to AI tools
    label: 'Flights',
    async getSnapshot(query = {}, { signal } = {}) {
      const params = new URLSearchParams();
      if (Number.isFinite(query.latitude) && Number.isFinite(query.longitude)) {
        params.set('lat', query.latitude.toFixed(4));
        params.set('lon', query.longitude.toFixed(4));
      }
      if (Number.isFinite(query.radiusKm))
        params.set('radius_km', query.radiusKm.toFixed(1));
      if (Number.isFinite(query.maxRows))
        params.set('maxRows', String(Math.floor(query.maxRows)));
      if (query.globalView === true) params.set('global', '1');
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/flights${params.size ? '?' + params : ''}`,
        { signal },
        'Flights',
      );
      if (!response.ok) throw openSkyError(response);
      const snapshot = openSkySnapshot(payload, {
        // A fallback provider names itself in X-Flight-Source.
        source:
          header(response, 'x-flight-source') ||
          feedSource(response, 'Flights'),
        coverage:
          header(response, 'x-flight-coverage') ||
          'worldwide upstream snapshot',
        now: now(),
      });
      return {
        ...scopeFlightSnapshot(snapshot, query),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/flights/track?icao24=' + encodeURIComponent(reference),
        { signal },
        'Flights',
      );
      if (!response.ok) throw httpError(response, 'Flights');
      return {
        records: normalizeAircraftTrack(payload?.path),
        complete: false,
      };
    },
    async getEnrichment(query, { signal } = {}) {
      if (!['type', 'route'].includes(query.kind))
        throw new LiveSourceError('unsupported', 'Enrichment unavailable');
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/adsbdb/${query.kind}/${encodeURIComponent(query.id)}`,
        { signal },
        'adsbdb',
      );
      if (!response.ok) throw httpError(response, 'adsbdb');
      return payload;
    },
  };
}

export function createMilitarySource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    // i18n-ignore: feed source name, replaced by the provider from each snapshot and reported to AI tools
    label: 'Military aircraft',
    async getIdentities(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/military',
        { signal },
        'Military aircraft',
      );
      if (!response.ok) throw httpError(response, 'Military aircraft');
      return readsbIdentities(payload);
    },
    async getSnapshot(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/military',
        { signal },
        'Military aircraft',
      );
      if (!response.ok) throw httpError(response, 'Military aircraft');
      const age = finite(header(response, 'x-feed-age-ms'));
      return {
        ...readsbSnapshot(payload, {
          source: feedSource(response, 'Military aircraft'),
          observedAtMs: now() - (age != null && age > 0 ? age : 0),
          now: now(),
          stale: header(response, 'x-feed-cache') === 'STALE',
        }),
        status: response.status,
      };
    },
    // ADSB.lol does not expose a supported live-history endpoint. Omitting
    // optional getTrack keeps the tracking layer on its accumulated trail.
  };
}

export function createVesselSource({
  fetchImpl = defaultFetch,
  apiUrl = '/api/vessels',
  origin = () => globalThis.location?.origin || 'http://localhost',
} = {}) {
  return {
    // i18n-ignore: feed source name, replaced by the provider from each snapshot and reported to AI tools
    label: 'Vessels',
    async getSnapshot({ maxRows = 12000, area } = {}, { signal } = {}) {
      const url = new URL(apiUrl, origin());
      url.searchParams.set('maxRows', String(maxRows));
      // An area asks for the vessels around a point; servers that hold every
      // vessel may ignore it, since callers still keep only what they need.
      if (
        Number.isFinite(area?.lat) &&
        Number.isFinite(area?.lon) &&
        Number.isFinite(area?.radiusKm)
      ) {
        url.searchParams.set('lat', area.lat.toFixed(5));
        url.searchParams.set('lon', area.lon.toFixed(5));
        url.searchParams.set('radius_km', area.radiusKm.toFixed(1));
      }
      const { response, payload } = await readResponse(
        fetchImpl,
        url.toString(),
        { signal, cache: 'no-store' },
        'Vessels',
      );
      if (!response.ok) {
        const error = httpError(response, 'Vessels');
        const reasons = {
          'missing-key': 'AISSTREAM_API_KEY not set',
          'auth-failed': 'API key rejected — check AISSTREAM_API_KEY',
          unsupported: 'live feed unsupported',
          error: 'feed down',
          closed: 'feed disconnected',
        };
        error.message = reasons[payload?.status] || error.message;
        throw error;
      }
      return {
        ...vesselSnapshot(payload, { source: feedSource(response, 'Vessels') }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/vessels/track?mmsi=' + encodeURIComponent(reference),
        { signal },
        'Vessels',
      );
      if (!response.ok) throw httpError(response, 'Vessels');
      return {
        records: normalizeVesselTrack(payload?.samples),
        complete: false,
      };
    },
  };
}
