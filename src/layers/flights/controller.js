import * as Cesium from 'cesium';

const FLIGHT_VIEW_RADIUS_MIN_KM = 120;
const FLIGHT_VIEW_RADIUS_MAX_KM = 5000;

/**
 * Keep the live-flight layer useful at every zoom: enough geographic context
 * to match the current view, but never thousands of overlapping glyphs.
 */
export function flightViewportPolicy(cameraHeightM) {
  const heightKm = Number.isFinite(cameraHeightM)
    ? Math.max(0, cameraHeightM / 1000)
    : 500;
  const radiusKm = Math.round(
    Math.min(
      FLIGHT_VIEW_RADIUS_MAX_KM,
      Math.max(FLIGHT_VIEW_RADIUS_MIN_KM, 80 + heightKm * 2.4),
    ),
  );
  const maxRows =
    heightKm < 120 ? 260 : heightKm < 500 ? 320 : heightKm < 1500 ? 380 : 450;
  return { radiusKm, maxRows };
}

function flightViewAnchor(viewer, fallback) {
  const canvas = viewer?.scene?.canvas;
  const camera = viewer?.camera;
  if (
    camera?.pickEllipsoid &&
    canvas?.clientWidth > 0 &&
    canvas?.clientHeight > 0
  ) {
    const center = new Cesium.Cartesian2(
      canvas.clientWidth * 0.5,
      canvas.clientHeight * 0.5,
    );
    const ellipsoid = viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
    const point = camera.pickEllipsoid(center, ellipsoid);
    if (point) return Cesium.Cartographic.fromCartesian(point, ellipsoid);
  }
  return fallback;
}

export function createController({
  flightState,
  services,
  parts,
  layer,
  resolveAsset,
}) {
  function _abortActiveUpdates() {
    for (const controller of flightState.feed._activeUpdateControllers)
      controller.abort();
    flightState.feed._activeUpdateControllers.clear();
  }

  function _flightQuery(viewer) {
    const cameraCartographic = viewer?.camera?.positionCartographic;
    if (!cameraCartographic) return {};
    const anchor = flightViewAnchor(viewer, cameraCartographic);
    const policy = flightViewportPolicy(cameraCartographic.height);
    return {
      latitude: Cesium.Math.toDegrees(anchor.latitude),
      longitude: Cesium.Math.toDegrees(anchor.longitude),
      radiusKm: policy.radiusKm,
      maxRows: policy.maxRows,
      trackedId: flightState._trackedIcao || null,
    };
  }
  return { _abortActiveUpdates, _flightQuery };
}
