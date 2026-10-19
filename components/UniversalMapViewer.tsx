'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { TilesRenderer, WGS84_ELLIPSOID, GlobeControls } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins';
import { zipSync, strToU8 } from 'fflate';

export type MapProvider = 'esri-satellite' | 'carto-dark' | 'osm' | 'google-3d';

interface LocationTarget {
  id: string;
  name: string;
  icon: string;
  lat: number;
  lon: number;
  zoom: number;
  pitch: number;
  bearing: number;
  altitude: number; // for 3D Three.js
  camAltitude: number; // for 3D Three.js
  description: string;
}

const PRESET_LOCATIONS: Record<string, LocationTarget> = {
  bsd: {
    id: 'bsd',
    name: 'BSD City',
    icon: '📍',
    lat: -6.3016,
    lon: 106.6534,
    zoom: 15.5,
    pitch: 58,
    bearing: -20,
    altitude: 45,
    camAltitude: 2500,
    description: 'Kawasan Mandiri BSD City, Tangerang Selatan',
  },
  monas: {
    id: 'monas',
    name: 'Monas Jakarta',
    icon: '🏛️',
    lat: -6.1754,
    lon: 106.8272,
    zoom: 15.8,
    pitch: 62,
    bearing: 45,
    altitude: 35,
    camAltitude: 2200,
    description: 'Monumen Nasional & Gedung Pencakar Langit Jakarta',
  },
  soetta: {
    id: 'soetta',
    name: 'Bandara Soetta',
    icon: '✈️',
    lat: -6.1256,
    lon: 106.6558,
    zoom: 14.5,
    pitch: 50,
    bearing: 60,
    altitude: 30,
    camAltitude: 3000,
    description: 'Bandara Internasional Soekarno-Hatta (CGK)',
  },
};

// ——— Highlight stroke boundary per lokasi ([lon, lat]) ———
const AREA_BOUNDARIES: Record<string, [number, number][]> = {
  bsd: [
    [106.6300, -6.2860],
    [106.6560, -6.2830],
    [106.6740, -6.2900],
    [106.6790, -6.3020],
    [106.6700, -6.3150],
    [106.6480, -6.3190],
    [106.6310, -6.3120],
    [106.6250, -6.2980],
  ],
  monas: [
    [106.8040, -6.1620],
    [106.8330, -6.1640],
    [106.8420, -6.1760],
    [106.8330, -6.1880],
    [106.8080, -6.1870],
    [106.7990, -6.1750],
  ],
  soetta: [
    [106.6550, -6.1000],
    [106.6900, -6.1080],
    [106.7010, -6.1230],
    [106.6880, -6.1460],
    [106.6560, -6.1500],
    [106.6420, -6.1280],
    [106.6430, -6.1100],
  ],
};

const AREA_COLORS: Record<string, string> = {
  bsd: '#ff6b00',
  monas: '#ff3366',
  soetta: '#00bfff',
};

const HIGHLIGHT_LAYER_IDS = [
  'area-highlight-fill',
  'area-highlight-glow',
  'area-highlight-line',
];

// ——— Custom Drawn Areas (draw di peta, export ke KML/KMZ) ———
interface CustomArea {
  id: string;
  name: string;
  color: string; // hex #rrggbb
  coords: [number, number][]; // [lon, lat]
}

const CUSTOM_AREAS_STORAGE_KEY = 'spindonesia.customAreas';

const AREA_COLOR_PALETTE: string[] = [
  '#22c55e', // emerald
  '#ff3366', // pink-red
  '#00bfff', // sky
  '#a855f7', // purple
  '#eab308', // yellow
  '#ff6b00', // orange
];

// KML warna memakai format aabbggrr (alpha dulu, lalu BGR terbalik dari #rrggbb)
function hexToKmlColor(hex: string, alpha = 0xff): string {
  const clean = hex.replace('#', '');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  const a = alpha.toString(16).padStart(2, '0');
  return `${a}${b}${g}${r}`;
}

function buildCustomAreasKml(areas: CustomArea[]): string {
  const placemarks = areas
    .map((area) => {
      const ring = area.coords
        .map(([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)},0`)
        .join(' ');
      return `    <Placemark>
      <name>${area.name.replace(/[<>&]/g, '')}</name>
      <Style>
        <LineStyle><color>${hexToKmlColor(area.color)}</color><width>4</width></LineStyle>
        <PolyStyle><color>${hexToKmlColor(area.color, 0x55)}</color><fill>1</fill><outline>1</outline></PolyStyle>
      </Style>
      <Polygon>
        <tessellate>1</tessellate>
        <outerBoundaryIs>
          <LinearRing><coordinates>${ring}</coordinates></LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Spindonesia Tiles — Custom Highlights</name>
${placemarks}
  </Document>
</kml>`;
}

function downloadBlob(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCustomAreasKml(areas: CustomArea[]) {
  if (!areas.length) return;
  const kml = buildCustomAreasKml(areas);
  downloadBlob(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), 'spindonesia-highlights.kml');
}

function exportCustomAreasKmz(areas: CustomArea[]) {
  if (!areas.length) return;
  const kml = buildCustomAreasKml(areas);
  const zipped = zipSync({ 'doc.kml': strToU8(kml) });
  downloadBlob(new Blob([zipped as unknown as BlobPart], { type: 'application/vnd.google-earth.kmz' }), 'spindonesia-highlights.kmz');
}

const PROVIDERS = [
  {
    id: 'esri-satellite' as MapProvider,
    name: 'Esri Satellite (ArcGIS)',
    badge: 'Super Fast • Foto Asli',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    icon: '🛰️',
    description: 'Citra satelit resolusi tinggi asli (hingga level atap rumah & jalan). 100% Gratis, instan tanpa kuota Google.',
  },
  {
    id: 'carto-dark' as MapProvider,
    name: 'Dark Canvas (Vektor)',
    badge: 'Clean UI • No Key',
    badgeColor: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    icon: '🌃',
    description: 'Peta bertema dark slate modern beresolusi tinggi tanpa watermark. Sangat jernih untuk analisa spasial.',
  },
  {
    id: 'osm' as MapProvider,
    name: 'OpenStreetMap',
    badge: 'Open Source',
    badgeColor: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    icon: '🌍',
    description: 'Peta jalan komunitas global dengan detail jaringan transportasi dan fasilitas umum.',
  },
];

export interface RoutePoint {
  name: string;
  lat: number;
  lon: number;
  category?: string;
}

export const SEARCH_SUGGESTIONS: RoutePoint[] = [
  { name: 'BSD City (Sentra)', lat: -6.3016, lon: 106.6534, category: 'Kawasan' },
  { name: 'AEON Mall BSD', lat: -6.3045, lon: 106.6437, category: 'Pusat Belanja' },
  { name: 'ICE BSD (Convention)', lat: -6.3006, lon: 106.6375, category: 'Exhibition' },
  { name: 'The Breeze BSD', lat: -6.3019, lon: 106.6539, category: 'Lifestyle' },
  { name: 'Green Office Park (GOP 9)', lat: -6.3025, lon: 106.6521, category: 'Perkantoran' },
  { name: 'QBig BSD City', lat: -6.2872, lon: 106.6277, category: 'Belanja' },
  { name: 'Monas Jakarta', lat: -6.1754, lon: 106.8272, category: 'Landmark' },
  { name: 'Bandara Soekarno-Hatta (CGK)', lat: -6.1256, lon: 106.6558, category: 'Bandara' },
  { name: 'Gelora Bung Karno (GBK)', lat: -6.2185, lon: 106.8018, category: 'Stadion' },
  { name: 'Bundaran HI Jakarta', lat: -6.1950, lon: 106.8230, category: 'Pusat Kota' },
  { name: 'Pantai Indah Kapuk (PIK)', lat: -6.1118, lon: 106.7410, category: 'Kawasan' },
  { name: 'Summarecon Mall Serpong', lat: -6.2415, lon: 106.6285, category: 'Mall' },
  { name: 'Bintaro Jaya Xchange', lat: -6.2847, lon: 106.7262, category: 'Mall' },
  { name: 'Stasiun Gambir', lat: -6.1767, lon: 106.8307, category: 'Transportasi' },
  { name: 'Stasiun MRT Lebak Bulus', lat: -6.2891, lon: 106.7745, category: 'Transportasi' },
];

// Helper: Haversine distance in km
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper: Generate smooth arc fallback curve between 2 points
function generateFallbackCurve(
  start: [number, number],
  end: [number, number],
  segments = 45
): [number, number][] {
  const [lon1, lat1] = start;
  const [lon2, lat2] = end;
  const midLon = (lon1 + lon2) / 2;
  const midLat = (lat1 + lat2) / 2;
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  // Perpendicular curvature offset
  const offsetScale = 0.12;
  const ctrlLon = midLon - dy * offsetScale;
  const ctrlLat = midLat + dx * offsetScale;

  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Quadratic bezier
    const lon = (1 - t) * (1 - t) * lon1 + 2 * (1 - t) * t * ctrlLon + t * t * lon2;
    const lat = (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * ctrlLat + t * t * lat2;
    points.push([parseFloat(lon.toFixed(6)), parseFloat(lat.toFixed(6))]);
  }
  return points;
}

// Helper: Get coordinate at progress [0, 1] along polyline
function getInterpolatedPoint(coords: [number, number][], progress: number): [number, number] | null {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  const pClamped = Math.max(0, Math.min(1, progress));

  let totalDist = 0;
  const dists: number[] = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    totalDist += Math.hypot(dx, dy);
    dists.push(totalDist);
  }

  if (totalDist === 0) return coords[0];
  const targetDist = pClamped * totalDist;

  for (let i = 0; i < dists.length - 1; i++) {
    if (targetDist >= dists[i] && targetDist <= dists[i + 1]) {
      const segLen = dists[i + 1] - dists[i];
      const segT = segLen === 0 ? 0 : (targetDist - dists[i]) / segLen;
      const lon = coords[i][0] + (coords[i + 1][0] - coords[i][0]) * segT;
      const lat = coords[i][1] + (coords[i + 1][1] - coords[i][1]) * segT;
      return [lon, lat];
    }
  }

  return coords[coords.length - 1];
}

// Helper: Calculate cumulative distances along coordinates for high-speed trail extraction
function getRouteDistances(coords: [number, number][]): { dists: number[]; total: number } {
  const dists: number[] = [0];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    total += Math.hypot(dx, dy);
    dists.push(total);
  }
  return { dists, total };
}

function getInterpolatedPointWithDists(
  coords: [number, number][],
  dists: number[],
  total: number,
  progress: number
): [number, number] | null {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1 || total === 0) return coords[0];
  const target = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 0; i < dists.length - 1; i++) {
    if (target >= dists[i] && target <= dists[i + 1]) {
      const segLen = dists[i + 1] - dists[i];
      const t = segLen === 0 ? 0 : (target - dists[i]) / segLen;
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
      ];
    }
  }
  return coords[coords.length - 1];
}

// Helper: Extract sub-polyline for trail effect behind moving beacon
function getRouteTrailSegment(
  coords: [number, number][],
  dists: number[],
  total: number,
  pStart: number,
  pEnd: number
): [number, number][] {
  if (!coords || coords.length < 2 || total === 0) return [];
  const startPt = getInterpolatedPointWithDists(coords, dists, total, pStart);
  const endPt = getInterpolatedPointWithDists(coords, dists, total, pEnd);
  if (!startPt || !endPt) return [];

  const sub: [number, number][] = [startPt];
  const targetStart = pStart * total;
  const targetEnd = pEnd * total;

  for (let i = 0; i < coords.length; i++) {
    if (dists[i] > targetStart && dists[i] < targetEnd) {
      sub.push(coords[i]);
    }
  }
  sub.push(endPt);
  return sub;
}

function getCartesian(lat: number, lon: number, altitude = 0): THREE.Vector3 {
  const target = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(
    THREE.MathUtils.degToRad(lat),
    THREE.MathUtils.degToRad(lon),
    altitude,
    target
  );
  return target;
}

function getEnuAxes(lat: number, lon: number) {
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  WGS84_ELLIPSOID.getEastNorthUpAxes(
    THREE.MathUtils.degToRad(lat),
    THREE.MathUtils.degToRad(lon),
    east,
    north,
    up
  );
  return { east, north, up };
}

// Boundary tube disabled to remove orange highlight borders
function buildBoundaryTube(..._args: any[]): THREE.Group {
  return new THREE.Group();
}

export default function UniversalMapViewer() {
  const [provider, setProvider] = useState<MapProvider>('esri-satellite');
  const [activeLoc, setActiveLoc] = useState<string>('bsd');
  const [is3DMode, setIs3DMode] = useState<boolean>(true);
  const [showCompareModal, setShowCompareModal] = useState<boolean>(false);
  const [googleKey, setGoogleKey] = useState<string>(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  );
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [tempKeyInput, setTempKeyInput] = useState<string>('');
  const [isAutoRotate, setIsAutoRotate] = useState<boolean>(false);
  const [showHighlight, setShowHighlight] = useState<boolean>(true);

  // ——— CUSTOM DRAWN AREAS (draw di peta + export KML/KMZ) ———
  const [customAreas, setCustomAreas] = useState<CustomArea[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(CUSTOM_AREAS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as CustomArea[]) : [];
    } catch {
      return [];
    }
  });
  const [isDrawingArea, setIsDrawingArea] = useState<boolean>(false);
  const [draftCoords, setDraftCoords] = useState<[number, number][]>([]);
  const [draftName, setDraftName] = useState<string>('Kawasan Baru');
  const [draftColor, setDraftColor] = useState<string>(AREA_COLOR_PALETTE[0]);
  const isDrawingAreaRef = useRef<boolean>(false);
  const draftCoordsRef = useRef<[number, number][]>([]);
  const customAreasRef = useRef<CustomArea[]>(customAreas);
  const finishAreaDrawingRef = useRef<() => void>(() => {});
  const updateDraftAreaSourceRef = useRef<(coords: [number, number][]) => void>(() => {});

  // Refs for animation loop (MapLibre auto-rotate & highlight visibility)
  const isAutoRotateRef = useRef<boolean>(false);
  const showHighlightRef = useRef<boolean>(true);
  const isMapInteractingRef = useRef<boolean>(false);

  // Telemetry state
  const [telemetry, setTelemetry] = useState<{
    lat: number;
    lon: number;
    zoom: number;
    pitch: number;
    bearing: number;
  }>({
    lat: PRESET_LOCATIONS.bsd.lat,
    lon: PRESET_LOCATIONS.bsd.lon,
    zoom: PRESET_LOCATIONS.bsd.zoom,
    pitch: PRESET_LOCATIONS.bsd.pitch,
    bearing: PRESET_LOCATIONS.bsd.bearing,
  });

  // MapLibre container & instance
  const maplibreContainerRef = useRef<HTMLDivElement>(null);
  const maplibreInstanceRef = useRef<any>(null);

  // Keep refs in sync with state (read inside animation loops)
  useEffect(() => {
    isAutoRotateRef.current = isAutoRotate;
  }, [isAutoRotate]);

  useEffect(() => {
    showHighlightRef.current = showHighlight;
  }, [showHighlight]);

  // Sync refs & cursor & doubleClickZoom untuk mode drawing area
  useEffect(() => {
    isDrawingAreaRef.current = isDrawingArea;
    try {
      const map = maplibreInstanceRef.current;
      if (map) {
        const canvas = map.getCanvas();
        if (canvas) canvas.style.cursor = isDrawingArea ? 'crosshair' : '';
        if (isDrawingArea) map.doubleClickZoom.disable();
        else map.doubleClickZoom.enable();
      }
    } catch {
      // ignore
    }
  }, [isDrawingArea]);

  // Persist custom areas ke localStorage
  useEffect(() => {
    customAreasRef.current = customAreas;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CUSTOM_AREAS_STORAGE_KEY, JSON.stringify(customAreas));
    } catch {
      // storage penuh / private mode — abaikan
    }
    // Update layer data di map yang sudah jalan (tanpa re-init)
    try {
      const map = maplibreInstanceRef.current;
      const source = map?.getSource?.('custom-area-source');
      if (source) {
        source.setData({
          type: 'FeatureCollection',
          features: customAreas.map((a) => ({
            type: 'Feature',
            properties: { color: a.color, name: a.name },
            geometry: { type: 'Polygon', coordinates: [[...a.coords, a.coords[0]]] },
          })),
        });
      }
    } catch {
      // map belum ter-init — abaikan, init effect membaca customAreasRef
    }
  }, [customAreas]);

  // Three.js container & instance for Google 3D Tiles
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const threeCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const threeControlsRef = useRef<GlobeControls | null>(null);
  const threeLookAtRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const threeHighlightGroupRef = useRef<THREE.Group | null>(null);
  const activeLocRef = useRef<string>('bsd');
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const threeHighlightGroupsRef = useRef<Record<string, THREE.Group>>({});

  // ——— ROUTE PLANNING & PATH STATE ———
  const [pointA, setPointA] = useState<RoutePoint | null>({
    name: 'BSD City',
    lat: PRESET_LOCATIONS.bsd.lat,
    lon: PRESET_LOCATIONS.bsd.lon,
    category: 'Kawasan',
  });
  const [pointB, setPointB] = useState<RoutePoint | null>(null);
  const [searchA, setSearchA] = useState<string>('BSD City');
  const [searchB, setSearchB] = useState<string>('');
  const [isPickingPoint, setIsPickingPoint] = useState<'A' | 'B' | null>(null);
  const [isRoutePanelOpen, setIsRoutePanelOpen] = useState<boolean>(true);
  const [showSuggestionsA, setShowSuggestionsA] = useState<boolean>(false);
  const [showSuggestionsB, setShowSuggestionsB] = useState<boolean>(false);
  const [isSearchingRoute, setIsSearchingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<{
    coords: [number, number][];
    distanceKm: number;
    durationMin: number;
  } | null>(null);

  // Refs for route & picking inside map handlers & animation loops
  const pickingPointRef = useRef<'A' | 'B' | null>(null);
  const activeRouteCoordsRef = useRef<[number, number][] | null>(null);
  const cachedRouteDistancesRef = useRef<{ coords: [number, number][]; dists: number[]; total: number } | null>(null);
  const maplibreglRef = useRef<any>(null);
  const markerARef = useRef<any>(null);
  const markerBRef = useRef<any>(null);
  const tracerMarkerRef = useRef<any>(null);
  const routeTracerProgressRef = useRef<number>(0);
  const isRouteFullyDrawnRef = useRef<boolean>(false);

  // Sync picking ref with state and update canvas cursor
  useEffect(() => {
    pickingPointRef.current = isPickingPoint;
    if (maplibreInstanceRef.current) {
      try {
        const canvas = maplibreInstanceRef.current.getCanvas();
        if (canvas) canvas.style.cursor = isPickingPoint ? 'crosshair' : '';
      } catch (e) {
        // ignore
      }
    }
  }, [isPickingPoint]);

  // Update HTML markers on map for Point A and Point B
  const updateMarkers = useCallback((map: any, maplibregl: any, pA: RoutePoint | null, pB: RoutePoint | null) => {
    if (!map || !maplibregl) return;

    if (markerARef.current) {
      markerARef.current.remove();
      markerARef.current = null;
    }
    if (pA) {
      const el = document.createElement('div');
      el.className = 'group relative flex flex-col items-center cursor-pointer pointer-events-auto select-none';
      el.innerHTML = `
        <div class="px-2.5 py-1 rounded-full bg-emerald-500/90 text-white font-bold text-[11px] shadow-lg shadow-emerald-500/40 border border-white/60 flex items-center gap-1.5 backdrop-blur-md">
          <span class="w-4 h-4 rounded-full bg-white text-emerald-700 flex items-center justify-center text-[10px] font-black">A</span>
          <span class="max-w-[120px] truncate text-[11px]">${pA.name}</span>
        </div>
        <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-md animate-ping mt-0.5"></div>
      `;
      markerARef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([pA.lon, pA.lat])
        .addTo(map);
    }

    if (markerBRef.current) {
      markerBRef.current.remove();
      markerBRef.current = null;
    }
    if (pB) {
      const el = document.createElement('div');
      el.className = 'group relative flex flex-col items-center cursor-pointer pointer-events-auto select-none';
      el.innerHTML = `
        <div class="px-2.5 py-1 rounded-full bg-orange-500/90 text-white font-bold text-[11px] shadow-lg shadow-orange-500/40 border border-white/60 flex items-center gap-1.5 backdrop-blur-md">
          <span class="w-4 h-4 rounded-full bg-white text-orange-700 flex items-center justify-center text-[10px] font-black">B</span>
          <span class="max-w-[120px] truncate text-[11px]">${pB.name}</span>
        </div>
        <div class="w-2.5 h-2.5 rounded-full bg-orange-400 border border-white shadow-md animate-ping mt-0.5"></div>
      `;
      markerBRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([pB.lon, pB.lat])
        .addTo(map);
    }
  }, []);

  // Fit camera bounds so both A, B, and the entire path are clearly visible
  const fitRouteBounds = useCallback((coords: [number, number][]) => {
    if (!maplibreInstanceRef.current || coords.length === 0) return;
    const map = maplibreInstanceRef.current;
    let minLon = coords[0][0];
    let maxLon = coords[0][0];
    let minLat = coords[0][1];
    let maxLat = coords[0][1];
    for (const [lon, lat] of coords) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      {
        padding: { top: 130, bottom: 120, left: 390, right: 100 },
        duration: 2500,
        pitch: is3DMode ? 42 : 0,
        essential: true,
      }
    );
  }, [is3DMode]);

  // Smooth path reveal / drawing animation (0 to 100% of line)
  // Set path geometry and trigger tracer flow
  const animateRouteDraw = useCallback((coords: [number, number][]) => {
    if (!maplibreInstanceRef.current || coords.length < 2) return;
    const map = maplibreInstanceRef.current;
    routeTracerProgressRef.current = 0;
    cachedRouteDistancesRef.current = null;
    isRouteFullyDrawnRef.current = true;

    const pathSource = map.getSource('route-path-source');
    console.log('ANIMATE_ROUTE_DRAW:', !!pathSource, coords.length);
    if (pathSource) {
      pathSource.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: coords,
            },
          },
        ],
      });
    }
  }, []);

  // Calculate route using OSRM with bezier fallback, fit bounds, and trigger animation
  const calculateAndApplyRoute = useCallback(async (start: RoutePoint, end: RoutePoint) => {
    setIsSearchingRoute(true);
    setRouteError(null);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      let coords: [number, number][];
      let distanceKm: number;
      let durationMin: number;

      if (data.routes && data.routes.length > 0) {
        coords = data.routes[0].geometry.coordinates;
        distanceKm = parseFloat((data.routes[0].distance / 1000).toFixed(1));
        durationMin = Math.max(1, Math.round(data.routes[0].duration / 60));
      } else {
        coords = generateFallbackCurve([start.lon, start.lat], [end.lon, end.lat]);
        distanceKm = parseFloat(calculateDistanceKm(start.lat, start.lon, end.lat, end.lon).toFixed(1));
        durationMin = Math.max(1, Math.round(distanceKm * 1.5));
      }

      setRouteData({ coords, distanceKm, durationMin });
      activeRouteCoordsRef.current = coords;

      if (maplibreInstanceRef.current && maplibreglRef.current) {
        updateMarkers(maplibreInstanceRef.current, maplibreglRef.current, start, end);
        fitRouteBounds(coords);
        animateRouteDraw(coords);
      }
    } catch (err: any) {
      console.warn('OSRM error, using curve fallback:', err);
      const coords = generateFallbackCurve([start.lon, start.lat], [end.lon, end.lat]);
      const distanceKm = parseFloat(calculateDistanceKm(start.lat, start.lon, end.lat, end.lon).toFixed(1));
      const durationMin = Math.max(1, Math.round(distanceKm * 1.5));

      setRouteData({ coords, distanceKm, durationMin });
      activeRouteCoordsRef.current = coords;

      if (maplibreInstanceRef.current && maplibreglRef.current) {
        updateMarkers(maplibreInstanceRef.current, maplibreglRef.current, start, end);
        fitRouteBounds(coords);
        animateRouteDraw(coords);
      }
    } finally {
      setIsSearchingRoute(false);
    }
  }, [updateMarkers, fitRouteBounds, animateRouteDraw]);

  // Clear current active route
  const clearRoute = useCallback(() => {
    setRouteData(null);
    activeRouteCoordsRef.current = null;
    cachedRouteDistancesRef.current = null;
    isRouteFullyDrawnRef.current = false;
    routeTracerProgressRef.current = 0;
    setPointB(null);
    setSearchB('');
    const map = maplibreInstanceRef.current;
    if (map) {
      const pathSource = map.getSource('route-path-source');
      if (pathSource) {
        pathSource.setData({
          type: 'FeatureCollection',
          features: [],
        });
      }
      const tracerSource = map.getSource('route-tracer-source');
      if (tracerSource) {
        tracerSource.setData({
          type: 'FeatureCollection',
          features: [],
        });
      }
      const trailSource = map.getSource('route-trail-source');
      if (trailSource) {
        trailSource.setData({
          type: 'FeatureCollection',
          features: [],
        });
      }
    }
    if (markerBRef.current) {
      markerBRef.current.remove();
      markerBRef.current = null;
    }
    if (tracerMarkerRef.current) {
      tracerMarkerRef.current.remove();
      tracerMarkerRef.current = null;
    }
  }, []);

  // Swap Point A and Point B
  const swapPoints = useCallback(() => {
    if (!pointA && !pointB) return;
    const oldA = pointA;
    const oldB = pointB;
    setPointA(oldB);
    setSearchA(oldB ? oldB.name : '');
    setPointB(oldA);
    setSearchB(oldA ? oldA.name : '');
    if (oldA && oldB) {
      calculateAndApplyRoute(oldB, oldA);
    }
  }, [pointA, pointB, calculateAndApplyRoute]);

  // Initialize MapLibre GL for Esri, Carto, and OSM
  useEffect(() => {
    if (provider === 'google-3d') return;
    if (!maplibreContainerRef.current) return;

    let isMounted = true;
    let map: any = null;
    let pulseAnimationId: number | null = null;
    let highlightAnimationId: number | null = null;
    let mapAutoRotateId: number | null = null;

    import('maplibre-gl').then((maplibregl) => {
      if (!isMounted || !maplibreContainerRef.current) return;
      maplibreglRef.current = maplibregl;

      // Select tile sources based on chosen provider with atmospheric sky & fog
      let styleConfig: any = {
        version: 8,
        sources: {},
        layers: [],
      };

      if (provider === 'esri-satellite') {
        styleConfig = {
          version: 8,
          sources: {
            'esri-satellite': {
              type: 'raster',
              tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              ],
              tileSize: 256,
              attribution: 'Esri World Imagery',
              maxzoom: 19,
            },
          },
          sky: {
            'sky-color': '#060914',
            'horizon-color': '#111a30',
            'fog-color': '#0a1020',
            'fog-ground-blend': 0.65,
            'horizon-fog-blend': 0.8,
            'sky-horizon-blend': 0.85,
            'atmosphere-blend': 0.9,
          },
          layers: [
            {
              id: 'esri-satellite-layer',
              type: 'raster',
              source: 'esri-satellite',
              paint: { 'raster-opacity': 1 },
            },
          ],
        };
      } else if (provider === 'carto-dark') {
        styleConfig = {
          version: 8,
          sources: {
            'carto-dark': {
              type: 'raster',
              tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
              ],
              tileSize: 256,
              attribution: 'Esri World Dark Gray Canvas',
              maxzoom: 16,
            },
          },
          sky: {
            'sky-color': '#060914',
            'horizon-color': '#0d1326',
            'fog-color': '#080d1a',
            'fog-ground-blend': 0.65,
            'horizon-fog-blend': 0.8,
            'sky-horizon-blend': 0.85,
            'atmosphere-blend': 0.9,
          },
          layers: [
            {
              id: 'carto-dark-layer',
              type: 'raster',
              source: 'carto-dark',
              paint: { 'raster-opacity': 1 },
            },
          ],
        };
      } else {
        // OpenStreetMap Standard
        styleConfig = {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: [
                'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
              ],
              tileSize: 256,
              attribution: '&copy; OpenStreetMap contributors',
              maxzoom: 19,
            },
          },
          sky: {
            'sky-color': '#75b5fe',
            'horizon-color': '#c2e0ff',
            'fog-color': '#b0d5fc',
            'fog-ground-blend': 0.65,
            'horizon-fog-blend': 0.8,
            'sky-horizon-blend': 0.85,
            'atmosphere-blend': 0.9,
          },
          layers: [
            {
              id: 'osm-layer',
              type: 'raster',
              source: 'osm',
              paint: { 'raster-opacity': 1 },
            },
          ],
        };
      }

      const loc = PRESET_LOCATIONS[activeLoc] || PRESET_LOCATIONS.bsd;

      map = new maplibregl.Map({
        container: maplibreContainerRef.current,
        style: styleConfig,
        center: [loc.lon, loc.lat],
        zoom: loc.zoom,
        pitch: is3DMode ? Math.min(loc.pitch, 65) : 0,
        bearing: loc.bearing,
        maxPitch: 72, // Clamped to 72° to prevent inverted/wrapped world tiles in the horizon
        attributionControl: false,
      });

      maplibreInstanceRef.current = map;
      (window as any)._map = map;

      const updateTelemetry = () => {
        if (!map) return;
        const center = map.getCenter();
        setTelemetry({
          lat: parseFloat(center.lat.toFixed(5)),
          lon: parseFloat(center.lng.toFixed(5)),
          zoom: parseFloat(map.getZoom().toFixed(2)),
          pitch: Math.round(map.getPitch()),
          bearing: Math.round(map.getBearing()),
        });
      };

      map.on('move', updateTelemetry);
      map.on('zoom', updateTelemetry);
      map.on('pitch', updateTelemetry);
      map.on('rotate', updateTelemetry);

      // Add 3D navigation control (compass)
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

      // ——— LOCATION GLOW MARKERS (Clean markers per location) ———

      map.on('load', () => {
        try {
          if (provider === 'esri-satellite' || provider === 'carto-dark') {
            map.setSky({
              'sky-color': '#060914',
              'horizon-color': '#111a30',
              'fog-color': '#0a1020',
              'fog-ground-blend': 0.65,
              'horizon-fog-blend': 0.8,
              'sky-horizon-blend': 0.85,
              'atmosphere-blend': 0.9,
            });
          }
        } catch (e) {
          // ignore
        }

        // GeoJSON source for location markers
        const locationFeatures = Object.values(PRESET_LOCATIONS).map((loc) => ({
          type: 'Feature' as const,
          properties: {
            id: loc.id,
            name: loc.name,
            color: loc.id === 'bsd' ? '#ff6b00'
              : loc.id === 'monas' ? '#ff3366'
              : '#00bfff', // soetta
            glowColor: loc.id === 'bsd' ? '#ff8c00'
              : loc.id === 'monas' ? '#ff1a53'
              : '#00aaff', // soetta
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [loc.lon, loc.lat],
          },
        }));

        map.addSource('location-markers', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: locationFeatures,
          },
        });

        // Outermost glow ring (large blur, low opacity)
        map.addLayer({
          id: 'location-glow-outer',
          type: 'circle',
          source: 'location-markers',
          paint: {
            'circle-radius': 42,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.10,
            'circle-blur': 1.2,
            'circle-stroke-width': 0,
          },
        });

        // Mid glow ring
        map.addLayer({
          id: 'location-glow-mid',
          type: 'circle',
          source: 'location-markers',
          paint: {
            'circle-radius': 26,
            'circle-color': ['get', 'glowColor'],
            'circle-opacity': 0.22,
            'circle-blur': 0.8,
            'circle-stroke-width': 0,
          },
        });

        // Inner solid ring (the stroke itself)
        map.addLayer({
          id: 'location-ring',
          type: 'circle',
          source: 'location-markers',
          paint: {
            'circle-radius': 16,
            'circle-color': 'transparent',
            'circle-opacity': 0,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 2.5,
            'circle-stroke-opacity': 0.9,
          },
        });

        // Core dot
        map.addLayer({
          id: 'location-core',
          type: 'circle',
          source: 'location-markers',
          paint: {
            'circle-radius': 5,
            'circle-color': ['get', 'color'],
            'circle-opacity': 1,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        });

        // Animated pulse ring — expands and fades out
        const pulseLayers: { id: string; baseRadius: number }[] = [
          { id: 'location-pulse-a', baseRadius: 16 },
          { id: 'location-pulse-b', baseRadius: 16 },
        ];

        pulseLayers.forEach(({ id }, i) => {
          map.addLayer({
            id,
            type: 'circle',
            source: 'location-markers',
            paint: {
              'circle-radius': 16,
              'circle-color': 'transparent',
              'circle-opacity': 0,
              'circle-stroke-color': ['get', 'color'],
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.7,
            },
          });
        });

        // Animate pulse ring, slow auto-rotate, and route trail beacon every frame
        let tick = 0;
        const animate = () => {
          pulseAnimationId = requestAnimationFrame(animate);
          tick += 0.022;

          const progressA = tick % 1;
          const progressB = (tick + 0.5) % 1;

          const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
          const rA = 16 + easeOut(progressA) * 32;
          const opA = (1 - progressA) * 0.65;
          const rB = 16 + easeOut(progressB) * 32;
          const opB = (1 - progressB) * 0.65;

          if (map.getLayer('location-pulse-a')) {
            map.setPaintProperty('location-pulse-a', 'circle-radius', rA);
            map.setPaintProperty('location-pulse-a', 'circle-stroke-opacity', opA);
          }
          if (map.getLayer('location-pulse-b')) {
            map.setPaintProperty('location-pulse-b', 'circle-radius', rB);
            map.setPaintProperty('location-pulse-b', 'circle-stroke-opacity', opB);
          }

          // Pulse glow untuk custom drawn areas
          const areaPulse = 0.5 + 0.5 * Math.sin(tick * 1.4);
          if (map.getLayer('custom-area-glow')) {
            map.setPaintProperty('custom-area-glow', 'line-width', 8 + areaPulse * 8);
            map.setPaintProperty('custom-area-glow', 'line-opacity', 0.2 + areaPulse * 0.3);
          }
          if (map.getLayer('custom-area-line')) {
            map.setPaintProperty('custom-area-line', 'line-width', 2 + areaPulse * 1.5);
          }

          // Slow, smooth cinematic auto-rotate (spin di-pelanin ~1.8 deg/detik)
          if (isAutoRotateRef.current && !isMapInteractingRef.current && map) {
            map.setBearing(map.getBearing() + 0.03);
          }

          // Animate route tracer beacon marker & glowing comet trail along polyline at 60fps
          if (activeRouteCoordsRef.current && activeRouteCoordsRef.current.length > 1 && maplibreglRef.current && map) {
            routeTracerProgressRef.current = (routeTracerProgressRef.current + 0.0016) % 1;
            const pEnd = routeTracerProgressRef.current;
            const trailSpan = 0.14; // 14% trail length
            const pStart = Math.max(0, pEnd - trailSpan);

            if (!cachedRouteDistancesRef.current || cachedRouteDistancesRef.current.coords !== activeRouteCoordsRef.current) {
              const { dists, total } = getRouteDistances(activeRouteCoordsRef.current);
              cachedRouteDistancesRef.current = { coords: activeRouteCoordsRef.current, dists, total };
            }

            const { dists, total } = cachedRouteDistancesRef.current;
            const trailCoords = getRouteTrailSegment(activeRouteCoordsRef.current, dists, total, pStart, pEnd);
            const headPoint = trailCoords.length > 0 ? trailCoords[trailCoords.length - 1] : null;

            // Update trail GeoJSON source with lineMetrics gradient
            const trailSource = map.getSource('route-trail-source');
            if (trailSource && trailCoords.length >= 2) {
              trailSource.setData({
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                      type: 'LineString',
                      coordinates: trailCoords,
                    },
                  },
                ],
              });
            }

            // Update moving head beacon marker with glowing trail head style
            if (headPoint) {
              if (!tracerMarkerRef.current) {
                const el = document.createElement('div');
                el.className = 'pointer-events-none select-none';
                el.innerHTML = `
                  <div class="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2">
                    <div class="w-10 h-10 rounded-full bg-amber-400/35 animate-ping absolute"></div>
                    <div class="w-7 h-7 rounded-full bg-orange-500/40 blur-[2px] absolute"></div>
                    <div class="w-4 h-4 rounded-full bg-gradient-to-tr from-amber-300 via-orange-500 to-yellow-100 shadow-xl shadow-orange-500 border-2 border-white flex items-center justify-center">
                      <div class="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_#ffffff]"></div>
                    </div>
                  </div>
                `;
                tracerMarkerRef.current = new maplibreglRef.current.Marker({ element: el, anchor: 'center' })
                  .setLngLat(headPoint)
                  .addTo(map);
              } else {
                tracerMarkerRef.current.setLngLat(headPoint);
              }
            }
          }
        };

        animate();

        // ——— ROUTE PATH & ANIMATED TRAIL LAYERS ———
        map.addSource('route-path-source', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: activeRouteCoordsRef.current && activeRouteCoordsRef.current.length > 1
              ? [
                  {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                      type: 'LineString',
                      coordinates: activeRouteCoordsRef.current,
                    },
                  },
                ]
              : [],
          },
        });

        // Trail source with lineMetrics for smooth gradient fading comet tail
        map.addSource('route-trail-source', {
          type: 'geojson',
          lineMetrics: true,
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });

        map.addSource('route-tracer-source', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });

        // 1. Base route line casing (subtle track glow)
        map.addLayer({
          id: 'route-casing-glow',
          type: 'line',
          source: 'route-path-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ff7700',
            'line-width': 10,
            'line-blur': 4,
            'line-opacity': 0.25,
          },
        });

        // 2. Base route highway stroke (underlying path)
        map.addLayer({
          id: 'route-line-main',
          type: 'line',
          source: 'route-path-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ff8800',
            'line-width': 4.5,
            'line-opacity': 0.45,
          },
        });

        // 3. Base route subtle inner core
        map.addLayer({
          id: 'route-line-core',
          type: 'line',
          source: 'route-path-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ffe6cc',
            'line-width': 1.5,
            'line-opacity': 0.6,
          },
        });

        // 4. Moving Trail outer glow casing (blurred gradient comet tail)
        map.addLayer({
          id: 'route-trail-glow',
          type: 'line',
          source: 'route-trail-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-width': 14,
            'line-blur': 5,
            'line-opacity': 0.95,
            'line-gradient': [
              'interpolate',
              ['linear'],
              ['line-progress'],
              0, 'rgba(255, 100, 0, 0)',
              0.3, 'rgba(255, 130, 0, 0.35)',
              0.7, 'rgba(255, 180, 0, 0.8)',
              1, 'rgba(255, 240, 180, 1.0)',
            ],
          },
        });

        // 5. Moving Trail intense laser core (sharp gradient into white-hot head)
        map.addLayer({
          id: 'route-trail-core',
          type: 'line',
          source: 'route-trail-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-width': 5.5,
            'line-opacity': 1.0,
            'line-gradient': [
              'interpolate',
              ['linear'],
              ['line-progress'],
              0, 'rgba(255, 120, 0, 0)',
              0.25, 'rgba(255, 150, 0, 0.45)',
              0.65, 'rgba(255, 210, 50, 0.9)',
              0.95, 'rgba(255, 255, 255, 1.0)',
              1, 'rgba(255, 255, 255, 1.0)',
            ],
          },
        });

        // ——— CUSTOM DRAWN AREAS SOURCE & LAYERS ———
        map.addSource('custom-area-source', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: customAreasRef.current.map((a) => ({
              type: 'Feature',
              properties: { color: a.color, name: a.name },
              geometry: { type: 'Polygon', coordinates: [[...a.coords, a.coords[0]]] },
            })),
          },
        });
        map.addLayer({
          id: 'custom-area-fill',
          type: 'fill',
          source: 'custom-area-source',
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.18,
          },
        });
        map.addLayer({
          id: 'custom-area-glow',
          type: 'line',
          source: 'custom-area-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 10,
            'line-blur': 6,
            'line-opacity': 0.4,
          },
        });
        map.addLayer({
          id: 'custom-area-line',
          type: 'line',
          source: 'custom-area-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2.5,
            'line-opacity': 0.95,
          },
        });

        // ——— DRAFT AREA SOURCE & LAYERS (polygon yang sedang digambar) ———
        map.addSource('draft-area-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'draft-area-vertices',
          type: 'circle',
          source: 'draft-area-source',
          filter: ['==', ['get', 'kind'], 'vertex'],
          paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 2.5,
          },
        });
        map.addLayer({
          id: 'draft-area-line',
          type: 'line',
          source: 'draft-area-source',
          filter: ['==', ['get', 'kind'], 'polyline'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2.5,
            'line-dasharray': [2, 1.5],
            'line-opacity': 0.9,
          },
        });

        // Re-sync markers if points already exist
        updateMarkers(map, maplibregl, pointA, pointB);

        // ——— MAP CLICK LISTENER FOR AREA DRAWING & POINT PICKING ———
        map.on('click', (e: any) => {
          // Prioritas 1: tambah vertex polygon yang sedang digambar
          if (isDrawingAreaRef.current) {
            const vertex: [number, number] = [
              parseFloat(e.lngLat.lng.toFixed(7)),
              parseFloat(e.lngLat.lat.toFixed(7)),
            ];
            draftCoordsRef.current = [...draftCoordsRef.current, vertex];
            setDraftCoords(draftCoordsRef.current);
            updateDraftAreaSourceRef.current(draftCoordsRef.current);
            return;
          }
          // Prioritas 2: pilih titik rute A/B
          if (!pickingPointRef.current) return;
          const currentPick = pickingPointRef.current;
          const targetPt: RoutePoint = {
            name: `Titik ${currentPick} (${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)})`,
            lat: parseFloat(e.lngLat.lat.toFixed(5)),
            lon: parseFloat(e.lngLat.lng.toFixed(5)),
          };

          if (currentPick === 'A') {
            setPointA(targetPt);
            setSearchA(targetPt.name);
            setIsPickingPoint(null);
            pickingPointRef.current = null;
            if (pointB) {
              calculateAndApplyRoute(targetPt, pointB);
            } else {
              updateMarkers(map, maplibregl, targetPt, null);
            }
          } else if (currentPick === 'B') {
            setPointB(targetPt);
            setSearchB(targetPt.name);
            setIsPickingPoint(null);
            pickingPointRef.current = null;
            if (pointA) {
              calculateAndApplyRoute(pointA, targetPt);
            } else {
              updateMarkers(map, maplibregl, pointA, targetPt);
            }
          }
        });

        // Selesaikan drawing area dengan double-click
        map.on('dblclick', (e: any) => {
          if (!isDrawingAreaRef.current) return;
          e.preventDefault();
          finishAreaDrawingRef.current();
        });

        // Detect user interaction to pause auto-rotate
        map.on('dragstart', () => { isMapInteractingRef.current = true; });
        map.on('dragend', () => { isMapInteractingRef.current = false; });
        map.on('zoomstart', () => { isMapInteractingRef.current = true; });
        map.on('zoomend', () => { isMapInteractingRef.current = false; });
      });
    });

    return () => {
      isMounted = false;
      if (pulseAnimationId !== null) cancelAnimationFrame(pulseAnimationId);
      if (map) {
        map.remove();
        maplibreInstanceRef.current = null;
      }
    };
  }, [provider]);

  // Update 3D highlight group visibility when active location changes (Google 3D mode)
  useEffect(() => {
    activeLocRef.current = activeLoc;
    const groups = threeHighlightGroupsRef.current;
    for (const [id, g] of Object.entries(groups)) {
      g.visible = id === activeLoc && showHighlightRef.current;
    }
  }, [activeLoc]);

  // ——— CUSTOM AREA DRAWING HELPERS ———
  const updateDraftAreaSource = (coords: [number, number][]) => {
    try {
      const map = maplibreInstanceRef.current;
      const source = map?.getSource?.('draft-area-source');
      if (!source) return;
      const features: any[] = [];
      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { kind: 'polyline', color: draftColor },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
      coords.forEach(([lon, lat]) => {
        features.push({
          type: 'Feature',
          properties: { kind: 'vertex', color: draftColor },
          geometry: { type: 'Point', coordinates: [lon, lat] },
        });
      });
      source.setData({ type: 'FeatureCollection', features });
    } catch {
      // ignore
    }
  };

  const startAreaDrawing = () => {
    if (provider === 'google-3d') return; // fase 1: hanya MapLibre
    draftCoordsRef.current = [];
    setDraftCoords([]);
    setIsDrawingArea(true);
    isDrawingAreaRef.current = true;
  };

  const undoLastVertex = () => {
    draftCoordsRef.current = draftCoordsRef.current.slice(0, -1);
    setDraftCoords(draftCoordsRef.current);
    updateDraftAreaSource(draftCoordsRef.current);
  };

  const cancelAreaDrawing = () => {
    draftCoordsRef.current = [];
    setDraftCoords([]);
    updateDraftAreaSource([]);
    setIsDrawingArea(false);
    isDrawingAreaRef.current = false;
  };

  const finishAreaDrawing = () => {
    const coords = draftCoordsRef.current;
    if (coords.length < 3) return; // minimal 3 titik untuk polygon
    const area: CustomArea = {
      id: `area-${Date.now().toString(36)}`,
      name: draftName.trim() || `Area ${customAreas.length + 1}`,
      color: draftColor,
      coords,
    };
    setCustomAreas((prev) => [...prev, area]);
    draftCoordsRef.current = [];
    setDraftCoords([]);
    updateDraftAreaSource([]);
    setIsDrawingArea(false);
    isDrawingAreaRef.current = false;
  };
  // Ref agar handler map (terdaftar sekali saat map init) selalu memanggil versi terbaru
  useEffect(() => {
    finishAreaDrawingRef.current = finishAreaDrawing;
    updateDraftAreaSourceRef.current = updateDraftAreaSource;
  });

  const removeCustomArea = (id: string) => {
    setCustomAreas((prev) => prev.filter((a) => a.id !== id));
  };

  // Handle Location Fly-To for MapLibre
  const flyToLocation = (locKey: string) => {
    setActiveLoc(locKey);
    const loc = PRESET_LOCATIONS[locKey];
    if (!loc) return;

    if (provider !== 'google-3d' && maplibreInstanceRef.current) {
      maplibreInstanceRef.current.flyTo({
        center: [loc.lon, loc.lat],
        zoom: loc.zoom,
        pitch: is3DMode ? loc.pitch : 0,
        bearing: loc.bearing,
        duration: 2500,
        essential: true,
      });
    } else if (threeCameraRef.current) {
      // Three.js camera fly
      const targetPos = getCartesian(loc.lat, loc.lon, loc.altitude);
      const axes = getEnuAxes(loc.lat, loc.lon);
      threeCameraRef.current.position
        .copy(targetPos)
        .addScaledVector(axes.up, loc.camAltitude)
        .addScaledVector(axes.north, -loc.camAltitude * 1.2);
      threeCameraRef.current.up.copy(axes.up);
      threeCameraRef.current.lookAt(targetPos);
      threeLookAtRef.current.copy(targetPos);
    }
  };

  // Toggle 3D Perspective Pitch
  const toggle3DPitch = () => {
    const nextMode = !is3DMode;
    setIs3DMode(nextMode);
    if (maplibreInstanceRef.current) {
      maplibreInstanceRef.current.easeTo({
        pitch: nextMode ? 60 : 0,
        duration: 1000,
      });
    }
  };

  // Zoom Helpers
  const handleMapZoom = (dir: 'in' | 'out') => {
    if (provider !== 'google-3d' && maplibreInstanceRef.current) {
      const currentZoom = maplibreInstanceRef.current.getZoom();
      maplibreInstanceRef.current.easeTo({
        zoom: dir === 'in' ? currentZoom + 1 : currentZoom - 1,
        duration: 400,
      });
    } else if (threeCameraRef.current) {
      const camera = threeCameraRef.current;
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const dist = camera.position.distanceTo(threeLookAtRef.current);
      const move = dir === 'in' ? dist * 0.35 : -dist * 0.45;
      camera.position.addScaledVector(forward, move);
    }
  };

  // Reset Bearing to North
  const resetBearing = () => {
    if (maplibreInstanceRef.current) {
      maplibreInstanceRef.current.easeTo({ bearing: 0, duration: 800 });
    }
  };

  // Initialize Three.js Google 3D Tiles if selected
  useEffect(() => {
    if (provider !== 'google-3d') return;
    if (!threeContainerRef.current) return;
    if (!googleKey) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060914);

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      20000000
    );
    threeCameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    threeContainerRef.current.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(1, 2, 1).normalize();
    scene.add(sunLight);

    // Google 3D Tiles without Earth Sphere
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: googleKey, autoRefreshToken: true }));
    scene.add(tiles.group);

    const controls = new GlobeControls(scene, camera, renderer.domElement);
    controls.setEllipsoid(tiles.ellipsoid, tiles.group);
    controls.nearMargin = 0.05;
    controls.farMargin = 0.8;
    controls.minDistance = 10;
    controls.maxDistance = 25000000;
    threeControlsRef.current = controls;

    // Set initial BSD camera
    const loc = PRESET_LOCATIONS.bsd;
    const pBsd = getCartesian(loc.lat, loc.lon, loc.altitude);
    const axes = getEnuAxes(loc.lat, loc.lon);
    camera.position
      .copy(pBsd)
      .addScaledVector(axes.up, loc.camAltitude)
      .addScaledVector(axes.north, -loc.camAltitude * 1.2);
    camera.up.copy(axes.up);
    camera.lookAt(pBsd);
    threeLookAtRef.current.copy(pBsd);

    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);

    // ——— Highlight stroke boundary 3D (satu per lokasi, tampilkan aktif saja) ———
    const highlightGroups: Record<string, THREE.Group> = {};
    for (const loc of Object.values(PRESET_LOCATIONS)) {
      const g = buildBoundaryTube(loc.lat, loc.lon, AREA_BOUNDARIES[loc.id], AREA_COLORS[loc.id] || '#ff6b00');
      g.visible = loc.id === 'bsd' && showHighlightRef.current;
      g.userData.locId = loc.id;
      scene.add(g);
      highlightGroups[loc.id] = g;
    }
    threeHighlightGroupRef.current = highlightGroups[activeLoc] || null;
    threeHighlightGroupsRef.current = highlightGroups;
    threeSceneRef.current = scene;

    let animId: number;
    let lastFrame = performance.now();
    let orbitPauseUntil = 0;
    const onUserDragStart = () => { orbitPauseUntil = performance.now() + 2500; };
    renderer.domElement.addEventListener('pointerdown', onUserDragStart);
    renderer.domElement.addEventListener('wheel', onUserDragStart, { passive: true });

    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      const now = performance.now();
      const dt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;

      // Auto-rotate: orbit kamera mengelilingi titik lookAt secara perlahan & sinematik
      if (isAutoRotateRef.current && now > orbitPauseUntil) {
        const loc = PRESET_LOCATIONS[activeLocRef.current] || PRESET_LOCATIONS.bsd;
        const { up } = getEnuAxes(loc.lat, loc.lon);
        const offset = camera.position.clone().sub(threeLookAtRef.current);
        offset.applyAxisAngle(up, dt * 0.025);
        camera.position.copy(threeLookAtRef.current).add(offset);
        camera.up.copy(up);
        camera.lookAt(threeLookAtRef.current);
      }

      controls.update();
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();
      renderer.render(scene, camera);
    };
    renderLoop();

    const onResize = () => {
      if (!threeContainerRef.current) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      tiles.setResolutionFromRenderer(camera, renderer);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onUserDragStart);
      renderer.domElement.removeEventListener('wheel', onUserDragStart);
      threeHighlightGroupsRef.current = {};
      controls.dispose();
      tiles.dispose();
      renderer.dispose();
      if (threeContainerRef.current && renderer.domElement) {
        threeContainerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [provider, googleKey]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#060914] text-white font-sans select-none">
      {/* 1. Map Canvas Views */}
      {provider !== 'google-3d' ? (
        <div ref={maplibreContainerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      ) : (
        <div ref={threeContainerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      )}

      {/* 2. Top Header Bar: Provider Switcher & Comparison */}
      <header className="absolute top-4 left-4 right-4 z-30 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {/* Brand & Active Target Badge */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-[#0b1022]/85 backdrop-blur-xl border border-white/10 shadow-2xl pointer-events-auto">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-sm tracking-tighter text-white shadow-lg shadow-cyan-500/25">
            ST
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-white">Spindonesia Tiles</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/25">
                Live Tiles
              </span>
              <Link
                href="/esri-3d"
                className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-300 border border-purple-500/25 hover:bg-purple-500/25 hover:text-purple-200 transition-colors"
                title="Bandingkan dengan engine Esri SceneView + Google 3D Tiles"
              >
                Esri 3D
              </Link>
              <Link
                href="/cesium"
                className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 hover:text-amber-200 transition-colors"
                title="Showcase CesiumJS + Google 3D Tiles (pole pins, radius rings, clouds, draw KMZ)"
              >
                Cesium 3D
              </Link>
            </div>
            <p className="text-[11px] text-white/50 leading-tight">
              {PRESET_LOCATIONS[activeLoc]?.name} • {PRESET_LOCATIONS[activeLoc]?.description}
            </p>
          </div>
        </div>

        {/* Multi-Provider Switcher Tabs */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-[#0b1022]/85 backdrop-blur-xl border border-white/10 shadow-2xl pointer-events-auto">
          {PROVIDERS.map((p) => {
            const isActive = provider === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/30 ring-1 ring-white/20'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
                title={p.description}
              >
                <span>{p.name}</span>
                <span className={`hidden md:inline-block text-[10px] px-1.5 py-0.2 rounded border ${p.badgeColor}`}>
                  {p.badge.split('•')[0].trim()}
                </span>
              </button>
            );
          })}

          {/* Comparison Table Button */}
          <button
            onClick={() => setShowCompareModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-cyan-300 border border-cyan-400/30 transition-all ml-1 shadow-md hover:scale-105"
            title="Bandingkan Provider Peta"
          >
            Bandingkan Provider
          </button>
        </div>
      </header>

      {/* Picking Point Top Alert Banner */}
      {isPickingPoint && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-2xl bg-amber-500/90 text-black font-semibold text-xs shadow-2xl shadow-amber-500/40 backdrop-blur-md animate-pulse pointer-events-auto">
          <span>Klik sembarang titik di peta untuk menentukan Titik {isPickingPoint}</span>
          <button
            onClick={() => setIsPickingPoint(null)}
            className="px-2.5 py-1 rounded-lg bg-black/20 hover:bg-black/30 text-black font-bold text-[11px] transition-all"
          >
            Batal
          </button>
        </div>
      )}

      {/* Floating Route Planning Panel (Point A to Point B) */}
      <div className="absolute top-20 left-4 z-30 w-80 md:w-96 pointer-events-auto">
        <div className="rounded-2xl bg-[#0b1022]/90 backdrop-blur-xl border border-white/10 shadow-2xl p-4 text-white space-y-3.5">
          {/* Header Row */}
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">Rute Alur Jalan</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-orange-500/15 text-orange-400 border border-orange-500/30">
                A ke B
              </span>
            </div>
            <button
              onClick={() => setIsRoutePanelOpen(!isRoutePanelOpen)}
              className="text-[11px] px-2 py-0.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 hover:text-white transition-all font-semibold"
            >
              {isRoutePanelOpen ? 'Tutup' : 'Buka'}
            </button>
          </div>

          {isRoutePanelOpen && (
            <div className="space-y-3 text-xs">
              {/* Input Point A */}
              <div className="relative space-y-1">
                <div className="flex items-center justify-between text-[11px] text-white/60">
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Titik A (Asal)
                  </span>
                  <button
                    onClick={() => {
                      setIsPickingPoint('A');
                      setShowSuggestionsA(false);
                      setShowSuggestionsB(false);
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${
                      isPickingPoint === 'A'
                        ? 'bg-emerald-500 text-white border-emerald-400'
                        : 'bg-white/5 hover:bg-white/10 text-white/70 border-white/10'
                    }`}
                  >
                    {isPickingPoint === 'A' ? 'Klik di Peta...' : 'Pilih di Peta'}
                  </button>
                </div>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={searchA}
                    onChange={(e) => {
                      setSearchA(e.target.value);
                      setShowSuggestionsA(true);
                      setShowSuggestionsB(false);
                    }}
                    onFocus={() => {
                      setShowSuggestionsA(true);
                      setShowSuggestionsB(false);
                    }}
                    placeholder="Ketik lokasi asal (misal: BSD, Monas)..."
                    className="w-full px-3 py-2 pr-8 rounded-xl bg-black/40 border border-white/15 text-xs text-white placeholder-white/40 outline-none focus:border-cyan-400 transition-all font-sans"
                  />
                  {searchA && (
                    <button
                      onClick={() => {
                        setSearchA('');
                        setPointA(null);
                      }}
                      className="absolute right-2.5 text-white/40 hover:text-white text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Suggestions Dropdown for A */}
                {showSuggestionsA && (
                  <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl bg-[#0e1630] border border-cyan-500/30 shadow-2xl z-50 divide-y divide-white/5">
                    {SEARCH_SUGGESTIONS.filter((s) =>
                      s.name.toLowerCase().includes(searchA.toLowerCase())
                    ).map((s) => (
                      <button
                        key={s.name}
                        onClick={() => {
                          setPointA(s);
                          setSearchA(s.name);
                          setShowSuggestionsA(false);
                          if (pointB) calculateAndApplyRoute(s, pointB);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-cyan-500/10 flex items-center justify-between text-xs transition-colors"
                      >
                        <span className="font-medium text-white">{s.name}</span>
                        <span className="text-[10px] text-white/40 px-1.5 py-0.5 rounded bg-white/5">
                          {s.category}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Swap Button */}
              <div className="flex justify-center -my-1">
                <button
                  onClick={swapPoints}
                  className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[10px] font-semibold text-cyan-300 border border-cyan-500/20 transition-all hover:scale-105 active:scale-95"
                  title="Tukar Titik A dan B"
                >
                  Tukar A - B
                </button>
              </div>

              {/* Input Point B */}
              <div className="relative space-y-1">
                <div className="flex items-center justify-between text-[11px] text-white/60">
                  <span className="flex items-center gap-1.5 font-semibold text-orange-400">
                    <span className="w-2 h-2 rounded-full bg-orange-400"></span> Titik B (Tujuan)
                  </span>
                  <button
                    onClick={() => {
                      setIsPickingPoint('B');
                      setShowSuggestionsA(false);
                      setShowSuggestionsB(false);
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${
                      isPickingPoint === 'B'
                        ? 'bg-orange-500 text-white border-orange-400'
                        : 'bg-white/5 hover:bg-white/10 text-white/70 border-white/10'
                    }`}
                  >
                    {isPickingPoint === 'B' ? 'Klik di Peta...' : 'Pilih di Peta'}
                  </button>
                </div>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={searchB}
                    onChange={(e) => {
                      setSearchB(e.target.value);
                      setShowSuggestionsB(true);
                      setShowSuggestionsA(false);
                    }}
                    onFocus={() => {
                      setShowSuggestionsB(true);
                      setShowSuggestionsA(false);
                    }}
                    placeholder="Ketik lokasi tujuan (misal: Monas, Soetta)..."
                    className="w-full px-3 py-2 pr-8 rounded-xl bg-black/40 border border-white/15 text-xs text-white placeholder-white/40 outline-none focus:border-orange-400 transition-all font-sans"
                  />
                  {searchB && (
                    <button
                      onClick={() => {
                        setSearchB('');
                        setPointB(null);
                      }}
                      className="absolute right-2.5 text-white/40 hover:text-white text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Suggestions Dropdown for B */}
                {showSuggestionsB && (
                  <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl bg-[#0e1630] border border-orange-500/30 shadow-2xl z-50 divide-y divide-white/5">
                    {SEARCH_SUGGESTIONS.filter((s) =>
                      s.name.toLowerCase().includes(searchB.toLowerCase())
                    ).map((s) => (
                      <button
                        key={s.name}
                        onClick={() => {
                          setPointB(s);
                          setSearchB(s.name);
                          setShowSuggestionsB(false);
                          if (pointA) calculateAndApplyRoute(pointA, s);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-orange-500/10 flex items-center justify-between text-xs transition-colors"
                      >
                        <span className="font-medium text-white">{s.name}</span>
                        <span className="text-[10px] text-white/40 px-1.5 py-0.5 rounded bg-white/5">
                          {s.category}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Preset Chips */}
              <div className="pt-1">
                <span className="text-[10px] text-white/40 block mb-1.5 font-medium">Rekomendasi Rute:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'BSD ke Monas', start: 'BSD City (Sentra)', end: 'Monas Jakarta' },
                    { label: 'BSD ke Soetta', start: 'BSD City (Sentra)', end: 'Bandara Soekarno-Hatta (CGK)' },
                    { label: 'BSD ke AEON', start: 'BSD City (Sentra)', end: 'AEON Mall BSD' },
                    { label: 'BSD ke ICE', start: 'BSD City (Sentra)', end: 'ICE BSD (Convention)' },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      onClick={() => {
                        const s = SEARCH_SUGGESTIONS.find((p) => p.name === chip.start);
                        const e = SEARCH_SUGGESTIONS.find((p) => p.name === chip.end);
                        if (s && e) {
                          setPointA(s);
                          setSearchA(s.name);
                          setPointB(e);
                          setSearchB(e.name);
                          calculateAndApplyRoute(s, e);
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/5 text-[10px] font-medium transition-all"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit / Trigger Button */}
              <button
                onClick={() => {
                  if (pointA && pointB) {
                    calculateAndApplyRoute(pointA, pointB);
                  }
                }}
                disabled={!pointA || !pointB || isSearchingRoute}
                className={`w-full py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
                  pointA && pointB && !isSearchingRoute
                    ? 'bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 text-white shadow-lg shadow-orange-500/25 hover:brightness-110 active:scale-[0.98]'
                    : 'bg-white/10 text-white/40 cursor-not-allowed'
                }`}
              >
                {isSearchingRoute ? 'Menghitung Alur Jalan...' : 'Buat Rute & Animasi'}
              </button>

              {/* Active Route Telemetry & Controls */}
              {routeData && (
                <div className="pt-2 border-t border-white/10 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
                    <div>
                      <span className="text-[10px] text-white/50 block">Jarak Tempuh</span>
                      <span className="text-sm font-bold text-orange-400">{routeData.distanceKm} km</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/50 block">Estimasi Waktu</span>
                      <span className="text-sm font-bold text-amber-300">~{routeData.durationMin} menit</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => fitRouteBounds(routeData.coords)}
                      className="flex-1 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 text-[11px] font-semibold transition-all"
                    >
                      Zoom Out Rute
                    </button>
                    <button
                      onClick={() => animateRouteDraw(routeData.coords)}
                      className="flex-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 hover:text-white border border-white/15 text-[11px] font-semibold transition-all"
                    >
                      Putar Ulang
                    </button>
                    <button
                      onClick={clearRoute}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold transition-all"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Bottom Quick Navigation: Preset Location Selector */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 p-1.5 rounded-2xl bg-[#0b1022]/90 backdrop-blur-xl border border-white/10 shadow-2xl">
        <span className="text-[11px] text-white/40 font-medium px-2.5 hidden sm:inline-block">
          Jelajah:
        </span>
        {Object.values(PRESET_LOCATIONS).map((loc) => {
          const isActive = activeLoc === loc.id;
          return (
            <button
              key={loc.id}
              onClick={() => flyToLocation(loc.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 ring-1 ring-cyan-400/40'
                  : 'text-white/75 hover:text-white hover:bg-white/5'
              }`}
            >
              {loc.name}
            </button>
          );
        })}
      </div>

      {/* 3b. Custom Area Drawing Panel (muncul saat mode gambar aktif) */}
      {isDrawingArea && (
        <div className="absolute top-1/2 right-24 -translate-y-1/2 z-30 w-64 p-4 rounded-2xl bg-[#0b1022]/95 backdrop-blur-xl border border-purple-500/30 shadow-2xl shadow-purple-500/20 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-300">✏️ Gambar Area</span>
            <button
              onClick={cancelAreaDrawing}
              className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold flex items-center justify-center"
              title="Batalkan"
            >
              ✕
            </button>
          </div>

          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Nama area..."
            className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-purple-400/50"
          />

          <div className="flex items-center gap-1.5">
            {AREA_COLOR_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setDraftColor(c);
                  updateDraftAreaSource(draftCoordsRef.current);
                }}
                className={`w-6 h-6 rounded-full border-2 transition-all ${draftColor === c ? 'border-white scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>

          <div className="text-[10px] text-white/50 font-mono">
            Titik: {draftCoords.length} (min. 3) • Klik peta untuk menambah • Klik 2x / tombol ✅ untuk selesai
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={undoLastVertex}
              disabled={!draftCoords.length}
              className="flex-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 text-[11px] font-semibold border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ↩ Undo
            </button>
            <button
              onClick={finishAreaDrawing}
              disabled={draftCoords.length < 3}
              className="flex-1 py-1.5 rounded-lg bg-purple-500/25 hover:bg-purple-500/40 text-purple-300 text-[11px] font-semibold border border-purple-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✅ Selesai
            </button>
          </div>
        </div>
      )}

      {/* 3c. Custom Areas List + KML/KMZ Export */}
      {customAreas.length > 0 && !isDrawingArea && (
        <div className="absolute top-1/2 right-24 -translate-y-1/2 z-30 w-60 p-3.5 rounded-2xl bg-[#0b1022]/95 backdrop-blur-xl border border-white/10 shadow-2xl space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white/80">🗂️ Area Custom ({customAreas.length})</span>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
            {customAreas.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                <span className="flex-1 text-[11px] text-white/80 truncate" title={a.name}>
                  {a.name}
                </span>
                <span className="text-[9px] font-mono text-white/30 shrink-0">{a.coords.length} pt</span>
                <button
                  onClick={() => removeCustomArea(a.id)}
                  className="w-5 h-5 rounded-md bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 text-[10px] font-bold flex items-center justify-center shrink-0"
                  title="Hapus area"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => exportCustomAreasKml(customAreas)}
              className="flex-1 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold"
              title="Download .kml (bisa dibuka di Google Earth, QGIS, dst)"
            >
              ⬇ KML
            </button>
            <button
              onClick={() => exportCustomAreasKmz(customAreas)}
              className="flex-1 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 text-[11px] font-semibold"
              title="Download .kmz (KML ter-zip, standar Google Earth)"
            >
              ⬇ KMZ
            </button>
          </div>
        </div>
      )}

      {/* 4. Right Side Floating Zoom & View Controls */}
      <div className="absolute right-5 bottom-24 z-30 flex flex-col gap-2">
        {/* Auto Rotate Toggle (Pelan & Halus) */}
        <button
          onClick={() => setIsAutoRotate(!isAutoRotate)}
          className={`w-11 h-11 rounded-2xl border backdrop-blur-xl flex items-center justify-center text-xs font-bold shadow-2xl transition-all duration-150 active:scale-95 ${
            isAutoRotate
              ? 'bg-gradient-to-b from-emerald-500 to-teal-600 text-white border-emerald-400/50 shadow-emerald-500/30'
              : 'bg-[#0b1022]/85 text-white/70 border-white/10 hover:text-white hover:bg-white/10'
          }`}
          title={isAutoRotate ? 'Matikan Auto-Rotate' : 'Putar Lambat Otomatis Kamera Mengelilingi Area'}
        >
          <span className="text-[10px] leading-none">Spin</span>
        </button>

        {/* Custom Area Draw Toggle */}
        <button
          onClick={() => (isDrawingArea ? cancelAreaDrawing() : startAreaDrawing())}
          disabled={provider === 'google-3d'}
          className={`w-11 h-11 rounded-2xl border backdrop-blur-xl flex items-center justify-center shadow-2xl transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
            isDrawingArea
              ? 'bg-gradient-to-b from-purple-500 to-fuchsia-600 text-white border-purple-400/50 shadow-purple-500/30'
              : 'bg-[#0b1022]/85 text-white/70 border-white/10 hover:text-white hover:bg-white/10'
          }`}
          title={
            provider === 'google-3d'
              ? 'Gambar area hanya tersedia di provider 2D/2.5D'
              : isDrawingArea
                ? 'Batal Mode Gambar Area'
                : 'Gambar Area Custom (Klik Peta Untuk Menandai Titik)'
          }
        >
          <span className="text-sm leading-none">✏️</span>
        </button>

        {/* Zoom In */}
        <button
          onClick={() => handleMapZoom('in')}
          className="w-11 h-11 rounded-2xl bg-[#0b1022]/85 hover:bg-cyan-500/20 text-white hover:text-cyan-400 border border-white/10 hover:border-cyan-500/40 backdrop-blur-xl flex items-center justify-center text-xl font-bold shadow-2xl transition-all duration-150 active:scale-95"
          title="Zoom In (Dekat)"
        >
          +
        </button>

        {/* Zoom Out */}
        <button
          onClick={() => handleMapZoom('out')}
          className="w-11 h-11 rounded-2xl bg-[#0b1022]/85 hover:bg-cyan-500/20 text-white hover:text-cyan-400 border border-white/10 hover:border-cyan-500/40 backdrop-blur-xl flex items-center justify-center text-xl font-bold shadow-2xl transition-all duration-150 active:scale-95"
          title="Zoom Out (Jauh)"
        >
          −
        </button>

        {/* 3D Perspective Tilt Toggle */}
        <button
          onClick={toggle3DPitch}
          className={`w-11 h-11 rounded-2xl border backdrop-blur-xl flex flex-col items-center justify-center text-xs font-bold shadow-2xl transition-all duration-150 active:scale-95 ${
            is3DMode
              ? 'bg-gradient-to-b from-cyan-500 to-blue-600 text-white border-cyan-400/50 shadow-cyan-500/30'
              : 'bg-[#0b1022]/85 text-white/70 border-white/10 hover:text-white hover:bg-white/10'
          }`}
          title="Toggle Perspektif 3D / 2D Top-Down"
        >
          <span className="text-[10px] leading-none">3D</span>
          <span className="text-[8px] font-mono opacity-80">{is3DMode ? 'ON' : '2D'}</span>
        </button>

        {/* Reset Compass to North */}
        <button
          onClick={resetBearing}
          className="w-11 h-11 rounded-2xl bg-[#0b1022]/85 hover:bg-white/15 text-white/80 hover:text-white border border-white/10 backdrop-blur-xl flex items-center justify-center text-xs font-bold shadow-2xl transition-all duration-150 active:scale-95"
          title="Reset Arah Utara (North)"
        >
          <span className="text-xs font-mono font-bold">N</span>
        </button>

        {/* API Key settings for Google 3D */}
        {provider === 'google-3d' && (
          <button
            onClick={() => setShowKeyModal(true)}
            className="w-11 h-11 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/40 backdrop-blur-xl flex items-center justify-center text-xs font-bold shadow-2xl transition-all duration-150 active:scale-95"
            title="Ganti Google API Key"
          >
            <span className="text-[10px] font-mono">Key</span>
          </button>
        )}
      </div>

      {/* 5. Left Bottom Telemetry & Navigation Guide */}
      <div className="absolute left-5 bottom-6 z-30 hidden md:flex flex-col gap-2 pointer-events-none">
        {/* Telemetry Card */}
        <div className="px-3.5 py-2.5 rounded-2xl bg-[#0b1022]/80 backdrop-blur-xl border border-white/10 shadow-2xl text-[11px] font-mono text-white/70 space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-white/40">Provider:</span>
            <span className="text-cyan-400 font-bold">{PROVIDERS.find((p) => p.id === provider)?.name}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-white/40">Koordinat:</span>
            <span>
              {telemetry.lat}°, {telemetry.lon}°
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-white/40">Zoom / Pitch:</span>
            <span>
              Lvl {telemetry.zoom} • {telemetry.pitch}°
            </span>
          </div>
        </div>

        {/* Interaction Guide */}
        <div className="px-3 py-1.5 rounded-xl bg-black/40 backdrop-blur-md border border-white/5 text-[10px] text-white/50">
          💡 <span className="text-white/70 font-semibold">Scroll Mouse:</span> Zoom In/Out |{' '}
          <span className="text-white/70 font-semibold">Klik Kanan + Tarik:</span> Miringkan 3D
        </div>
      </div>

      {/* 6. Comparison Modal: Provider Breakdown & Specifications */}
      {showCompareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[#0c1228] border border-cyan-500/30 shadow-2xl shadow-cyan-500/10 p-6 md:p-8">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚖️</span>
                <div>
                  <h2 className="text-lg md:text-xl font-bold text-white">
                    Perbandingan Provider Map Tiles Dunia
                  </h2>
                  <p className="text-xs text-white/50">
                    Pilih provider yang paling cocok untuk visual, kecepatan zoom, dan kebutuhan biaya Anda.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCompareModal(false)}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold transition-all"
              >
                ✕
              </button>
            </div>

            {/* Comparison Table */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-3">Provider</th>
                    <th className="py-3 px-3">Tipe Data</th>
                    <th className="py-3 px-3">Kecepatan Zoom</th>
                    <th className="py-3 px-3">Ketajaman / Resolusi</th>
                    <th className="py-3 px-3">Biaya / API Key</th>
                    <th className="py-3 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-white/80">
                  {/* Esri Satellite */}
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="py-3.5 px-3 font-semibold text-white flex items-center gap-2">
                      <span>🛰️</span>
                      <div>
                        <div>Esri World Imagery</div>
                        <span className="text-[10px] text-emerald-400 font-normal">Paling Direkomendasikan</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3">Satelit Resolusi Tinggi Asli</td>
                    <td className="py-3.5 px-3 text-emerald-400 font-semibold">⚡ Instan (&lt;100ms)</td>
                    <td className="py-3.5 px-3">Hingga 30cm/pixel (Atap gedung & mobil sangat jelas)</td>
                    <td className="py-3.5 px-3 text-emerald-400 font-semibold">100% Gratis / Tanpa Key</td>
                    <td className="py-3.5 px-3 text-center">
                      <button
                        onClick={() => {
                          setProvider('esri-satellite');
                          setShowCompareModal(false);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-[11px] font-semibold transition-all"
                      >
                        Pilih Ini
                      </button>
                    </td>
                  </tr>

                  {/* Carto Dark Matter */}
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="py-3.5 px-3 font-semibold text-white flex items-center gap-2">
                      <span>🗺️</span>
                      <div>
                        <div>Carto Dark Matter</div>
                        <span className="text-[10px] text-indigo-400 font-normal">Vektor Modern</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3">Peta Jalan & Blok Gedung Dark</td>
                    <td className="py-3.5 px-3 text-emerald-400 font-semibold">⚡ Instan (&lt;80ms)</td>
                    <td className="py-3.5 px-3">Vektor Tajam di semua resolusi layar</td>
                    <td className="py-3.5 px-3 text-emerald-400 font-semibold">100% Gratis</td>
                    <td className="py-3.5 px-3 text-center">
                      <button
                        onClick={() => {
                          setProvider('carto-dark');
                          setShowCompareModal(false);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 border border-indigo-500/40 text-[11px] font-semibold transition-all"
                      >
                        Pilih Ini
                      </button>
                    </td>
                  </tr>

                  {/* OpenStreetMap */}
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="py-3.5 px-3 font-semibold text-white flex items-center gap-2">
                      <span>🌍</span>
                      <div>
                        <div>OpenStreetMap</div>
                        <span className="text-[10px] text-cyan-400 font-normal">Global Open Data</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3">Kartografi Jalan Komunitas</td>
                    <td className="py-3.5 px-3 text-emerald-400 font-semibold">⚡ Instan (&lt;150ms)</td>
                    <td className="py-3.5 px-3">Lengkap dengan POI, toko, halte, stasiun</td>
                    <td className="py-3.5 px-3 text-emerald-400 font-semibold">100% Gratis / Open</td>
                    <td className="py-3.5 px-3 text-center">
                      <button
                        onClick={() => {
                          setProvider('osm');
                          setShowCompareModal(false);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/40 text-[11px] font-semibold transition-all"
                      >
                        Pilih Ini
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Explanatory Note */}
            <div className="mt-6 p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-200/90 leading-relaxed">
              💡 <strong>Mengapa Esri Satellite Sangat Cepat untuk Zoom?</strong> Esri World Imagery menyajikan
              jutaan tile satelit ter-cache di CDN global secara instan tanpa perlu mengunduh file mesh 3D berat
              (GLB puluhan megabyte) per tile. Anda bisa zoom dari skala dunia langsung ke atap gedung BSD City
              dalam 60fps halus tanpa lag dan tanpa perlu bola bumi buatan!
            </div>
          </div>
        </div>
      )}

      {/* 7. Google API Key Modal */}
      {(showKeyModal || (provider === 'google-3d' && !googleKey)) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl bg-[#0c1228] border border-amber-500/30 p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <span>🔑</span> Atur Google Cloud API Key
            </h3>
            <p className="text-xs text-white/60 mb-4 leading-relaxed">
              Google Photorealistic 3D Tiles membutuhkan API Key dengan izin ke <em>Map Tiles API</em>.
              Default dibaca dari <code className="text-amber-300">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> di{' '}
              <code className="text-amber-300">.env.local</code>.
            </p>
            <input
              type="text"
              placeholder="Masukkan API Key (AIzaSy...)"
              value={tempKeyInput}
              onChange={(e) => setTempKeyInput(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white text-xs font-mono outline-none focus:border-amber-400 mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowKeyModal(false);
                  if (!googleKey) setProvider('esri-satellite');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (tempKeyInput.trim()) {
                    setGoogleKey(tempKeyInput.trim());
                  }
                  setShowKeyModal(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/20"
              >
                Simpan & Muat Ulang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
