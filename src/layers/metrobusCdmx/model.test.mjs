import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METROBUS_STATION_MAX_DISTANCE_M,
  normalizeMetrobusNetwork,
} from './model.js';

const fixture = {
  routes: [
    {
      id: 'r1',
      line: '1',
      color: '#D40D0D',
      name: 'Indios Verdes - El Caminero',
      coordinates: [
        [-99.2, 19.4],
        [-99.1, 19.5],
      ],
    },
  ],
  stations: [
    { id: 's1', name: 'Potrero', lines: ['1'], lon: -99.13, lat: 19.47 },
  ],
};

test('normalizes routes, stations and line summary', () => {
  const network = normalizeMetrobusNetwork(fixture);
  assert.equal(network.routes.length, 1);
  assert.equal(network.stations.length, 1);
  assert.deepEqual(network.lines, [
    { id: '1', color: '#D40D0D', routeCount: 1, stationCount: 1 },
  ]);
  assert.equal(network.routes[0].name, 'Indios Verdes - El Caminero');
  assert.deepEqual(network.stations[0].lines, ['1']);
});

test('rejects a dataset without both geometry families', () => {
  assert.throws(
    () => normalizeMetrobusNetwork({ routes: fixture.routes, stations: [] }),
    /needs routes and stations/,
  );
});

test('station LOD keeps the city readable from regional altitude', () => {
  assert.equal(METROBUS_STATION_MAX_DISTANCE_M, 60_000);
});
