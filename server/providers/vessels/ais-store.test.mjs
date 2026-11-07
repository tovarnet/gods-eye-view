import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aisRowWithinRadius,
  aisStreamRows,
  ingestAisStreamEnvelope,
} from './ais-store.js';

function position(mmsi, lat, lon) {
  return {
    MessageType: 'PositionReport',
    MetaData: {
      MMSI: mmsi,
      latitude: lat,
      longitude: lon,
      time_utc: new Date().toISOString(),
    },
    Message: {
      PositionReport: {
        UserID: Number(mmsi),
        Sog: 8,
        Cog: 90,
        TrueHeading: 90,
      },
    },
  };
}

test('viewport AIS filtering keeps nearby Hormuz vessels and excludes distant traffic', () => {
  ingestAisStreamEnvelope(position('990000001', 26.57, 56.25));
  ingestAisStreamEnvelope(position('990000002', 26.42, 56.55));
  ingestAisStreamEnvelope(position('990000003', 51.90, 4.48));

  const rows = aisStreamRows(12000, {
    lat: 26.55,
    lon: 56.30,
    radiusKm: 120,
  });

  const ids = new Set(rows.map((row) => row.mmsi));
  assert.equal(ids.has('990000001'), true);
  assert.equal(ids.has('990000002'), true);
  assert.equal(ids.has('990000003'), false);
});

test('AIS radius helper rejects distant rows and accepts nearby rows', () => {
  const area = { lat: 26.55, lon: 56.30, radiusKm: 120 };
  assert.equal(aisRowWithinRadius({ lat: 26.57, lon: 56.25 }, area), true);
  assert.equal(aisRowWithinRadius({ lat: 35.0, lon: 18.0 }, area), false);
});
