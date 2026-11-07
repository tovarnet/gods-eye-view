import { DOT_FADE_MS } from './retention.js';
import { flowBucket, flowSpeedScale } from '../../data/trafficFlowStyle.js';
import { presetDotOutline } from '../../data/trafficPresetStyle.js';
import * as Cesium from 'cesium';
import { queuePlatoons, locateAlongRoad } from '../../data/trafficQueue.js';
import {
  SPEED_MPS,
  MAX_DOTS,
  JAM_DOT_FAR_SCALE,
  CREEP_MOVE_MS,
  CREEP_STOP_MS,
  CREEP_BURST,
  HEAT_JAM_BASE_ALPHA,
  HEAT_JAM_PULSE_ALPHA,
} from './policy.js';

export function createAnimation({
  state: layerState,
  services,
  parts,
  source,
}) {
  function trafficCarSprite() {
    if (layerState._trafficCarSprite) return layerState._trafficCarSprite;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, 64, 32);
    // Soft halo keeps the sprite legible over satellite imagery.
    ctx.shadowColor = 'rgba(0,0,0,.75)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(9, 7, 46, 18, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Windshield / roof detail: enough to read as a top-down car at small size.
    ctx.fillStyle = 'rgba(25,35,45,.78)';
    ctx.beginPath();
    ctx.roundRect(25, 9, 17, 14, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(10,10,10,.92)';
    ctx.fillRect(12, 4, 10, 4);
    ctx.fillRect(42, 4, 10, 4);
    ctx.fillRect(12, 24, 10, 4);
    ctx.fillRect(42, 24, 10, 4);
    layerState._trafficCarSprite = canvas;
    return canvas;
  }

  function billboardRotation(dot) {
    if (!dot?.billboard || !layerState._viewer) return;
    const scene = layerState._viewer.scene;
    const a = dot.waypoints?.[dot.segIdx];
    const b = dot.waypoints?.[dot.segIdx + 1];
    if (!a || !b) return;
    const pa = Cesium.SceneTransforms.worldToWindowCoordinates(scene, a);
    const pb = Cesium.SceneTransforms.worldToWindowCoordinates(scene, b);
    if (!pa || !pb) return;
    let angle = -Math.atan2(pb.y - pa.y, pb.x - pa.x);
    if (dot.direction < 0) angle += Math.PI;
    dot.billboard.rotation = angle;
  }
  function syncRenderDemand() {
    const needed = Boolean(
      layerState._enabled &&
      (layerState._dots.length || layerState._heatJamPrim),
    );
    // Height easing only runs in a held frame. Settle it before releasing, so
    // a population emptied mid-correction cannot report loading forever.
    if (!needed && layerState._heightPending) parts.retention.finishHeights();
    if (needed === Boolean(layerState._renderHeld)) return;
    layerState._renderHeld = needed;
    if (needed) {
      layerState._lastAnimTime = 0;
      services.render.holdContinuousRender('traffic');
      layerState._viewer?.scene?.requestRender?.();
    } else services.render.releaseContinuousRender('traffic');
  }

  /**
   * Spawn animated dot primitives along a single road.
   *
   * Each dot is placed at a random position along the road, assigned a
   * randomized speed (base +/-30%), and given a direction (alternating
   * forward/backward to simulate two-way traffic).
   *
   * @param {{waypoints:Cesium.Cartesian3[], segmentDist:number[], type:string, coords:number[][]}} road
   *   Parsed road object with pre-computed waypoints.
   * @param {number} altitude      - Camera altitude (used if budgetCount is null).
   * @param {number|null} [budgetCount=null] - Pre-allocated dot count. Falls back
   *   to `computeDotCount` when null.
   */

  function spawnDotsForRoad(road, altitude, budgetCount = null) {
    // Live flow styling (`road.flow` only exists in live mode; keyless path is
    // byte-identical): closures spawn nothing, congestion colors/slows dots.
    const flow = layerState._liveMode ? road.flow : null;
    if (flow?.closure) return;
    if (layerState._liveMode && !flow && layerState._uncoveredMode === 'hide')
      return;

    const count = Number.isFinite(budgetCount)
      ? Math.max(0, Math.floor(budgetCount))
      : parts.model.computeDotCount(road, altitude);
    const numSegments = road.waypoints.length - 1;
    if (numSegments < 1 || count <= 0) return;

    const baseMps = SPEED_MPS[road.type] || 5;
    const bucket = flow ? flowBucket(flow.level) : null;
    // Jam dots get +1px: a red queue should read as a queue at a glance.
    // Preset-aware styling adds its own size delta and floors the base (0 /
    // no floor under the normal profile) so NVG/FLIR/CRT dots stay PRESENT.
    const pixelSize =
      parts.style.baseDotSize(road.type, bucket) +
      (bucket === 'jam' ? 1 : 0) +
      parts.style.activeSizeDelta(bucket);
    const flowColor = bucket ? layerState._activeBucketColors[bucket] : null;
    // Dark-halo outline under styled presets (null = shipped no-outline).
    const outlineSpec =
      bucket && layerState._presetDots === 'on'
        ? presetDotOutline(layerState._stylePreset, bucket)
        : null;
    const outlineColor = outlineSpec
      ? new Cesium.Color(
          outlineSpec.rgba[0] / 255,
          outlineSpec.rgba[1] / 255,
          outlineSpec.rgba[2] / 255,
          outlineSpec.rgba[3],
        )
      : null;
    const flowSpeed = flow ? flowSpeedScale(flow.level) : 1;
    const now = Date.now();

    // Live mode: distribute anonymous flow particles evenly along the measured
    // corridor. Simulation mode may still use the legacy queue prototype.
    let placements = null;
    if (layerState._liveMode) {
      let totalLen = 0;
      for (const d of road.segmentDist) totalLen += d;
      placements = [];
      for (let i = 0; i < count; i++) {
        const { segIdx, t } = locateAlongRoad(
          road.segmentDist,
          totalLen * ((i + 0.5) / count),
        );
        placements.push({
          segIdx,
          t,
          direction: road.oneway ? road.oneway : i % 2 === 0 ? 1 : -1,
        });
      }
    } else if (bucket === 'jam' && parts.style.jamDensityOn()) {
      let totalLen = 0;
      for (const d of road.segmentDist) totalLen += d;
      const platoons = queuePlatoons(totalLen, count);
      if (platoons.length) {
        placements = [];
        for (let p = 0; p < platoons.length; p++) {
          const dir = road.oneway ? road.oneway : p % 2 === 0 ? 1 : -1;
          for (const s of platoons[p]) {
            const { segIdx, t } = locateAlongRoad(road.segmentDist, s);
            placements.push({ segIdx, t, direction: dir });
          }
        }
      }
    }

    for (let i = 0; i < count; i++) {
      if (layerState._dots.length >= MAX_DOTS) return;

      // Random start position: pick a random segment and offset within it —
      // unless this is a queued jam dot with a platoon placement.
      const segIdx = placements
        ? placements[i].segIdx
        : Math.floor(Math.random() * numSegments);
      const t = placements ? placements[i].t : Math.random();

      // Speed noise: base speed +/-30% for organic variation. baseMps (noise
      // included, flow excluded) is kept on the dot so a late-arriving flow
      // match can rescale speed in place (recolorDotsInPlace).
      const noisedMps = layerState._liveMode
        ? baseMps * layerState._speedScale
        : baseMps * layerState._speedScale * (0.7 + Math.random() * 0.6);
      const mps = noisedMps * flowSpeed;

      // One-way roads flow only their legal direction; two-way alternates
      // (per platoon in queue mode — a queue moves as one).
      const direction = placements
        ? placements[i].direction
        : road.oneway
          ? road.oneway
          : i % 2 === 0
            ? 1
            : -1;

      // Compute initial Cartesian3 position via linear interpolation
      Cesium.Cartesian3.lerp(
        road.waypoints[segIdx],
        road.waypoints[segIdx + 1],
        t,
        layerState._scratchLerp,
      );

      // Grounded traffic respects building/terrain occlusion. The former
      // depth override made distant roads look like vehicles crossing roofs.
      const jamProminent =
        !layerState._liveMode && bucket === 'jam' && parts.style.jamDensityOn();
      const id = layerState._nextDotId++;
      const point = layerState._pointCollection.add({
        position: Cesium.Cartesian3.clone(layerState._scratchLerp),
        // In live mode this point is an invisible motion anchor; the user sees
        // the car billboard. Simulation mode keeps the legacy point rendering.
        pixelSize: layerState._liveMode ? 1 : pixelSize,
        color: layerState._liveMode
          ? Cesium.Color.TRANSPARENT
          : flowColor || Cesium.Color.WHITE.withAlpha(0.85),
        scaleByDistance: new Cesium.NearFarScalar(
          100,
          1.5,
          layerState._fadeScaleFar,
          jamProminent ? JAM_DOT_FAR_SCALE : 0.3,
        ),
        translucencyByDistance: new Cesium.NearFarScalar(
          100,
          1.0,
          layerState._fadeTransFar,
          0.0,
        ),
        // Respect the sampled mesh at every viewing distance.
        disableDepthTestDistance: 0,
        // Preset dark halo (spread only when present — the keyless/normal
        // path passes the exact shipped option set).
        ...(outlineSpec
          ? { outlineColor, outlineWidth: outlineSpec.width }
          : {}),
      });
      const billboard =
        layerState._liveMode && layerState._trafficBillboards
          ? layerState._trafficBillboards.add({
              position: Cesium.Cartesian3.clone(layerState._scratchLerp),
              image: trafficCarSprite(),
              width: 24,
              height: 12,
              color: flowColor || Cesium.Color.WHITE,
              scaleByDistance: new Cesium.NearFarScalar(
                80,
                1.45,
                Math.max(16000, layerState._fadeScaleFar * 1.6),
                0.7,
              ),
              translucencyByDistance: new Cesium.NearFarScalar(
                80,
                1.0,
                Math.max(18000, layerState._fadeTransFar * 1.6),
                0.42,
              ),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            })
          : null;
      layerState._bucketCounts[bucket || 'sim'] += 1;

      layerState._motion.added++;
      const dot = {
        id,
        index: layerState._dots.length,
        born: now,
        retiring: 0,
        nominalSize: pixelSize,
        recycle: false,
        point,
        billboard,
        road,
        bucket, // flow bucket at spawn (null = sim) — drives preset restyle/pulse
        waypoints: road.waypoints,
        segmentDist: road.segmentDist,
        numSegments,
        segIdx,
        t,
        mps, // meters per second (flow-scaled)
        baseMps: noisedMps, // pre-flow speed, for in-place flow rescale
        direction,
        stoppedUntil: 0,
        // Stop-and-go creep state (jam-viz density prototype): jam dots
        // alternate move-bursts and stops. Null in sim mode and for non-jam.
        creep:
          !layerState._liveMode &&
          bucket === 'jam' &&
          parts.style.jamDensityOn()
            ? { moving: Math.random() < 0.4, until: now + Math.random() * 2000 }
            : null,
      };
      layerState._dots.push(dot);
      billboardRotation(dot);
    }
    syncRenderDemand();
  }

  /**
   * Per-frame animation callback registered on `scene.preRender`.
   *
   * For every active dot:
   *  1. Ease heights and fade arrivals/departures, including paused dots.
   *  2. Convert speed (m/s) to a parametric t-delta relative to the current
   *     segment's Cartesian distance.
   *  3. Advance t in the dot's travel direction, handling segment boundary
   *     crossings and faded end-of-road departures.
   *  4. Linearly interpolate between the two bounding waypoints and update the
   *     point primitive's position.
   *
   * Delta time is capped at 100 ms to prevent large jumps after background tabs.
   */

  function animate() {
    syncRenderDemand();
    if (!layerState._renderHeld) return;
    const now = Date.now();
    // Delta time in seconds, capped to avoid jumps when returning from background tab
    const dt = layerState._lastAnimTime
      ? Math.min((now - layerState._lastAnimTime) / 1000, 0.1)
      : 0.016;
    layerState._lastAnimTime = now;

    parts.retention.easeHeights(dt);
    for (let i = 0; i < layerState._dots.length; i++) {
      const dot = layerState._dots[i];
      if (dot.recycle) {
        // A road-end departure is a new simulated vehicle at the entry, never
        // a teleport attributed to the departed vehicle's stable identity.
        dot.id = layerState._nextDotId++;
        dot.segIdx = dot.direction > 0 ? 0 : dot.numSegments - 1;
        dot.t = dot.direction > 0 ? 0 : 1;
        dot.born = now;
        dot.recycle = false;
        layerState._motion.recycled++;
      }
      const remaining =
        dot.direction > 0
          ? dot.segIdx === dot.numSegments - 1
            ? (1 - dot.t) * dot.segmentDist[dot.segIdx]
            : Infinity
          : dot.segIdx === 0
            ? dot.t * dot.segmentDist[0]
            : Infinity;
      const endpointFade = Math.min(1, remaining / Math.max(1, dot.mps * 0.25));
      const visibility = Math.max(
        0,
        Math.min(
          1,
          (now - dot.born) / DOT_FADE_MS,
          dot.retiring ? 1 - (now - dot.retiring) / DOT_FADE_MS : 1,
          endpointFade,
        ),
      );
      dot.point.pixelSize = layerState._liveMode
        ? Math.max(0.1, visibility)
        : dot.nominalSize * visibility;
      if (dot.billboard) dot.billboard.scale = visibility;

      // Stop-and-go creep (jam-viz density prototype, live jam dots only):
      // alternate short forward bursts with stops. The burst multiplier keeps
      // the long-run average near the honest TomTom crawl speed.
      let burst = now < dot.stoppedUntil ? 0 : 1;
      if (dot.creep) {
        if (now >= dot.creep.until) {
          dot.creep.moving = !dot.creep.moving;
          const [lo, hi] = dot.creep.moving ? CREEP_MOVE_MS : CREEP_STOP_MS;
          dot.creep.until = now + lo + Math.random() * (hi - lo);
        }
        if (!dot.creep.moving) burst = 0;
        else burst *= CREEP_BURST;
      }

      // Carry metres across bends, not a t fraction from a differently sized
      // segment. Short segments cannot turn a slow car into a large jump.
      let travel = dot.mps * burst * dt;
      while (travel > 0) {
        const length = Math.max(0.001, dot.segmentDist[dot.segIdx]);
        const available = (dot.direction > 0 ? 1 - dot.t : dot.t) * length;
        if (travel < available) {
          dot.t += (travel / length) * dot.direction;
          break;
        }
        travel -= available;
        const next = dot.segIdx + dot.direction;
        if (next < 0 || next >= dot.numSegments) {
          dot.t = dot.direction > 0 ? 1 : 0;
          dot.point.pixelSize = 0;
          if (dot.billboard) dot.billboard.scale = 0;
          dot.recycle = true;
          break;
        }
        dot.segIdx = next;
        dot.t = dot.direction > 0 ? 0 : 1;
        if (!layerState._liveMode) maybeStopLight(dot, now);
        if (now < dot.stoppedUntil) break;
      }

      // Lerp between pre-computed Cartesian3 waypoints (no trig needed).
      // Pass the scratch directly: PointPrimitive's position setter clones the
      // value into its own storage (and skips the VBO dirty flag when equal), so
      // the extra defensive clone here allocated 360–720k Cartesian3/s of pure
      // garbage across 6000 dots. (perf item 5)
      const a = dot.waypoints[dot.segIdx];
      const b = dot.waypoints[dot.segIdx + 1];
      Cesium.Cartesian3.lerp(a, b, dot.t, layerState._scratchLerp);
      dot.point.position = layerState._scratchLerp;
      if (dot.billboard) {
        dot.billboard.position = layerState._scratchLerp;
        // Refresh orientation periodically so camera rotation and road bends
        // keep the top-down car aligned with the apparent lane direction.
        if ((layerState._animFrame + i) % 8 === 0) billboardRotation(dot);
      }
    }

    // Jam heat-lines throb (~1.6 s period) — one shared material uniform for
    // the whole jam batch, no geometry rebuild. Null outside live heatline mode.
    if (layerState._heatJamPrim?.appearance) {
      layerState._heatJamPrim.appearance.material.uniforms.color.alpha =
        HEAT_JAM_BASE_ALPHA + HEAT_JAM_PULSE_ALPHA * Math.sin(now / 260);
    }

    layerState._animFrame++;
  }

  /**
   * Randomly pause a dot near road endpoints to simulate stop-light behaviour.
   *
   * Only triggers within the first 2 or last 2 segments of the road, and only
   * with a very low per-frame probability (0.8%) to keep traffic flowing.
   *
   * @param {Object} dot - The dot state object.
   * @param {number} now - Current timestamp in milliseconds.
   */

  function maybeStopLight(dot, now) {
    const nearEnd = dot.segIdx <= 1 || dot.segIdx >= dot.numSegments - 2;
    if (nearEnd && Math.random() < 0.008) {
      // Pause for 2–6 seconds
      dot.stoppedUntil = now + 2000 + Math.random() * 4000;
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────

  /** Remove all point primitives and reset dot/road arrays and counters. */

  function clearDots() {
    services.credits?.hideOsmCredit?.(layerState._viewer, 'traffic');
    parts.retention.clear();
    if (layerState._dots.length) layerState._motion.rebuilds++;
    if (layerState._pointCollection) layerState._pointCollection.removeAll();
    if (layerState._trafficBillboards) layerState._trafficBillboards.removeAll();
    parts.rendering.removeHeatLines();
    layerState._dots = [];
    layerState._roads = [];
    layerState._count = 0;
    layerState._bucketCounts = { free: 0, slow: 0, jam: 0, sim: 0 };
    layerState._closedRoads = 0;
    syncRenderDemand();
  }
  return {
    spawnDotsForRoad,
    animate,
    maybeStopLight,
    clearDots,
    syncRenderDemand,
  };
}
