const cleanText = (value, max = 180) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const cleanLine = (value) => {
  const text = cleanText(value, 16);
  return /^\d{1,3}[A-Za-z]?$/.test(text) ? text : null;
};

const cleanColor = (value) => {
  const text = cleanText(value, 16).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : '#00D4FF';
};

const cleanCoordinate = (value, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
};

function normalizeRoute(row, index) {
  const line = cleanLine(row?.line);
  if (!line || !Array.isArray(row?.coordinates) || row.coordinates.length < 2)
    return null;
  const coordinates = [];
  for (const pair of row.coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = cleanCoordinate(pair[0], -180, 180);
    const lat = cleanCoordinate(pair[1], -90, 90);
    if (lon !== null && lat !== null)
      coordinates.push(Object.freeze([lon, lat]));
  }
  if (coordinates.length < 2) return null;
  return Object.freeze({
    id: cleanText(row.id, 64) || `route-${index}`,
    line,
    color: cleanColor(row.color),
    name: cleanText(row.name, 180) || `Metrobús Línea ${line}`,
    coordinates: Object.freeze(coordinates),
  });
}

function normalizeStation(row, index) {
  const lon = cleanCoordinate(row?.lon, -180, 180);
  const lat = cleanCoordinate(row?.lat, -90, 90);
  if (lon === null || lat === null) return null;
  const lines = [
    ...new Set(
      (Array.isArray(row?.lines) ? row.lines : [])
        .map(cleanLine)
        .filter(Boolean),
    ),
  ].sort(
    (a, b) =>
      Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b),
  );
  return Object.freeze({
    id: cleanText(row.id, 64) || `station-${index}`,
    name: cleanText(row.name, 160) || 'Estación Metrobús',
    lines: Object.freeze(lines),
    lon,
    lat,
  });
}

export function normalizeMetrobusNetwork({ routes, stations } = {}) {
  if (!Array.isArray(routes) || !Array.isArray(stations))
    throw new TypeError('Metrobús dataset needs route and station arrays');
  const cleanRoutes = routes.map(normalizeRoute).filter(Boolean);
  const cleanStations = stations.map(normalizeStation).filter(Boolean);
  if (!cleanRoutes.length || !cleanStations.length)
    throw new TypeError('Metrobús dataset needs routes and stations');

  const lineRows = new Map();
  for (const route of cleanRoutes) {
    let row = lineRows.get(route.line);
    if (!row) {
      row = {
        id: route.line,
        routeCount: 0,
        stationCount: 0,
        colors: new Map(),
      };
      lineRows.set(route.line, row);
    }
    row.routeCount += 1;
    row.colors.set(route.color, (row.colors.get(route.color) || 0) + 1);
  }
  for (const station of cleanStations) {
    for (const line of station.lines) {
      const row = lineRows.get(line);
      if (row) row.stationCount += 1;
    }
  }

  const lines = [...lineRows.values()]
    .map((row) =>
      Object.freeze({
        id: row.id,
        color:
          [...row.colors.entries()].sort(
            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
          )[0]?.[0] || '#00D4FF',
        routeCount: row.routeCount,
        stationCount: row.stationCount,
      }),
    )
    .sort(
      (a, b) =>
        Number.parseInt(a.id, 10) - Number.parseInt(b.id, 10) ||
        a.id.localeCompare(b.id),
    );

  return Object.freeze({
    routes: Object.freeze(cleanRoutes),
    stations: Object.freeze(cleanStations),
    lines: Object.freeze(lines),
  });
}

export const METROBUS_STATION_MAX_DISTANCE_M = 60_000;
