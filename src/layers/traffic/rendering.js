import * as Cesium from 'cesium';
import { flowBucket } from '../../data/trafficFlowStyle.js';
import { trafficStyleProfile } from '../../data/trafficPresetStyle.js';
import {
  HEAT_LINE_CAP,
  HEAT_FREE_COLOR,
  HEAT_JAM_COLOR,
  HEAT_SLOW_COLOR,
  HEAT_CLOSURE_COLOR,
  HEAT_LINE_FREE_WIDTH,
  HEAT_LINE_JAM_WIDTH,
  HEAT_LINE_CLOSURE_WIDTH,
  HEAT_JAM_BASE_ALPHA,
  HEAT_LINE_SLOW_WIDTH,
  TRAFFIC_TIMING_ENABLED,
} from './policy.js';

export function createRendering({
  state: layerState,
  services,
  parts,
  source,
}) {
  /**
   * At high altitude only major roads render — shared by the render pass and
   * the late-flow heat-line rebuild so lines never mark roads without dots.
   * @param {Array} roads    - Parsed road objects.
   * @param {number} altitude - Camera altitude in meters.
   * @returns {Array} The roads visible at this altitude.
   */

  function visibleRoadsForAltitude(roads, altitude) {
    return altitude > 5000
      ? roads.filter(
          (r) =>
            r.type === 'motorway' || r.type === 'trunk' || r.type === 'primary',
        )
      : roads;
  }

  /** Remove both heat-line ground primitives from the scene. */

  function removeHeatLines() {
    if (layerState._flowLineCollection) {
      layerState._viewer?.scene.primitives.remove(layerState._flowLineCollection);
      layerState._flowLineCollection = null;
    }
    if (layerState._heatFreePrim) {
      layerState._viewer?.scene.groundPrimitives.remove(layerState._heatFreePrim);
      layerState._heatFreePrim = null;
    }
    if (layerState._heatJamPrim) {
      layerState._viewer?.scene.groundPrimitives.remove(
        layerState._heatJamPrim,
      );
      layerState._heatJamPrim = null;
    }
    if (layerState._heatSlowPrim) {
      layerState._viewer?.scene.groundPrimitives.remove(layerState._heatSlowPrim);
      layerState._heatSlowPrim = null;
    }
    if (layerState._heatClosurePrim) {
      layerState._viewer?.scene.groundPrimitives.remove(layerState._heatClosurePrim);
      layerState._heatClosurePrim = null;
    }
    layerState._heatLineCount = 0;
    parts.animation.syncRenderDemand?.();
  }

  /**
   * Rebuild the congestion heat-line underlay (jam-viz heatline prototype):
   * slow/jam roads drape a corridor line onto the rendered 3D tiles — glowing
   * pulsing red for jam, faint flat amber for slow — with the dots animating
   * on top. Two batched GroundPolylinePrimitives (one per bucket) so the jam
   * batch pulses through one shared material. Capped at HEAT_LINE_CAP (jam
   * first, longest first); overflow is logged. No-op in sim mode, when the
   * heatline mode is off, or without ground-primitive support.
   *
   * @param {Array} roads - Road objects visible in the current render.
   */

  function rebuildHeatLines(roads) {
    removeHeatLines();
    if (!layerState._viewer || !layerState._liveMode) return;

    const candidates = [];
    for (const road of roads) {
      const flow = road.flow;
      if (!flow || road.waypoints?.length < 2) continue;
      const bucket = flow.closure ? 'closure' : flowBucket(flow.level);
      let len = 0;
      for (const d of road.segmentDist) len += d;
      candidates.push({ road, bucket, len });
    }
    const priority = { closure: 0, jam: 1, slow: 2, free: 3 };
    candidates.sort((a, b) =>
      a.bucket === b.bucket
        ? b.len - a.len
        : priority[a.bucket] - priority[b.bucket],
    );
    const kept = candidates.slice(0, HEAT_LINE_CAP);
    const mono =
      layerState._presetDots === 'on' &&
      trafficStyleProfile(layerState._stylePreset) === 'mono';
    const colorFor = (bucket) => {
      if (mono) {
        if (bucket === 'closure' || bucket === 'jam') return Cesium.Color.WHITE;
        return bucket === 'slow'
          ? new Cesium.Color(0.82, 0.82, 0.82, 0.92)
          : new Cesium.Color(0.68, 0.68, 0.68, 0.8);
      }
      if (bucket === 'closure') return HEAT_CLOSURE_COLOR;
      if (bucket === 'jam') return HEAT_JAM_COLOR.withAlpha(0.95);
      if (bucket === 'slow') return HEAT_SLOW_COLOR.withAlpha(0.95);
      return HEAT_FREE_COLOR.withAlpha(0.88);
    };
    const widthFor = (bucket) =>
      bucket === 'closure'
        ? HEAT_LINE_CLOSURE_WIDTH
        : bucket === 'jam'
          ? Math.max(7, HEAT_LINE_JAM_WIDTH)
          : bucket === 'slow'
            ? Math.max(5, HEAT_LINE_SLOW_WIDTH)
            : Math.max(4, HEAT_LINE_FREE_WIDTH);

    const collection = new Cesium.PolylineCollection();
    for (const { road, bucket } of kept) {
      collection.add({
        positions: road.waypoints,
        width: widthFor(bucket),
        material:
          bucket === 'jam' || bucket === 'closure'
            ? Cesium.Material.fromType('PolylineGlow', {
                color: colorFor(bucket),
                glowPower: bucket === 'closure' ? 0.35 : 0.22,
              })
            : Cesium.Material.fromType('Color', { color: colorFor(bucket) }),
      });
    }
    layerState._flowLineCollection =
      layerState._viewer.scene.primitives.add(collection);
    layerState._heatLineCount = kept.length;
    parts.animation.syncRenderDemand?.();
    layerState._viewer.scene.requestRender();

    if (candidates.length > kept.length) {
      console.log(
        `[Data:Traffic] Live-flow corridors capped at ${HEAT_LINE_CAP} (${candidates.length} observed segments in view)`,
      );
    }
  }

  /**
   * Reconcile road populations without respawning retained dots.
   *
   * When zoomed out (>5 km), only major road types are rendered to reduce clutter.
   * Dot budgets are allocated fairly across visible roads via `allocateRoadDotBudgets`.
   *
   * @param {Array} roads    - Parsed road objects to render.
   * @param {number} altitude - Camera altitude in meters.
   * @param {string} label    - Logging label (e.g. "Cache full", "Loaded major").
   * @param {Object|null} [trace=null] - Development-only correlated load trace.
   */

  function renderRoadsForAltitude(
    roads,
    altitude,
    label,
    trace = null,
    replace = true,
  ) {
    const state =
      TRAFFIC_TIMING_ENABLED && trace
        ? parts.timing.trafficTimingRenderState(trace, label)
        : null;
    const renderId = state ? ++trace.renderSequence : null;

    layerState._lastPaintStage = label;
    layerState._lastRenderAltitude = altitude;

    // At high altitude, drop minor roads to reduce visual noise
    const filteredRoads = visibleRoadsForAltitude(roads, altitude);

    // Closed roads spawn zero dots (computeDotCount/spawnDotsForRoad) — count
    // them here so the closure signal is visible in stats even at zero dots.
    layerState._closedRoads = layerState._liveMode
      ? filteredRoads.reduce((n, r) => n + (r.flow?.closure ? 1 : 0), 0)
      : 0;

    // Fade distances must track the camera-to-AREA distance, not assume a
    // nadir view: oblique pitches put the loaded roads many km away even at
    // low altitude. Probe three roads and stretch the curves accordingly.
    let areaDist = altitude;
    if (layerState._viewer && filteredRoads.length) {
      const probes = [
        filteredRoads[0],
        filteredRoads[Math.floor(filteredRoads.length / 2)],
        filteredRoads[filteredRoads.length - 1],
      ];
      for (const probe of probes) {
        const wp = probe?.waypoints?.[0];
        if (wp)
          areaDist = Math.max(
            areaDist,
            Cesium.Cartesian3.distance(
              layerState._viewer.camera.positionWC,
              wp,
            ),
          );
      }
    }
    layerState._fadeScaleFar = Math.max(8000, areaDist * 1.5);
    layerState._fadeTransFar = Math.max(10000, areaDist * 1.8);

    const dotStart = state
      ? parts.timing.trafficTimingMark(state, 'dot-construction-start', {
          renderId,
          renderLabel: label,
          roadCount: roads.length,
          visibleRoadCount: filteredRoads.length,
        })
      : null;
    parts.retention.reconcile(filteredRoads, altitude, replace);
    if (filteredRoads.some((r) => !r.directFlow && (!layerState._liveMode || r.flow)))
      services.credits?.showOsmCredit?.(layerState._viewer, 'traffic', {
        openMapTiles: true,
      });
    else services.credits?.hideOsmCredit?.(layerState._viewer, 'traffic');
    parts.model.recolorDotsInPlace(label);

    const renderMetrics = state
      ? {
          renderId,
          renderLabel: label,
          roadCount: roads.length,
          visibleRoadCount: filteredRoads.length,
          dotCount: layerState._dots.length,
        }
      : null;
    if (state) {
      const dotEnd = parts.timing.trafficTimingMark(
        state,
        'dot-construction-end',
        renderMetrics,
      );
      parts.timing.trafficTimingMeasure(
        'dot-construction',
        state,
        dotStart,
        dotEnd,
        renderMetrics,
      );
    }

    const heatStart = state
      ? parts.timing.trafficTimingMark(
          state,
          'rebuild-heat-lines-start',
          renderMetrics,
        )
      : null;
    if (!label.includes('tile')) rebuildHeatLines(filteredRoads);
    if (state) {
      const heatEnd = parts.timing.trafficTimingMark(
        state,
        'rebuild-heat-lines-end',
        {
          ...renderMetrics,
          heatLineCount: layerState._heatLineCount,
        },
      );
      parts.timing.trafficTimingMeasure(
        'rebuild-heat-lines',
        state,
        heatStart,
        heatEnd,
        {
          ...renderMetrics,
          heatLineCount: layerState._heatLineCount,
        },
      );
    }

    parts.retention.refreshCounts();
    layerState._lastUpdate = Date.now();
    console.log(
      `[Data:Traffic] ${label}: ${layerState._count} dots (roads=${roads.length}, alt=${Math.round(altitude)}m)`,
    );
    if (state) {
      const renderEnd = parts.timing.trafficTimingMark(
        state,
        'render-return',
        renderMetrics,
      );
      parts.timing.scheduleTrafficTimingPostRender(
        state,
        renderEnd,
        renderId,
        renderMetrics,
      );
    }
  }
  return {
    visibleRoadsForAltitude,
    removeHeatLines,
    rebuildHeatLines,
    renderRoadsForAltitude,
  };
}
