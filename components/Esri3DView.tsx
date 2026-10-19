'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const ARCGIS_VERSION = '4.30';
const ARCGIS_JS = `https://js.arcgis.com/${ARCGIS_VERSION}/`;
const ARCGIS_CSS = `https://js.arcgis.com/${ARCGIS_VERSION}/esri/themes/dark/main.css`;

const LOCATIONS = [
  {
    id: 'bsd',
    label: 'Sinar Mas Land BSD',
    icon: '🏢',
    longitude: 106.6527,
    latitude: -6.326,
    z: 1400,
    tilt: 68,
    heading: 10,
  },
  {
    id: 'soetta',
    label: 'Bandara Soetta',
    icon: '✈️',
    longitude: 106.6558,
    latitude: -6.165,
    z: 2200,
    tilt: 68,
    heading: 15,
  },
  {
    id: 'monas',
    label: 'Monas Jakarta',
    icon: '🏛️',
    longitude: 106.8272,
    latitude: -6.215,
    z: 1600,
    tilt: 70,
    heading: 355,
  },
] as const;

type LocationPreset = (typeof LOCATIONS)[number];
type WeatherType = 'sunny' | 'cloudy' | 'rainy' | 'foggy';
type Status = 'loading' | 'ready' | 'error';

type RouteCoord = [number, number];
type RouteResult = {
  coords: RouteCoord[];
  distanceKm: number;
  durationMin: number;
  source: 'osrm' | 'fallback';
};

const ROUTE_HEIGHT_M = 80;

function haversineKm(a: RouteCoord, b: RouteCoord): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildFallbackRoute(a: LocationPreset, b: LocationPreset): RouteResult {
  const start: RouteCoord = [a.longitude, a.latitude];
  const end: RouteCoord = [b.longitude, b.latitude];
  const midLon = (start[0] + end[0]) / 2;
  const midLat = (start[1] + end[1]) / 2;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.max(Math.hypot(dx, dy), 0.0001);
  const bend = length * 0.18;
  const control: RouteCoord = [midLon - (dy / length) * bend, midLat + (dx / length) * bend];
  const segments = 48;
  const coords: RouteCoord[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const oneMinus = 1 - t;
    coords.push([
      oneMinus * oneMinus * start[0] + 2 * oneMinus * t * control[0] + t * t * end[0],
      oneMinus * oneMinus * start[1] + 2 * oneMinus * t * control[1] + t * t * end[1],
    ]);
  }
  const distanceKm = haversineKm(start, end) * 1.18;
  return {
    coords,
    distanceKm,
    durationMin: (distanceKm / 35) * 60,
    source: 'fallback',
  };
}

function buildCumulative(coords: RouteCoord[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineKm(coords[i - 1], coords[i]));
  }
  return cumulative;
}

function pointAtDistance(
  coords: RouteCoord[],
  cumulative: number[],
  target: number
): RouteCoord {
  if (coords.length === 0) return [0, 0];
  if (target <= 0) return coords[0];
  const total = cumulative[cumulative.length - 1];
  if (target >= total) return coords[coords.length - 1];
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const span = cumulative[i] - cumulative[i - 1] || 1;
  const t = (target - cumulative[i - 1]) / span;
  return [
    coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
    coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
  ];
}

// Procedural Fluffy Cumulus Cloud Texture Generator (Canvas PNG DataURI)
function createCloudTexture(variant: number = 0): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const puffs: { x: number; y: number; r: number; opacity: number }[] = [];

  if (variant === 0) {
    puffs.push(
      { x: 128, y: 72, r: 42, opacity: 0.88 },
      { x: 95, y: 70, r: 36, opacity: 0.82 },
      { x: 160, y: 68, r: 38, opacity: 0.82 },
      { x: 65, y: 76, r: 28, opacity: 0.72 },
      { x: 195, y: 74, r: 30, opacity: 0.72 },
      { x: 115, y: 55, r: 32, opacity: 0.9 },
      { x: 145, y: 52, r: 30, opacity: 0.88 },
      { x: 80, y: 60, r: 24, opacity: 0.78 },
      { x: 175, y: 58, r: 26, opacity: 0.78 },
      { x: 40, y: 80, r: 20, opacity: 0.58 },
      { x: 218, y: 78, r: 22, opacity: 0.58 }
    );
  } else if (variant === 1) {
    puffs.push(
      { x: 128, y: 65, r: 48, opacity: 0.92 },
      { x: 90, y: 70, r: 38, opacity: 0.85 },
      { x: 166, y: 68, r: 40, opacity: 0.85 },
      { x: 120, y: 45, r: 36, opacity: 0.9 },
      { x: 148, y: 48, r: 32, opacity: 0.88 },
      { x: 60, y: 75, r: 28, opacity: 0.68 },
      { x: 196, y: 72, r: 30, opacity: 0.68 }
    );
  } else {
    puffs.push(
      { x: 120, y: 70, r: 35, opacity: 0.8 },
      { x: 80, y: 72, r: 30, opacity: 0.75 },
      { x: 160, y: 68, r: 32, opacity: 0.75 },
      { x: 45, y: 76, r: 22, opacity: 0.55 },
      { x: 200, y: 72, r: 24, opacity: 0.55 },
      { x: 105, y: 58, r: 26, opacity: 0.82 },
      { x: 140, y: 56, r: 25, opacity: 0.8 }
    );
  }

  // Soft bottom shadow layer (subtle atmospheric depth & ambient shading)
  puffs.forEach(({ x, y, r, opacity }) => {
    const shadowGrad = ctx.createRadialGradient(x, y + 6, 0, x, y + 6, r);
    shadowGrad.addColorStop(0, `rgba(195, 208, 225, ${opacity * 0.45})`);
    shadowGrad.addColorStop(0.5, `rgba(215, 225, 238, ${opacity * 0.25})`);
    shadowGrad.addColorStop(1, 'rgba(230, 238, 248, 0)');
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.arc(x, y + 6, r, 0, Math.PI * 2);
    ctx.fill();
  });

  // Bright white fluffy body
  puffs.forEach(({ x, y, r, opacity }) => {
    const grad = ctx.createRadialGradient(x, y - 2, 0, x, y, r);
    grad.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
    grad.addColorStop(0.45, `rgba(252, 253, 255, ${opacity * 0.85})`);
    grad.addColorStop(0.75, `rgba(245, 249, 255, ${opacity * 0.4})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  return canvas.toDataURL('image/png');
}

type ArcgisRequire = (modules: string[], callback: (...modules: any[]) => void) => void;

function getArcgisRequire(): ArcgisRequire | undefined {
  // The CDN loader defines the AMD global `require`; cast around Node's global typing.
  return (window as unknown as { require?: ArcgisRequire }).require;
}

let arcgisLoader: Promise<void> | null = null;

function loadArcgis(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ArcGIS SDK hanya bisa dimuat di browser.'));
  }
  if (getArcgisRequire()) return Promise.resolve();
  if (arcgisLoader) return arcgisLoader;

  arcgisLoader = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-arcgis-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ARCGIS_CSS;
      link.dataset.arcgisCss = 'true';
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = ARCGIS_JS;
    script.async = true;
    script.dataset.arcgisJs = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Gagal memuat ArcGIS Maps SDK dari CDN.'));
    document.head.appendChild(script);
  });

  return arcgisLoader;
}

export default function Esri3DView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const tracerRef = useRef<any>(null);
  const routeCoordsRef = useRef<RouteCoord[]>([]);
  const routeExtentRef = useRef<any>(null);
  const routeAnimRef = useRef<number | null>(null);
  const constructorsRef = useRef<any>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressTextRef = useRef<HTMLSpanElement>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [activeLoc, setActiveLoc] = useState<string>('bsd');
  const [weather, setWeather] = useState<WeatherType>('cloudy');
  const [cloudCover, setCloudCover] = useState(0.45);
  const [fromId, setFromId] = useState<string>('bsd');
  const [toId, setToId] = useState<string>('monas');
  const [routeInfo, setRouteInfo] = useState<{
    distanceKm: number;
    durationMin: number;
    source: 'osrm' | 'fallback';
  } | null>(null);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [routeError, setRouteError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let cancelled = false;

    loadArcgis()
      .then(() => {
        const arcgisRequire = getArcgisRequire();
        if (cancelled || !arcgisRequire) return;

        arcgisRequire(
          [
            'esri/Map',
            'esri/views/SceneView',
            'esri/layers/GraphicsLayer',
            'esri/Graphic',
            'esri/geometry/Polyline',
            'esri/geometry/Point',
            'esri/layers/TileLayer',
            'esri/Basemap',
          ],
          (
            MapCtor: any,
            SceneViewCtor: any,
            GraphicsLayerCtor: any,
            GraphicCtor: any,
            PolylineCtor: any,
            PointCtor: any,
            TileLayerCtor: any,
            BasemapCtor: any
          ) => {
            if (cancelled) return;

            container.innerHTML = '';

            const routeLayer = new GraphicsLayerCtor({ title: 'Route A → B' });

            // Full-Earth globe surface + satellite imagery (Esri World Imagery, no key).
            const imagery = new TileLayerCtor({
              url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
              title: 'World Imagery',
            });
            const basemap = new BasemapCtor({ baseLayers: [imagery], title: 'World Imagery' });

            // Esri World Elevation gives 3D terrain relief under the imagery.
            const map = new MapCtor({ basemap, ground: 'world-elevation', layers: [routeLayer] });

            const start = LOCATIONS[0];
            const view = new SceneViewCtor({
              container,
              map,
              camera: {
                position: {
                  longitude: start.longitude,
                  latitude: start.latitude,
                  z: start.z,
                },
                tilt: start.tilt,
                heading: start.heading,
              },
              environment: {
                starsEnabled: true,
                weather: { type: 'cloudy', cloudCover: 0.45 },
                atmosphere: { quality: 'high' },
              },
              popupEnabled: false,
            });

            viewRef.current = view;
            routeLayerRef.current = routeLayer;
            constructorsRef.current = { GraphicCtor, PolylineCtor, PointCtor };

            view.when(
              () => {
                if (cancelled) return;
                setStatus('ready');
                try {
                  view.ui.move('zoom', 'bottom-right');
                } catch {
                  // Older SDK builds may not expose ui.move; the default UI still works.
                }
              },
              (err: any) => {
                if (!cancelled) {
                  setError(err?.message ?? 'Gagal memuat SceneView Esri.');
                  setStatus('error');
                }
              }
            );
          }
        );
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      if (routeAnimRef.current) cancelAnimationFrame(routeAnimRef.current);
      routeAnimRef.current = null;
      viewRef.current?.destroy?.();
      viewRef.current = null;
      routeLayerRef.current = null;
      tracerRef.current = null;
    };
  }, []);

  // Keep the Esri weather in sync with the controls.
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.environment) return;
    view.environment.weather = { type: weather, cloudCover };
  }, [weather, cloudCover, status]);

  const flyTo = (loc: LocationPreset) => {
    setActiveLoc(loc.id);
    const view = viewRef.current;
    if (!view) return;
    const result = view.goTo(
      {
        position: { longitude: loc.longitude, latitude: loc.latitude, z: loc.z },
        tilt: loc.tilt,
        heading: loc.heading,
      },
      { duration: 3000 }
    );
    if (result && typeof result.catch === 'function') result.catch(() => {});
  };

  const fitRoute = () => {
    const view = viewRef.current;
    const extent = routeExtentRef.current;
    if (!view || !extent) return;
    const result = view.goTo({ target: extent, tilt: 45 }, { duration: 2500 });
    if (result && typeof result.catch === 'function') result.catch(() => {});
  };

  const runRouteAnimation = (coords: RouteCoord[]) => {
    const tracer = tracerRef.current;
    const PointCtor = constructorsRef.current?.PointCtor;
    if (!tracer || !PointCtor || coords.length < 2) return;
    if (routeAnimRef.current) cancelAnimationFrame(routeAnimRef.current);

    const cumulative = buildCumulative(coords);
    const total = cumulative[cumulative.length - 1] || 1;
    const durationMs = 9000;
    const startedAt = performance.now();

    const step = (now: number) => {
      const t = Math.min((now - startedAt) / durationMs, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const [lon, lat] = pointAtDistance(coords, cumulative, total * eased);
      tracer.geometry = new PointCtor({
        longitude: lon,
        latitude: lat,
        z: ROUTE_HEIGHT_M,
        spatialReference: { wkid: 4326 },
      });
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${(eased * 100).toFixed(1)}%`;
      }
      if (progressTextRef.current) {
        progressTextRef.current.textContent = `${Math.round(eased * 100)}%`;
      }
      if (t < 1) {
        routeAnimRef.current = requestAnimationFrame(step);
      } else {
        routeAnimRef.current = null;
      }
    };

    routeAnimRef.current = requestAnimationFrame(step);
  };

  const replayRoute = () => {
    if (routeCoordsRef.current.length < 2) return;
    if (progressBarRef.current) progressBarRef.current.style.width = '0%';
    if (progressTextRef.current) progressTextRef.current.textContent = '0%';
    runRouteAnimation(routeCoordsRef.current);
  };

  const createRoute = async () => {
    const from = LOCATIONS.find((loc) => loc.id === fromId) ?? LOCATIONS[0];
    const to = LOCATIONS.find((loc) => loc.id === toId) ?? LOCATIONS[2];

    if (from.id === to.id) {
      setRouteError('Pilih titik A dan B yang berbeda.');
      setRouteStatus('error');
      return;
    }

    setRouteStatus('loading');
    setRouteError(null);

    let result: RouteResult;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
      const data = await response.json();
      const route = data?.routes?.[0];
      if (!route?.geometry?.coordinates?.length) throw new Error('OSRM tidak mengembalikan rute.');
      result = {
        coords: route.geometry.coordinates as RouteCoord[],
        distanceKm: route.distance / 1000,
        durationMin: route.duration / 60,
        source: 'osrm',
      };
    } catch {
      result = buildFallbackRoute(from, to);
    }

    const { GraphicCtor, PolylineCtor, PointCtor } = constructorsRef.current ?? {};
    const routeLayer = routeLayerRef.current;
    const view = viewRef.current;

    if (!GraphicCtor || !PolylineCtor || !PointCtor || !routeLayer || !view) {
      setRouteError('Scene belum siap. Coba lagi sebentar.');
      setRouteStatus('error');
      return;
    }

    if (routeAnimRef.current) cancelAnimationFrame(routeAnimRef.current);
    routeAnimRef.current = null;
    routeLayer.removeAll();

    const path = result.coords.map(([lon, lat]) => [lon, lat, ROUTE_HEIGHT_M]);
    const polyline = new PolylineCtor({
      paths: [path],
      spatialReference: { wkid: 4326 },
    });

    const casing = new GraphicCtor({
      geometry: polyline,
      symbol: {
        type: 'line-3d',
        symbolLayers: [
          {
            type: 'line',
            size: 14,
            material: { color: [255, 85, 0, 0.25] },
            cap: 'round',
            join: 'round',
          },
        ],
      },
    });

    const core = new GraphicCtor({
      geometry: polyline.clone(),
      symbol: {
        type: 'line-3d',
        symbolLayers: [
          {
            type: 'line',
            size: 4,
            material: { color: [255, 150, 40, 1] },
            cap: 'round',
            join: 'round',
          },
        ],
      },
    });

    const tracer = new GraphicCtor({
      geometry: new PointCtor({
        longitude: result.coords[0][0],
        latitude: result.coords[0][1],
        z: ROUTE_HEIGHT_M,
        spatialReference: { wkid: 4326 },
      }),
      symbol: {
        type: 'simple-marker',
        style: 'circle',
        color: [255, 255, 255, 1],
        size: 9,
        outline: { color: [255, 85, 0, 1], width: 2 },
      },
    });

    routeLayer.addMany([casing, core, tracer]);
    tracerRef.current = tracer;
    routeCoordsRef.current = result.coords;
    routeExtentRef.current = polyline.extent;

    if (progressBarRef.current) progressBarRef.current.style.width = '0%';
    if (progressTextRef.current) progressTextRef.current.textContent = '0%';

    setRouteInfo({
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      source: result.source,
    });
    setRouteStatus('ready');
    setActiveLoc('');

    // Cinematic zoom-out to show the full A → B corridor.
    const camera = view.goTo(
      { target: polyline.extent, tilt: 45 },
      { duration: 3000 }
    );
    if (camera && typeof camera.then === 'function') {
      camera.then(
        () => runRouteAnimation(result.coords),
        () => runRouteAnimation(result.coords)
      );
    } else {
      runRouteAnimation(result.coords);
    }
  };

  const cloudView = () => {
    const view = viewRef.current;
    if (!view) return;
    const loc = LOCATIONS.find((item) => item.id === activeLoc) ?? LOCATIONS[0];
    setWeather('cloudy');
    setCloudCover(0.8);
    const result = view.goTo(
      {
        position: { longitude: loc.longitude, latitude: loc.latitude, z: 300 },
        tilt: 85,
        heading: 15,
      },
      { duration: 3000 }
    );
    if (result && typeof result.catch === 'function') result.catch(() => {});
  };

  const globeView = () => {
    const view = viewRef.current;
    if (!view) return;
    const result = view.goTo(
      {
        position: { longitude: 106.8, latitude: -2.5, z: 15000000 },
        tilt: 0,
        heading: 0,
      },
      { duration: 4000 }
    );
    if (result && typeof result.catch === 'function') result.catch(() => {});
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#040814] text-white font-sans select-none">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Header */}
      <header className="absolute top-5 left-5 z-30 flex flex-col gap-2 pointer-events-none">
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-[#0b1022]/85 backdrop-blur-xl border border-white/10 shadow-2xl pointer-events-auto">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-sm tracking-tighter text-white shadow-lg shadow-cyan-500/25">
            E3
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">Esri SceneView (Full Esri)</h1>
            <p className="text-[11px] text-white/50 leading-tight">
              ArcGIS Maps SDK — World Imagery + World Elevation
            </p>
          </div>
        </div>
        <Link
          href="/"
          className="w-fit px-3 py-1.5 rounded-xl bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/10 text-[11px] font-medium text-white/70 hover:text-white transition-colors pointer-events-auto"
        >
          ← Kembali ke Spindonesia Tiles
        </Link>
      </header>

      {/* Route A → B */}
      <div className="absolute top-36 left-5 z-30 w-80 p-3.5 rounded-2xl bg-[#0b1022]/90 backdrop-blur-xl border border-white/10 shadow-2xl space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-white/40">
            Route A → B
          </span>
          {routeInfo && (
            <span className="text-[10px] font-mono text-cyan-300">
              {routeInfo.distanceKm.toFixed(1)} km • {Math.round(routeInfo.durationMin)} mnt
            </span>
          )}
        </div>

        <div className="grid grid-cols-[18px_1fr] items-center gap-1.5">
          <span className="text-[10px] font-bold text-emerald-400">A</span>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-[11px] text-white outline-none focus:border-cyan-400"
          >
            {LOCATIONS.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] font-bold text-orange-400">B</span>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-[11px] text-white outline-none focus:border-cyan-400"
          >
            {LOCATIONS.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={createRoute}
          disabled={routeStatus === 'loading'}
          className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-wait transition-all active:scale-[0.99]"
        >
          {routeStatus === 'loading' ? 'Menghitung rute…' : 'Buat Rute & Animasi Trail'}
        </button>

        {routeError && <p className="text-[10px] text-red-300 leading-relaxed">{routeError}</p>}

        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            ref={progressBarRef}
            className="h-full w-0 rounded-full bg-gradient-to-r from-orange-500 to-amber-300 transition-[width] duration-75"
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-white/40">
          <span>{routeInfo?.source === 'fallback' ? 'Fallback curve' : routeInfo ? 'OSRM driving' : 'Belum ada rute'}</span>
          <span ref={progressTextRef} className="font-mono text-white/60">
            0%
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={replayRoute}
            disabled={!routeInfo}
            className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white disabled:opacity-40 transition-colors"
          >
            ↻ Ulangi Trail
          </button>
          <button
            onClick={fitRoute}
            disabled={!routeInfo}
            className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white disabled:opacity-40 transition-colors"
          >
            ⤢ Zoom Out
          </button>
        </div>
      </div>

      {/* Weather controls */}
      <div className="absolute top-5 right-5 z-30 flex flex-col gap-2 p-3 rounded-2xl bg-[#0b1022]/85 backdrop-blur-xl border border-white/10 shadow-2xl w-56">
        <label className="text-[10px] uppercase tracking-wider font-semibold text-white/40">
          Cuaca Esri
        </label>
        <select
          value={weather}
          onChange={(e) => setWeather(e.target.value as WeatherType)}
          className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white outline-none focus:border-cyan-400"
        >
          <option value="sunny">☀️ Sunny</option>
          <option value="cloudy">☁️ Cloudy</option>
          <option value="rainy">🌧️ Rainy</option>
          <option value="foggy">🌫️ Foggy</option>
        </select>
        <div className="flex items-center justify-between text-[10px] text-white/50">
          <span>Cloud cover</span>
          <span className="font-mono text-cyan-300">{cloudCover.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={cloudCover}
          onChange={(e) => setCloudCover(Number(e.target.value))}
          className="w-full accent-cyan-400"
        />
        <button
          onClick={cloudView}
          className="w-full px-3 py-1.5 rounded-xl text-[10px] font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
        >
          ☁️ Lihat Awan (tilt 85°)
        </button>
        <button
          onClick={globeView}
          className="w-full px-3 py-1.5 rounded-xl text-[10px] font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
        >
          🌍 Globe View (angkasa)
        </button>
      </div>

      {/* Location dock */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-2 p-1.5 rounded-2xl bg-[#0b1022]/90 backdrop-blur-xl border border-white/10 shadow-2xl">
        {LOCATIONS.map((loc) => (
          <button
            key={loc.id}
            onClick={() => flyTo(loc)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeLoc === loc.id
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/30'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>{loc.icon}</span>
            <span>{loc.label}</span>
          </button>
        ))}
      </div>

      {/* Required attribution */}
      <div className="absolute bottom-2 left-3 z-40 flex items-center gap-2 text-[10px] text-white/70">
        <a
          href="https://www.esri.com"
          target="_blank"
          rel="noopener noreferrer"
          className="px-2 py-1 rounded-md bg-black/55 backdrop-blur-md border border-white/10 hover:text-white transition-colors"
        >
          Powered by Esri
        </a>
      </div>

      {/* Loading / error overlays */}
      {status === 'loading' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#040814]/70 backdrop-blur-sm pointer-events-none">
          <div className="px-5 py-4 rounded-2xl bg-[#0b1022]/90 border border-white/10 shadow-2xl text-center">
            <div className="text-sm font-semibold text-white">Memuat Esri SceneView…</div>
            <div className="text-[11px] text-white/50 mt-1">
              Memuat terrain & citra satelit Esri
            </div>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#040814]/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg p-5 rounded-2xl bg-[#0b1022]/95 border border-red-500/30 shadow-2xl">
            <h2 className="text-sm font-bold text-red-300 mb-2">Esri view gagal dimuat</h2>
            <p className="text-xs text-white/60 leading-relaxed mb-4">{error}</p>
            <div className="flex justify-end gap-2">
              <Link href="/" className="px-3 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white">
                Kembali
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
