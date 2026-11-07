import * as Cesium from 'cesium';
import {
  METROBUS_STATION_MAX_DISTANCE_M,
  normalizeMetrobusNetwork,
} from './model.js';
import { loadBundledMetrobusNetwork } from './source.js';

const STATION_COLOR = Cesium.Color.fromCssColorString('#F7FBFF');
const STATION_OUTLINE = Cesium.Color.fromCssColorString('#00D4FF');

function routePositions(coordinates) {
  const degrees = [];
  for (const [lon, lat] of coordinates) degrees.push(lon, lat);
  return Cesium.Cartesian3.fromDegreesArray(degrees);
}

/** Native static Metrobús CDMX network layer. Live vehicles remain owned by Transit. */
export function createMetrobusCdmxLayer({
  loadNetwork = loadBundledMetrobusNetwork,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _loaded = false;
  let _loading = false;
  let _network = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _request = null;
  let _rowControlsListener = null;

  const notify = () => _rowControlsListener?.();

  function buildEntities(network) {
    const next = [];
    for (const route of network.routes) {
      const color = Cesium.Color.fromCssColorString(route.color);
      next.push(
        new Cesium.Entity({
          id: `metrobus-route:${route.id}`,
          name: route.name,
          polyline: {
            positions: routePositions(route.coordinates),
            clampToGround: true,
            width: 5,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.95)),
          },
          properties: {
            kind: 'route',
            line: route.line,
            shapeId: route.id,
          },
        }),
      );
    }
    for (const station of network.stations) {
      next.push(
        new Cesium.Entity({
          id: `metrobus-station:${station.id}`,
          name: station.name,
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat),
          point: {
            pixelSize: 5,
            color: STATION_COLOR,
            outlineColor: STATION_OUTLINE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              0,
              METROBUS_STATION_MAX_DISTANCE_M,
            ),
          },
          properties: {
            kind: 'station',
            stopId: station.id,
            lines: station.lines.join(','),
          },
        }),
      );
    }
    return next;
  }

  return {
    id: 'metrobus-cdmx',
    name: 'Metrobús CDMX',
    icon: '🚌',
    source: 'Metrobús CDMX · GTFS 2026',
    updateInterval: 0,

    init(viewer) {
      if (_viewer)
        throw new Error('Metrobús CDMX layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('metrobus-cdmx');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      _loading = false;
      if (_dataSource) _dataSource.show = false;
      notify();
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      if (_loaded) return true;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      _loading = true;
      notify();
      try {
        const network = normalizeMetrobusNetwork(await loadNetwork());
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const entities = buildEntities(network);
        _dataSource.entities.removeAll();
        for (const entity of entities) _dataSource.entities.add(entity);
        _network = network;
        _loaded = true;
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _lastError = error?.message || null;
        return false;
      } finally {
        if (_request === request) _request = null;
        _loading = false;
        notify();
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      _loading = false;
      _viewer = null;
      _rowControlsListener = null;
      if (_dataSource) {
        viewer?.dataSources?.remove(_dataSource, true);
        _dataSource = null;
      }
      _network = null;
      _loaded = false;
      _lastUpdate = null;
      _lastError = null;
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      return {
        chips: [],
        legend: (_network?.lines || []).map((line) => ({
          label: String(line.id),
          color: line.color,
          count: line.routeCount,
        })),
      };
    },

    getStats() {
      return {
        count:
          (_network?.routes.length || 0) + (_network?.stations.length || 0),
        countLabel: _network
          ? `${_network.lines.length}L · ${_network.stations.length}E`
          : '',
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _lastError,
      };
    },
  };
}
