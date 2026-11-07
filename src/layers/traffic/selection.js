import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import { isSurfacePick, pickGroundPosition } from '../../data/scenePick.js';
import { FAST_FETCH_ALTITUDE } from './policy.js';

const OVERLAY_SOURCE_ID = 'traffic-flow-inspection';
const accentFor = (current, free, closed) => {
  if (closed) return '#ff2d55';
  const ratio = free > 0 ? current / free : 1;
  return ratio < 0.55 ? '#e05252' : ratio < 0.85 ? '#f0b23e' : '#2ecc71';
};
const duration = (value) =>
  !Number.isFinite(value) ? null : value < 60 ? `${Math.round(value)} s` : `${Math.round(value / 60)} min`;

export function createSelection({ state, services, source }) {
  function clear() {
    state._trafficSelectionAbort?.abort();
    state._trafficSelectionAbort = null;
    state._selectedTrafficCardId = null;
    services.overlays?.clearOverlaySource?.(OVERLAY_SOURCE_ID);
  }
  async function inspect(screenPosition) {
    if (!state._enabled || !state._liveMode || !state._viewer) return;
    const viewer = state._viewer;
    if (!isSurfacePick(viewer.scene.pick(screenPosition))) return;
    const position = pickGroundPosition(viewer, screenPosition);
    if (!position) return;
    const cart = Cesium.Cartographic.fromCartesian(position);
    const latitude = Cesium.Math.toDegrees(cart.latitude);
    const longitude = Cesium.Math.toDegrees(cart.longitude);
    const zoom = (viewer.camera?.positionCartographic?.height || 0) > FAST_FETCH_ALTITUDE ? 12 : 14;
    state._trafficSelectionAbort?.abort();
    const controller = new AbortController();
    state._trafficSelectionAbort = controller;
    try {
      const data = await source.getFlowSegment({ latitude, longitude, zoom }, { signal: controller.signal });
      if (controller.signal.aborted || !state._enabled) return;
      const current = Math.round(data.currentSpeed), free = Math.round(data.freeFlowSpeed);
      const congestion = free > 0 ? Math.max(0, Math.round((1 - Math.min(1, current / free)) * 100)) : null;
      const confidence = Number.isFinite(data.confidence) ? Math.round(Math.max(0, Math.min(1, data.confidence)) * 100) : null;
      const nowTime=duration(data.currentTravelTime), freeTime=duration(data.freeFlowTravelTime);
      const details=[
        data.roadClosure ? 'CIERRE DE VÍA' : `Velocidad actual: ${current} km/h`,
        `Flujo libre: ${free} km/h`,
        congestion == null ? null : `Congestión estimada: ${congestion}%`,
        nowTime && freeTime ? `Tiempo del tramo: ${nowTime} · libre ${freeTime}` : null,
        confidence == null ? null : `Confianza TomTom: ${confidence}%`,
        'Fuente: TomTom Traffic · lectura agregada en vivo',
      ].filter(Boolean);
      const id=`traffic:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
      state._selectedTrafficCardId=id;
      services.overlays?.setOverlayEntries?.(OVERLAY_SOURCE_ID,[{
        id, position, variant:'selected', selected:true, protected:true, paintLane:'selected',
        collisionGroup:'ambient-card', priority:Number.MAX_SAFE_INTEGER,
        title:data.roadClosure ? 'Tráfico real · vía cerrada' : 'Tráfico real · TomTom',
        details, accent:accentFor(data.currentSpeed,data.freeFlowSpeed,data.roadClosure),
        interactive:false, anchorRadiusPx:9, minAnchorGapPx:11, verticalOnly:true,
        placement:'above', edgeFade:'keyhole', horizonCull:true, terrainOcclusion:false,
      }],{visible:true,collisionCapacity:1,maxVisible:1});
      services.render?.governorRequestRender?.('traffic-flow-inspection');
    } catch (error) {
      if (error?.name !== 'AbortError' && !controller.signal.aborted)
        console.warn('[Data:Traffic] Flow inspection failed:', error?.message || error);
    } finally {
      if (state._trafficSelectionAbort === controller) state._trafficSelectionAbort=null;
    }
  }
  const onKeyDown=(event)=>{ if(event.key==='Escape' && state._selectedTrafficCardId) clear(); };
  function install(viewer) {
    if (state._trafficSelectionHandler) return;
    state._trafficSelectionHandler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    state._trafficSelectionHandler.setInputAction((click)=>{ if(isPointerFree()) void inspect(click.position); },Cesium.ScreenSpaceEventType.LEFT_CLICK);
    document.addEventListener('keydown',onKeyDown);
  }
  function remove() {
    if(state._trafficSelectionHandler){ state._trafficSelectionHandler.destroy(); state._trafficSelectionHandler=null; }
    document.removeEventListener('keydown',onKeyDown); clear();
  }
  return { install, remove, clear, inspect };
}
