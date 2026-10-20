import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../public/data');

function roundCoord(val, precision = 1e6) {
  return Math.round(val * precision) / precision;
}

function cleanCoords(coords, precision = 1e6) {
  if (!Array.isArray(coords)) return [];
  if (typeof coords[0] === 'number') {
    return [roundCoord(coords[0], precision), roundCoord(coords[1], precision)];
  }
  const result = [];
  for (let i = 0; i < coords.length; i++) {
    const item = cleanCoords(coords[i], precision);
    if (result.length > 0 && typeof item[0] === 'number') {
      const prev = result[result.length - 1];
      if (prev[0] === item[0] && prev[1] === item[1]) continue;
    }
    result.push(item);
  }
  return result;
}

function optimizeToll() {
  const file = path.join(dataDir, 'tol.geojson');
  if (!fs.existsSync(file)) return;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const originalSize = fs.statSync(file).size;

  const features = [];
  for (const f of raw.features || []) {
    if (!f || !f.geometry) continue;
    const geomType = f.geometry.type;
    if (geomType !== 'LineString' && geomType !== 'MultiLineString') continue;

    const coords = cleanCoords(f.geometry.coordinates, 1e6);
    if (!coords || coords.length === 0) continue;

    const props = {};
    if (f.properties?.name && typeof f.properties.name === 'string') {
      props.name = f.properties.name.trim();
    }

    features.push({
      type: 'Feature',
      properties: props,
      geometry: {
        type: geomType,
        coordinates: coords,
      },
    });
  }

  const out = { type: 'FeatureCollection', features };
  const json = JSON.stringify(out);
  fs.writeFileSync(file, json, 'utf8');
  const newSize = fs.statSync(file).size;
  console.log(`[tol.geojson] ${(originalSize / 1024).toFixed(1)} KB -> ${(newSize / 1024).toFixed(1)} KB (-${((1 - newSize / originalSize) * 100).toFixed(1)}%)`);
}

function optimizeRailway() {
  const file = path.join(dataDir, 'railway.geojson');
  if (!fs.existsSync(file)) return;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const originalSize = fs.statSync(file).size;

  const features = [];
  for (const f of raw.features || []) {
    if (!f || !f.geometry) continue;
    const geomType = f.geometry.type;
    const isStation = f.properties?.railway === 'station' || f.properties?.public_transport === 'station';

    const coords = cleanCoords(f.geometry.coordinates, 1e6);
    if (!coords || coords.length === 0) continue;

    const props = {};
    if (f.properties?.name && typeof f.properties.name === 'string') {
      props.name = f.properties.name.trim();
    }
    if (isStation) {
      props.railway = 'station';
    }

    features.push({
      type: 'Feature',
      properties: props,
      geometry: {
        type: geomType,
        coordinates: coords,
      },
    });
  }

  const out = { type: 'FeatureCollection', features };
  const json = JSON.stringify(out);
  fs.writeFileSync(file, json, 'utf8');
  const newSize = fs.statSync(file).size;
  console.log(`[railway.geojson] ${(originalSize / 1024).toFixed(1)} KB -> ${(newSize / 1024).toFixed(1)} KB (-${((1 - newSize / originalSize) * 100).toFixed(1)}%)`);
}

console.log('Optimizing GeoJSON data files...');
optimizeToll();
optimizeRailway();
console.log('Done!');
