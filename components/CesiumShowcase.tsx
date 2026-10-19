'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BSD_LINE_COORDINATES } from '@/lib/bsdline';
import { DISTRICTS } from '@/lib/mapLayersData';
import { COVERAGE_RADII, loadTransportCoverage } from '@/lib/overpassTransport';
import { startMp4Recording, RECORDING_SECONDS } from '@/lib/cesiumRecording';
import { DEFAULT_START_POINT, PREFERENCES_KEY, parseStartPoint, readPreferences, type StartPoint } from '@/lib/cesiumPreferences';

const CESIUM_VERSION = '1.115';
const CESIUM_JS = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/Cesium.js`;
const CESIUM_CSS = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/Widgets/widgets.css`;

type Poi = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  height: number;
  estTime: string;
  estDist: string;
  category: 'near' | 'far';
};

const POIS: Poi[] = [
  { id: 'aeon', name: 'AEON Mall BSD', lon: 106.6436, lat: -6.3046, height: 65, estTime: '5 min', estDist: '1.4 km', category: 'near' },
  { id: 'breeze', name: 'The Breeze BSD', lon: 106.6542, lat: -6.3022, height: 60, estTime: '6 min', estDist: '1.8 km', category: 'near' },
  { id: 'qbig', name: 'QBig BSD City', lon: 106.6345, lat: -6.2842, height: 65, estTime: '8 min', estDist: '3.2 km', category: 'near' },
  { id: 'ice', name: 'ICE BSD', lon: 106.6366, lat: -6.3006, height: 60, estTime: '7 min', estDist: '2.3 km', category: 'near' },
  { id: 'cisauk', name: 'Stasiun Cisauk', lon: 106.6433, lat: -6.3248, height: 55, estTime: '8 min', estDist: '3.8 km', category: 'near' },
  { id: 'soetta', name: 'Soekarno-Hatta Airport', lon: 106.6558, lat: -6.1256, height: 55, estTime: '32 min', estDist: '28.5 km', category: 'far' },
];

// Low altitude offset to precisely hug the road surface (zero floating parallax)
const ROUTE_HEIGHT_M = 10;
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildCumulative(coords: [number, number][]): number[] {
  const c = [0];
  for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + haversineKm(coords[i - 1], coords[i]));
  return c;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap');

.cesium-showcase, .cesium-showcase * {
  font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}

.cesium-showcase {
  font-weight: 400;
}

.cesium-showcase h1 {
  font-weight: 500 !important;
}

.cesium-showcase {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #040814;
}

.cesium-showcase .map {
  position: absolute;
  inset: 0;
}

.cesium-showcase .pins {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  overflow: hidden;
}

.cesium-showcase .pole {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: auto;
  cursor: pointer;
  transition: transform .25s cubic-bezier(0.16, 1, 0.3, 1), opacity .25s ease;
}

.cesium-showcase .pole:hover {
  transform: translate(-50%, -100%) scale(1.08);
  z-index: 20;
}

.cesium-showcase .pole.hub { z-index: 100; }
.cesium-showcase .pole.active { z-index: 110; }
.cesium-showcase .pole.hub:hover, .cesium-showcase .pole.active:hover { z-index: 120; }
.cesium-showcase .settings-panel {
  position: relative; width: 100%; margin-top: 0;
  border: 1px solid rgba(255,255,255,.7); border-radius: 16px;
  background: rgba(255,255,255,.72); color: #1e293b; backdrop-filter: blur(24px);
  padding: 12px;
}
.cesium-showcase .settings-panel.collapsed { padding: 12px; }
.cesium-showcase .layer-switch {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; padding: 12px 0; text-align: left; font-size: 12px;
  border-bottom: 1px solid rgba(100,116,139,.15); cursor: pointer;
}
.cesium-showcase .layer-switch:focus-visible { outline: 2px solid #ff7700; outline-offset: 4px; }
.cesium-showcase .switch-track { width: 30px; height: 18px; border-radius: 20px; background: #94a3b8; padding: 3px; flex-shrink: 0; }
.cesium-showcase .switch-track.on { background: #ea580c; }
.cesium-showcase .switch-track span { display: block; width: 12px; height: 12px; border-radius: 50%; background: white; transition: transform .2s; }
.cesium-showcase .switch-track.on span { transform: translateX(12px); }
.cesium-showcase.theme-dark .settings-panel,
.cesium-showcase.theme-dark .navigation-panel {
  background: rgba(15,23,42,.82); color: #f1f5f9; border-color: rgba(255,255,255,.18);
}
.cesium-showcase.theme-dark .navigation-panel [class*="text-slate-800"],
.cesium-showcase.theme-dark .navigation-panel [class*="text-slate-700"] { color: #e2e8f0; }
.cesium-showcase.theme-dark .navigation-panel [class*="text-slate-500"] { color: #cbd5e1; }
.cesium-showcase.theme-dark .navigation-panel [class*="bg-white/"] { background-color: rgba(15,23,42,.72); border-color: rgba(255,255,255,.2); }
@media (max-width: 700px) {
  .cesium-showcase .settings-panel { margin-top: 0; }
}

/* Glassmorphic 3D Pole Pin Badges (Frosted White Glass) */
.cesium-showcase .pole-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
  max-width: 240px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: #0f172a;
  padding: 6px 14px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.18), inset 0 1px 0 0 rgba(255, 255, 255, 0.95);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.01em;
  transition: all .25s cubic-bezier(0.16, 1, 0.3, 1);
}

.cesium-showcase .pole.hub .pole-label {
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1.5px solid rgba(255, 140, 0, 0.8);
  color: #0f172a;
  font-weight: 500;
  border-radius: 5px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22), 0 0 18px rgba(255, 150, 0, 0.4);
}

.cesium-showcase .pole.active .pole-label {
  background: rgba(255, 85, 0, 0.95) !important;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: #ffffff !important;
  border: 1.5px solid rgba(255, 200, 140, 0.9) !important;
  border-radius: 5px !important;
  padding: 7px 18px !important;
  font-weight: 500 !important;
  box-shadow: 0 10px 32px rgba(255, 85, 0, 0.55), 0 0 24px rgba(255, 85, 0, 0.5) !important;
}

.cesium-showcase .pole-sub {
  font-size: 10.5px;
  color: #475569;
  font-weight: 400;
  display: none;
}

.cesium-showcase .pole.active .pole-sub {
  display: block;
  color: #fff3e0 !important;
  opacity: 1;
}

.cesium-showcase .pole.hub .pole-sub {
  display: block;
  color: #c2410c;
  font-weight: 500;
}

.cesium-showcase .pole-line {
  width: 2px;
  height: 36px;
  background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0.4) 100%);
  box-shadow: 0 0 8px rgba(0,0,0,0.35);
}

.cesium-showcase .pole.hub .pole-line {
  background: linear-gradient(180deg, #ff9900 0%, rgba(255,153,0,0.4) 100%);
  height: 48px;
  box-shadow: 0 0 10px rgba(255,153,0,0.6);
}

.cesium-showcase .pole.active .pole-line {
  background: linear-gradient(180deg, #ff7700 0%, #ff3300 100%) !important;
  box-shadow: 0 0 12px rgba(255,85,0,0.9) !important;
  height: 46px;
}

.cesium-showcase .pole-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #0f172a;
  box-shadow: 0 0 8px rgba(0,0,0,0.4);
}

.cesium-showcase .pole.hub .pole-dot {
  width: 16px;
  height: 16px;
  background: #ff9900;
  border-color: #ffffff;
  box-shadow: 0 0 0 4px rgba(255, 153, 0, 0.4), 0 0 14px rgba(255, 153, 0, 0.8);
}

.cesium-showcase .pole.active .pole-dot {
  width: 15px;
  height: 15px;
  background: #ff5500 !important;
  border-color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(255, 85, 0, 0.4), 0 0 14px rgba(255, 85, 0, 0.8) !important;
}

.cesium-showcase .pole-label > span:first-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }

/* Custom Glassmorphism Scrollbar */
.cesium-glass-scroll::-webkit-scrollbar {
  width: 5px;
}
.cesium-glass-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.cesium-glass-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 999px;
}
.cesium-glass-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.35);
}

/* Dark Glassmorphism Theme Overrides */
.cesium-showcase.theme-dark {
  background: #020409;
}

.cesium-showcase.theme-dark .pole-label {
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #f1f5f9;
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.45), inset 0 1px 0 0 rgba(255, 255, 255, 0.2);
}

.cesium-showcase.theme-dark .pole.hub .pole-label {
  background: rgba(26, 32, 53, 0.92);
  border: 1.5px solid rgba(255, 140, 0, 0.9);
  color: #ffedd5;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55), 0 0 18px rgba(255, 150, 0, 0.45);
}

.cesium-showcase.theme-dark .pole-sub {
  color: #94a3b8;
}

.cesium-showcase.theme-dark .pole.hub .pole-sub {
  color: #fb923c;
}

.cesium-showcase.theme-dark .cesium-glass-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}

.cesium-showcase.theme-dark .cesium-glass-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.35);
}

/* Hide Cesium ion logo but keep data attribution */
.cesium-showcase .cesium-credit-logoContainer { display: none !important; }
`;

type Status = 'loading' | 'ready' | 'error';

let cesiumLoader: Promise<any> | null = null;

function loadCesium(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Browser only'));
  if ((window as any).Cesium) return Promise.resolve((window as any).Cesium);
  if (cesiumLoader) return cesiumLoader;

  cesiumLoader = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-cesium-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CESIUM_CSS;
      link.dataset.cesiumCss = 'true';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = CESIUM_JS;
    script.async = true;
    script.dataset.cesiumJs = 'true';
    script.onload = () => {
      if ((window as any).Cesium) resolve((window as any).Cesium);
      else reject(new Error('Cesium tidak ter-definisi setelah load.'));
    };
    script.onerror = () => reject(new Error('Gagal memuat CesiumJS dari CDN.'));
    document.head.appendChild(script);
  });

  return cesiumLoader;
}

// Fit the entire route inside the viewport beside the navigation panel.
// A bounding sphere is orientation independent, so the same padding also holds during orbit.
function positionRouteCamera(viewer: any, C: any, sphere: any, heading: number, customRange?: number | null) {
  const camera = viewer.camera;
  const canvas = viewer.canvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const shell = canvas.closest('.cesium-showcase');
  const nav = shell?.querySelector('.navigation-panel')?.getBoundingClientRect();

  const left = Math.max(32, nav ? nav.right + 32 : 32);
  const right = 48;
  const top = 130;
  const usableWidth = Math.max(width * 0.2, width - left - right);
  const usableHeight = Math.max(height * 0.2, height - top - 90);
  const halfFov = camera.frustum.fovy / 2;
  const tanHalf = Math.tan(halfFov);
  const aspect = width / height;
  const angle = Math.min(
    Math.atan(tanHalf * usableHeight / height),
    Math.atan(tanHalf * aspect * usableWidth / width),
  );
  const defaultRange = Math.max(850, sphere.radius / Math.sin(angle) * 1.15);
  const range = (customRange && customRange > 30) ? customRange : defaultRange;
  camera.lookAt(sphere.center, new C.HeadingPitchRange(heading, C.Math.toRadians(-42), range));
  camera.lookAtTransform(C.Matrix4.IDENTITY);
  // Move the camera so the orbit target projects into the unobstructed area's center.
  const centerX = left + usableWidth / 2;
  const centerY = top + usableHeight / 2;
  camera.moveRight((width / 2 - centerX) * 2 * range * tanHalf * aspect / width);
  camera.moveUp((centerY - height / 2) * 2 * range * tanHalf / height);
}

function getFreeRoamSphere(viewer: any, Cesium: any, defaultHub: { lat: number; lon: number }) {
  const canvas = viewer.canvas;
  const centerRay = viewer.camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
  let pos = viewer.scene.globe.pick(centerRay, viewer.scene);
  if (!pos) {
    pos = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
  }
  if (!pos) {
    pos = Cesium.Cartesian3.fromDegrees(defaultHub.lon, defaultHub.lat, 75);
  }
  return new Cesium.BoundingSphere(pos, 400);
}

export default function CesiumShowcase() {
  const [hub, setHub] = useState<StartPoint>(DEFAULT_START_POINT);
  const hubRef = useRef<StartPoint>(DEFAULT_START_POINT);
  const [autoRotateOnArrival, setAutoRotateOnArrival] = useState(false);
  const autoArrivalRef = useRef(false);
  const [hubEditorOpen, setHubEditorOpen] = useState(false);
  const [hubName, setHubName] = useState(DEFAULT_START_POINT.name);
  const [hubLatitude, setHubLatitude] = useState(String(DEFAULT_START_POINT.lat));
  const [hubLongitude, setHubLongitude] = useState(String(DEFAULT_START_POINT.lon));
  const [hubMessage, setHubMessage] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<StartPoint[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchRequestRef = useRef<AbortController | null>(null);
  const searchCacheRef = useRef(new Map<string, StartPoint[]>());
  const [onlyABTooltips, setOnlyABTooltips] = useState(false);
  const onlyABRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const pinRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const routeEntitiesRef = useRef<any[]>([]);
  const trailEntityRef = useRef<any>(null);
  const trailAnimRef = useRef<number | null>(null);
  const routeSphereRef = useRef<any>(null);
  const freeRoamSphereRef = useRef<any>(null);
  const orbitRangeRef = useRef<number | null>(null);
  const introGenerationRef = useRef(0);
  const orbitHeadingRef = useRef(0);
  const routeRequestRef = useRef<AbortController | null>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [activePoi, setActivePoi] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBsd, setShowBsd] = useState(true);
  const [coverageRadius, setCoverageRadius] = useState(10);
  const [coverageRefresh, setCoverageRefresh] = useState(0);
  const [transportStatus, setTransportStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [transportError, setTransportError] = useState('');
  const [transportInfo, setTransportInfo] = useState<{ toll: number; railway: number; timestamp: string | null; fetchedAt: number } | null>(null);
  const transportSourcesRef = useRef<{ toll: any; railway: any; areaKey: string } | null>(null);
  const transportVisibleRef = useRef({ toll: false, railway: false });
  const refreshVersionRef = useRef(0);
  const [showRailways, setShowRailways] = useState(false);
  const [showTolls, setShowTolls] = useState(false);
  const [showDistricts, setShowDistricts] = useState(false);
  const [showEsriLabels, setShowEsriLabels] = useState(false);
  const [darkGlass, setDarkGlass] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const layersRef = useRef<{ district: any[]; labels: any } | null>(null);

  // Toolbar action states
  const [showTooltips, setShowTooltips] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(1.0);
  const [showRotateSlider, setShowRotateSlider] = useState(false);

  // Video recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordWithEarthIntro, setRecordWithEarthIntro] = useState(true);

  // Refs for requestAnimationFrame loops
  const showTooltipsRef = useRef(true);
  const autoRotateRef = useRef(false);
  const rotateSpeedRef = useRef(1.0);
  const activePoiRef = useRef<string | null>(null);

  const recordCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingSessionRef = useRef<ReturnType<typeof startMp4Recording> | null>(null);
  const recordingIntroRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const darkGlassRef = useRef(false);
  const recordAnimRef = useRef<number | null>(null);
  useEffect(() => {
    showTooltipsRef.current = showTooltips;
    autoRotateRef.current = autoRotate;
    rotateSpeedRef.current = rotateSpeed;
    activePoiRef.current = activePoi;
    darkGlassRef.current = darkGlass;
    onlyABRef.current = onlyABTooltips;
    transportVisibleRef.current = { toll: showTolls, railway: showRailways };
    if (transportSourcesRef.current) {
      const matchesArea = transportSourcesRef.current.areaKey === `${hub.lat},${hub.lon},${coverageRadius}`;
      transportSourcesRef.current.toll.show = showTolls && matchesArea;
      transportSourcesRef.current.railway.show = showRailways && matchesArea;
    }
  }, [showTooltips, autoRotate, rotateSpeed, activePoi, darkGlass, onlyABTooltips, showTolls, showRailways, hub.lat, hub.lon, coverageRadius]);

  useEffect(() => {
    const resizePanels = () => {
      if (window.innerWidth < 1000) { setSidebarOpen(false); setSettingsOpen(false); }
    };
    const id = requestAnimationFrame(resizePanels);
    window.addEventListener('resize', resizePanels);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', resizePanels); };
  }, []);


  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let cancelled = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let removeCanvasListeners = () => {};
    const reframeAfterResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const viewer = viewerRef.current;
        const C = (window as any).Cesium;
        if (cancelled || !viewer || viewer.isDestroyed() || !C) return;
        viewer.resize();
        if (routeSphereRef.current && !autoRotateRef.current) {
          viewer.camera.cancelFlight();
          positionRouteCamera(viewer, C, routeSphereRef.current, viewer.camera.heading, orbitRangeRef.current);
        }
      }, 350);
    };
    window.addEventListener('resize', reframeAfterResize);

    loadCesium()
      .then((Cesium) => {
        if (cancelled || !container) return;

        try {
          const preferences = readPreferences(localStorage.getItem(PREFERENCES_KEY));
          hubRef.current = preferences.hub;
          autoArrivalRef.current = preferences.autoRotateOnArrival;
          setHub(preferences.hub);
          setHubName(preferences.hub.name);
          setHubLatitude(String(preferences.hub.lat));
          setHubLongitude(String(preferences.hub.lon));
          setAutoRotateOnArrival(preferences.autoRotateOnArrival);
        } catch { setHubMessage('Opslag browser tidak tersedia; perubahan hanya berlaku selama sesi ini.'); }
        const viewer = new Cesium.Viewer(container, {
          baseLayer: false, // no default ion imagery
          baseLayerPicker: false,
          terrain: new Cesium.Terrain(new Cesium.EllipsoidTerrainProvider()),
          skyAtmosphere: new Cesium.SkyAtmosphere(),
          animation: false,
          timeline: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          contextOptions: {
            webgl: {
              preserveDrawingBuffer: true,
            },
          },
        });

        // 1. Satellite imagery on the globe (Esri World Imagery)
        viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            credit: new Cesium.Credit('Esri World Imagery'),
          })
        );

        // 2. Official Reference Boundaries and Places (Nama Wilayah, Kota, Provinsi tanpa watermark)
        const referenceLabels = viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            credit: new Cesium.Credit('Esri Boundaries & Places'),
          })
        );

        // Afternoon sun & lighting (Crisp tropical sunlight illuminating the terrain & clouds)
        viewer.scene.globe.enableLighting = true;
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date('2024-06-21T13:45:00+07:00'));
        viewer.clock.shouldAnimate = false;

        // Sky atmosphere & fog depth
        if (viewer.scene.skyAtmosphere) {
          viewer.scene.skyAtmosphere.show = true;
          viewer.scene.skyAtmosphere.saturationShift = 0.15;
          viewer.scene.skyAtmosphere.brightnessShift = 0.08;
        }
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.00012;
        viewer.scene.fog.minimumBrightness = 0.2;
        viewerRef.current = viewer;

        // Camera controller tuning — smooth, non-weird zoom/rotate around the globe
        const controller = viewer.scene.screenSpaceCameraController;
        controller.minimumZoomDistance = 25; // jangan tembus permukaan bumi
        controller.maximumZoomDistance = 25000000; // cukup buat lihat bola bumi utuh
        controller.zoomFactor = 2.2; // Halved from earlier, smooth and controlled zoom
        controller.inertiaZoom = 0.75; // Smooth deceleration without jerky jumps
        controller.enableCollisionDetection = false;

        // Border Area BSD from bsdline.kmz (BSDEPICYOUNG) — Murni garis border tanpa highlight/fill
        const bsdEntities: any[] = [];
        const flat3D: number[] = [];
        BSD_LINE_COORDINATES.forEach(([lon, lat]) => {
          flat3D.push(lon, lat, 1);
        });

        // 1. Outer glowing neon amber border (#ffb700 matching KML LineStyle)
        const bsdGlowBorder = viewer.entities.add({
          name: 'BSD City Border Glow',
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat3D),
            width: 6,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.35,
              taperPower: 0.9,
              color: Cesium.Color.fromCssColorString('#ffaa00'),
            }),
            clampToGround: false,
          },
        });
        bsdEntities.push(bsdGlowBorder);

        // 2. Sharp white/amber inner core line for crisp boundary definition
        const bsdCoreBorder = viewer.entities.add({
          name: 'BSD City Border Core',
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat3D),
            width: 2.0,
            material: new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString('#fff4e0').withAlpha(0.95)
            ),
            clampToGround: false,
          },
        });
        bsdEntities.push(bsdCoreBorder);

        (viewer as any).__bsdHighlightEntities = bsdEntities;

        // Surrounding layers are opt-in and remain below the route A-B.
        referenceLabels.show = false;
        const layers = { district: [] as any[], labels: referenceLabels };
        const addLabel = (name: string, lon: number, lat: number, color = '#e2e8f0') => viewer.entities.add({
          name,
          show: false,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 3),
          label: {
            text: name,
            font: '400 12px Geist, sans-serif',
            fillColor: Cesium.Color.fromCssColorString(color),
            outlineColor: Cesium.Color.fromCssColorString('#090d16'),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 60000),
          },
        });
        DISTRICTS.forEach(district => {
          layers.district.push(addLabel(district.name, ...district.coord));
        });
        layersRef.current = layers;

        // Pin projection each frame
        const onPostRender = viewer.scene.postRender.addEventListener(() => {
          const allLocs: { id: string; lon: number; lat: number; height: number }[] = [
            hubRef.current,
            ...POIS,
          ];
          // Hide pins while in outer space (> 75 km altitude)
          const camHeight = viewer.camera.positionCartographic.height;
          allLocs.forEach((loc) => {
            const el = pinRefs.current[loc.id];
            if (!el) return;
            if (camHeight > 75000 || !showTooltipsRef.current || (onlyABRef.current && loc.id !== 'hub' && loc.id !== activePoiRef.current)) {
              el.style.display = 'none';
              return;
            }
            const cartesian = Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, loc.height);
            const canvasPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
            if (Cesium.defined(canvasPos)) {
              el.style.left = `${canvasPos.x}px`;
              el.style.top = `${canvasPos.y}px`;
              el.style.display = 'flex';
            } else {
              el.style.display = 'none';
            }
          });
        });
        (viewer as any).__onPostRender = onPostRender;

        const onIntroArrived = () => {
          if (cancelled || !autoArrivalRef.current) return;
          autoRotateRef.current = true;
          orbitHeadingRef.current = viewer.camera.heading;
          setAutoRotate(true);
          setShowRotateSlider(true);
        };
        viewer.__onIntroArrived = onIntroArrived;
        // Intro Sinematik Bumi di tengah layar dengan lengkungan sempurna
        function playGlobeIntro(C: any) {
          const generation = ++introGenerationRef.current;
          // 1. Posisi awal tepat lurus di atas HUB (Bumi tetap simetris di tengah layar)
          viewer.camera.setView({
            destination: C.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat, 6500000.0),
            orientation: {
              heading: 0.0,
              pitch: C.Math.toRadians(-90.0),
              roll: 0.0,
            },
          });

          setTimeout(() => {
            if (cancelled || generation !== introGenerationRef.current || autoRotateRef.current || activePoiRef.current) return;
            // 2. Tahap 1: Menukik lurus vertikal (-90 derajat) agar layar tidak goyang/turun ke bawah
            viewer.camera.flyTo({
              destination: C.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat, 2500.0),
              orientation: {
                heading: C.Math.toRadians(0.0),
                pitch: C.Math.toRadians(-90.0),
                roll: 0.0,
              },
              duration: 3.0,
              easingFunction: C.EasingFunction.CUBIC_IN_OUT,
              complete: () => {
                if (cancelled || generation !== introGenerationRef.current || autoRotateRef.current || activePoiRef.current) return;
                // 3. Tahap 2: Baru miringkan kamera (tilt ke -38 derajat) saat sudah dekat gedung BSD
                viewer.camera.flyTo({
                  destination: C.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat - 0.012, 1050.0),
                  orientation: {
                    heading: C.Math.toRadians(0.0),
                    pitch: C.Math.toRadians(-38.0),
                    roll: 0.0,
                  },
                  duration: 1.5,
                  easingFunction: C.EasingFunction.QUADRATIC_OUT,
                  complete: onIntroArrived,
                });
              },
            });
          }, 1200);
        }
        (viewer as any).__playGlobeIntro = playGlobeIntro;

        // Drag detection (manual drag turns off autorotate) & Wheel zoom during autorotate
        let isPointerDown = false;
        let startX = 0;
        let startY = 0;
        let activePointers = 0;

        const onPointerDown = (e: PointerEvent) => {
          isPointerDown = true;
          startX = e.clientX;
          startY = e.clientY;
          activePointers++;
        };

        const onPointerMove = (e: PointerEvent) => {
          if (!isPointerDown) return;
          if (activePointers > 1) return; // Allow pinch gesture on touch devices
          const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
          if (dist > 6) {
            // Drag manual: matikan autorotate
            if (autoRotateRef.current) {
              autoRotateRef.current = false;
              setAutoRotate(false);
              orbitRangeRef.current = null;
              freeRoamSphereRef.current = null;
            }
          }
        };

        const onPointerUp = () => {
          isPointerDown = false;
          activePointers = Math.max(0, activePointers - 1);
        };

        const onPointerCancel = () => {
          isPointerDown = false;
          activePointers = Math.max(0, activePointers - 1);
        };

        const onWheel = (e: WheelEvent) => {
          if (autoRotateRef.current && viewerRef.current) {
            const C = (window as any).Cesium;
            if (C) {
              const sphere = routeSphereRef.current || freeRoamSphereRef.current || getFreeRoamSphere(viewerRef.current, C, hubRef.current);
              if (orbitRangeRef.current === null) {
                orbitRangeRef.current = C.Cartesian3.distance(viewerRef.current.camera.positionWC, sphere.center);
              }
              const factor = e.deltaY > 0 ? 1.12 : 0.89;
              const currentRange = orbitRangeRef.current ?? 1000;
              orbitRangeRef.current = Math.max(60, Math.min(25000000, currentRange * factor));
            }
          }
        };

        const canvas = viewer.canvas;
        canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
        canvas.addEventListener('pointermove', onPointerMove, { passive: true });
        canvas.addEventListener('pointerup', onPointerUp, { passive: true });
        canvas.addEventListener('pointercancel', onPointerCancel, { passive: true });
        canvas.addEventListener('wheel', onWheel, { passive: true });

        removeCanvasListeners = () => {
          try {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerCancel);
            canvas.removeEventListener('wheel', onWheel);
          } catch {
            /* ignore */
          }
        };

        // Run cinematic intro on load
        playGlobeIntro(Cesium);
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', reframeAfterResize);
      removeCanvasListeners();
      routeRequestRef.current?.abort();
      searchRequestRef.current?.abort();
      recordingSessionRef.current?.dispose();
      if (recordAnimRef.current) cancelAnimationFrame(recordAnimRef.current);
      if (recordingIntroRef.current) clearTimeout(recordingIntroRef.current);
      recordCanvasRef.current = null;
      layersRef.current = null;
      transportSourcesRef.current = null;
      if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
      trailAnimRef.current = null;
      const viewer = viewerRef.current;
      if (viewer) {
        try {
          viewer.scene.postRender.removeEventListener((viewer as any).__onPostRender);
        } catch {
          /* ignore */
        }
        viewer.destroy();
      }
      viewerRef.current = null;
      routeEntitiesRef.current = [];
      trailEntityRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers || status !== 'ready') return;
    layers.district.forEach(entity => { entity.show = showDistricts; });
    layers.labels.show = showEsriLabels;
  }, [status, showDistricts, showEsriLabels]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (status !== 'ready' || !viewer) return;
    viewer.__bsdHighlightEntities?.forEach((entity: any) => { entity.show = showBsd; });
  }, [status, showBsd]);

  const needsTransport = showTolls || showRailways;
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (status !== 'ready' || !viewer || !C || !needsTransport) return;
    const request = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; request.abort(); }, 35000);
    const force = coverageRefresh !== refreshVersionRef.current;
    refreshVersionRef.current = coverageRefresh;
    if (transportSourcesRef.current) {
      transportSourcesRef.current.toll.show = false;
      transportSourcesRef.current.railway.show = false;
    }
    const load = async () => {
      setTransportStatus('loading');
      setTransportError('');
      setTransportInfo(null);
      try {
        const data = await loadTransportCoverage({ lat: hub.lat, lon: hub.lon, radiusKm: coverageRadius }, { signal: request.signal, force });
        if (cancelled || viewer.isDestroyed()) return;
        const [toll, railway] = await Promise.all([
          C.GeoJsonDataSource.load(data.toll, { stroke: C.Color.fromCssColorString('#f97316').withAlpha(0.8), strokeWidth: 3, clampToGround: true, credit: 'OpenStreetMap contributors' }),
          C.GeoJsonDataSource.load(data.railway, { stroke: C.Color.fromCssColorString('#facc15'), strokeWidth: 3, clampToGround: true, credit: 'OpenStreetMap contributors' }),
        ]);
        if (cancelled || viewer.isDestroyed()) return;
        railway.entities.values.forEach((entity: any) => {
          if (!entity.billboard) return;
          entity.billboard = undefined;
          entity.point = new C.PointGraphics({ pixelSize: 6, color: C.Color.fromCssColorString('#fef08a'), outlineColor: C.Color.fromCssColorString('#713f12'), outlineWidth: 1, heightReference: C.HeightReference.CLAMP_TO_GROUND });
        });
        toll.show = false;
        railway.show = false;
        await Promise.all([viewer.dataSources.add(toll), viewer.dataSources.add(railway)]);
        if (cancelled || viewer.isDestroyed()) {
          if (!viewer.isDestroyed()) { viewer.dataSources.remove(toll, true); viewer.dataSources.remove(railway, true); }
          return;
        }
        const previous = transportSourcesRef.current;
        transportSourcesRef.current = { toll, railway, areaKey: `${hub.lat},${hub.lon},${coverageRadius}` };
        toll.show = transportVisibleRef.current.toll;
        railway.show = transportVisibleRef.current.railway;
        if (previous) { viewer.dataSources.remove(previous.toll, true); viewer.dataSources.remove(previous.railway, true); }
        setTransportInfo({ toll: data.toll.features.length, railway: data.railway.features.length, timestamp: data.timestamp, fetchedAt: data.fetchedAt });
        setTransportStatus('ready');
      } catch (error) {
        if (cancelled || viewer.isDestroyed()) return;
        setTransportStatus('error');
        setTransportError(timedOut ? 'Overpass kehabisan waktu. Coba radius lebih kecil lalu Refresh.' : error instanceof Error ? error.message : 'Data Overpass gagal dimuat.');
      } finally { clearTimeout(timeout); }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timeout); request.abort(); };
  }, [status, hub.lat, hub.lon, coverageRadius, coverageRefresh, needsTransport]);

  // Requirement 1 & 3: 3-Second Trim Path animation with Orange Glow & Leading Marker
  const runTrimPathRoute = (Cesium: any, coords: [number, number][]) => {
    const viewer = viewerRef.current;
    if (!viewer || coords.length < 2) return;

    // Clean up previous routes & trails
    if (routeEntitiesRef.current.length) {
      routeEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      routeEntitiesRef.current = [];
    }
    if (trailEntityRef.current) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);

    const cumulative = buildCumulative(coords);
    const totalDist = cumulative[cumulative.length - 1] || 1;
    const durationMs = 3000; // Exactly 3 seconds

    let activePositions: any[] = [
      Cesium.Cartesian3.fromDegrees(coords[0][0], coords[0][1], ROUTE_HEIGHT_M),
    ];
    let headPosition = Cesium.Cartesian3.fromDegrees(coords[0][0], coords[0][1], ROUTE_HEIGHT_M + 2.5);

    // Outer Glow Neon Polyline (Orange Glow directly on top of the road)
    const glowRoute = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => activePositions, false),
        width: 8,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.45,
          taperPower: 0.85,
          color: Cesium.Color.fromCssColorString('#ff5500'), // glowing neon orange
        }),
        clampToGround: false,
      },
    });

    // Inner bright core line (gives radiant intense laser look)
    const coreRoute = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => activePositions, false),
        width: 3,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#ffb347')),
        clampToGround: false,
      },
    });

    // Glowing tracer head marker ("buletan" leading the trim path)
    const tracerHead = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => headPosition, false),
      point: {
        pixelSize: 13,
        color: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#ff5500'),
        outlineWidth: 4,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    routeEntitiesRef.current = [glowRoute, coreRoute];
    trailEntityRef.current = tracerHead;

    let startedAt = 0;
    const step = (now: number) => {
      if (!startedAt) startedAt = now;
      const t = Math.min((now - startedAt) / durationMs, 1);
      // Smooth cubic easing for motion graphics trim-path effect
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const targetDist = totalDist * eased;

      // Find segment index along path
      let lo = 0;
      let hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumulative[mid] < targetDist) lo = mid + 1;
        else hi = mid;
      }
      const segIndex = Math.max(1, lo);
      const span = cumulative[segIndex] - cumulative[segIndex - 1] || 1;
      const segT = Math.max(0, Math.min(1, (targetDist - cumulative[segIndex - 1]) / span));
      const headLon = coords[segIndex - 1][0] + (coords[segIndex][0] - coords[segIndex - 1][0]) * segT;
      const headLat = coords[segIndex - 1][1] + (coords[segIndex][1] - coords[segIndex - 1][1]) * segT;

      const flat: number[] = [];
      for (let k = 0; k < segIndex; k++) {
        flat.push(coords[k][0], coords[k][1], ROUTE_HEIGHT_M);
      }
      flat.push(headLon, headLat, ROUTE_HEIGHT_M);

      activePositions = Cesium.Cartesian3.fromDegreesArrayHeights(flat);
      headPosition = Cesium.Cartesian3.fromDegrees(headLon, headLat, ROUTE_HEIGHT_M + 2.5);

      if (t < 1) {
        trailAnimRef.current = requestAnimationFrame(step);
      } else {
        // Complete full route
        const fullFlat: number[] = [];
        coords.forEach(([cLon, cLat]) => fullFlat.push(cLon, cLat, ROUTE_HEIGHT_M));
        activePositions = Cesium.Cartesian3.fromDegreesArrayHeights(fullFlat);
        headPosition = Cesium.Cartesian3.fromDegrees(
          coords[coords.length - 1][0],
          coords[coords.length - 1][1],
          ROUTE_HEIGHT_M + 2.5
        );
        trailAnimRef.current = null;
      }
    };

    trailAnimRef.current = requestAnimationFrame(step);
  };

  const flyToRouteSphere = (sphere: any, duration = 3, complete?: () => void) => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (!viewer || viewer.isDestroyed() || autoRotateRef.current) return;
    const camera = viewer.camera;
    const oldPosition = camera.positionWC.clone();
    const oldDirection = camera.directionWC.clone();
    const oldUp = camera.upWC.clone();
    positionRouteCamera(viewer, C, sphere, 0, null);
    const destination = camera.positionWC.clone();
    const direction = camera.directionWC.clone();
    const up = camera.upWC.clone();
    camera.setView({ destination: oldPosition, orientation: { direction: oldDirection, up: oldUp } });
    camera.flyTo({ destination, orientation: { direction, up }, duration, complete, easingFunction: C.EasingFunction.QUADRATIC_IN_OUT });
  };

  // Requirement 2 & 5: Blocking & Framing diperbaiki — Center both Point A & B with Cloud Depth
  const selectDestination = async (poi: Poi) => {
    const Cesium = (window as any).Cesium;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;

    if (window.innerWidth < 1000) setSidebarOpen(false);
    introGenerationRef.current++;
    setActivePoi(poi.id);
    activePoiRef.current = poi.id;
    orbitRangeRef.current = null;
    freeRoamSphereRef.current = null;
    setRouteInfo(null);
    routeRequestRef.current?.abort();
    const request = new AbortController();
    routeRequestRef.current = request;
    const timeout = setTimeout(() => request.abort(), 10000);

    if (routeEntitiesRef.current.length) {
      routeEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      routeEntitiesRef.current = [];
    }
    if (trailEntityRef.current) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);

    let coords: [number, number][] = [];
    let distanceKm = 0;
    let durationMin = 0;

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${hubRef.current.lon},${hubRef.current.lat};${poi.lon},${poi.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: request.signal });
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const data = await res.json();
      const geom = data?.routes?.[0]?.geometry?.coordinates as [number, number][];
      if (!geom?.length) throw new Error('Rute kosong');

      distanceKm = data.routes[0].distance / 1000;
      durationMin = data.routes[0].duration / 60;
      coords = geom;
    } catch {
      coords = [
        [hubRef.current.lon, hubRef.current.lat],
        [poi.lon, poi.lat],
      ];
      distanceKm = haversineKm([hubRef.current.lon, hubRef.current.lat], [poi.lon, poi.lat]) * 1.25;
      durationMin = (distanceKm / 35) * 60;
    }

    clearTimeout(timeout);
    if (window.innerWidth < 1000) await new Promise(resolve => setTimeout(resolve, 320));
    if (routeRequestRef.current !== request || viewer.isDestroyed()) return;
    setRouteInfo({ distanceKm, durationMin });
    const positions = [...coords, [hubRef.current.lon, hubRef.current.lat], [poi.lon, poi.lat]].map(([lon, lat]) =>
      Cesium.Cartesian3.fromDegrees(lon, lat, 75));
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    sphere.radius = Math.max(sphere.radius, 250);
    routeSphereRef.current = sphere;

    if (!autoRotateRef.current) flyToRouteSphere(sphere);

    // Run the 3-second Trim Path animation in sync with camera flight
    runTrimPathRoute(Cesium, coords);
  };

  const setFreeRoam = () => {
    introGenerationRef.current++;
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      viewer.camera.cancelFlight();
    }
    if (routeEntitiesRef.current.length && viewer) {
      routeEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      routeEntitiesRef.current = [];
    }
    if (trailEntityRef.current && viewer) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
    routeRequestRef.current?.abort();
    routeRequestRef.current = null;
    routeSphereRef.current = null;
    freeRoamSphereRef.current = null;
    orbitRangeRef.current = null;
    activePoiRef.current = null;
    setActivePoi(null);
    setRouteInfo(null);
  };

  const resetToHub = () => {
    introGenerationRef.current++;
    const Cesium = (window as any).Cesium;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    if (routeEntitiesRef.current.length) {
      routeEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      routeEntitiesRef.current = [];
    }
    if (trailEntityRef.current) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
    routeRequestRef.current?.abort();
    routeRequestRef.current = null;
    routeSphereRef.current = null;
    freeRoamSphereRef.current = null;
    orbitRangeRef.current = null;
    activePoiRef.current = null;
    setActivePoi(null);
    setRouteInfo(null);

    if (!autoRotateRef.current) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat - 0.016, 1150.0),
        orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-32), roll: 0 },
        duration: 2.5,
      });
    }
  };

  const replayIntro = () => {
    const C = (window as any).Cesium;
    const viewer = viewerRef.current;
    if (!C || !viewer) return;
    routeRequestRef.current?.abort();
    routeRequestRef.current = null;
    routeEntitiesRef.current.forEach(entity => viewer.entities.remove(entity));
    routeEntitiesRef.current = [];
    if (trailEntityRef.current) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
    routeSphereRef.current = null;
    freeRoamSphereRef.current = null;
    orbitRangeRef.current = null;
    activePoiRef.current = null;
    setActivePoi(null);
    setRouteInfo(null);
    autoRotateRef.current = false;
    setAutoRotate(false);
    viewer.camera.cancelFlight();
    viewer.__playGlobeIntro(C);
  };

  // Bird-Eye Overview (Pandangan burung tinggi di atas kota dan lapisan awan ~14.5km)
  const flyToMacroOverview = () => {
    if (autoRotateRef.current) return;
    const Cesium = (window as any).Cesium;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat - 0.045, 14500.0),
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-40.0),
        roll: 0.0,
      },
      duration: 2.8,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
    });
  };

  // Auto-Rotate loop (smooth orbit around current focus point)
  useEffect(() => {
    let animId: number;
    let lastTime = 0;

    const loop = (now: number) => {
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
      lastTime = now;

      if (autoRotateRef.current && viewerRef.current) {
        const viewer = viewerRef.current;
        const Cesium = (window as any).Cesium;
        if (Cesium && viewer && !viewer.isDestroyed()) {
          viewer.camera.cancelFlight();
          const sphere = routeSphereRef.current || freeRoamSphereRef.current || getFreeRoamSphere(viewer, Cesium, hubRef.current);
          freeRoamSphereRef.current = sphere;
          orbitHeadingRef.current += 0.15 * rotateSpeedRef.current * dt;
          const camera = viewer.camera;
          const previousPosition = camera.positionWC.clone();
          const previousDirection = camera.directionWC.clone();
          const previousUp = camera.upWC.clone();
          positionRouteCamera(viewer, Cesium, sphere, orbitHeadingRef.current, orbitRangeRef.current);
          const blend = 1 - Math.exp(-6.0 * dt);
          const destination = Cesium.Cartesian3.lerp(previousPosition, camera.positionWC, blend, new Cesium.Cartesian3());
          const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.lerp(previousDirection, camera.directionWC, blend, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          const blendedUp = Cesium.Cartesian3.lerp(previousUp, camera.upWC, blend, new Cesium.Cartesian3());
          const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(direction, blendedUp, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          camera.setView({ destination, orientation: { direction, up } });
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Format recording timer MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Video recording handler (60fps canvas + tooltips, UI hidden)
  const startRecording = async () => {
    introGenerationRef.current++;
    setShowRecordModal(false);
    const viewer = viewerRef.current;
    const Cesium = (window as any).Cesium;
    if (!viewer || !Cesium || recordingSessionRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // ignore fullscreen rejection
    }

    // Sidebar stays visible on screen for user interaction — it won't appear in the recorded MP4
    // because we only capture the Cesium canvas + drawn tooltips on the recording canvas

    if (viewer.isDestroyed()) return;
    viewer.resize();
    const cesiumCanvas = viewer.canvas;
    const recCanvas = document.createElement('canvas');
    recCanvas.width = cesiumCanvas.width;
    recCanvas.height = cesiumCanvas.height;
    recordCanvasRef.current = recCanvas;

    setRecordError(null);

    // Frame drawing loop
    const drawRecordFrame = () => {
      if (!recordCanvasRef.current || viewer.isDestroyed()) return;
      const curRecCanvas = recordCanvasRef.current;
      const curCesiumCanvas = viewer.canvas;
      const ctx = curRecCanvas.getContext('2d');
      if (!ctx) return;

      // 1. Draw Cesium canvas (Earth, clouds, road neon orange trim path)
      ctx.drawImage(curCesiumCanvas, 0, 0, curRecCanvas.width, curRecCanvas.height);
      ctx.save();
      ctx.scale(curRecCanvas.width / curCesiumCanvas.clientWidth, curRecCanvas.height / curCesiumCanvas.clientHeight);

      // 2. Draw 3D pins on video if tooltips are enabled
      if (showTooltipsRef.current) {
        const camHeight = viewer.camera.positionCartographic.height;
        if (camHeight <= 75000) {
          const allLocs = [...POIS.filter(p => !onlyABRef.current && p.id !== activePoiRef.current), hubRef.current, ...POIS.filter(p => p.id === activePoiRef.current)];
          allLocs.forEach((loc) => {
            const cartesian = Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, loc.height || 60);
            const pos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
            if (pos && pos.x >= -100 && pos.x <= curRecCanvas.width + 100 && pos.y >= -100 && pos.y <= curRecCanvas.height + 100) {
              const isHub = loc.id === 'hub';
              const isActive = activePoiRef.current === loc.id;

              ctx.save();
              // Vertical pole line
              ctx.beginPath();
              ctx.moveTo(pos.x, pos.y);
              ctx.lineTo(pos.x, pos.y - 36);
              ctx.lineWidth = 2;
              ctx.strokeStyle = isActive ? '#ff5500' : isHub ? '#ff9900' : 'rgba(255,255,255,0.95)';
              ctx.shadowColor = 'rgba(0,0,0,0.5)';
              ctx.shadowBlur = 4;
              ctx.stroke();

              // Dot on ground
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, isActive ? 6 : isHub ? 5 : 4, 0, Math.PI * 2);
              ctx.fillStyle = isActive ? '#ff5500' : isHub ? '#ff9900' : '#ffffff';
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.strokeStyle = '#0f172a';
              ctx.stroke();

              // Pill badge
              let name = loc.name;
              ctx.font = '400 12px Geist, sans-serif';
              if (ctx.measureText(name).width > 200) {
                while (name.length > 1 && ctx.measureText(name + '...').width > 200) name = name.slice(0, -1);
                name += '...';
              }
              const textWidth = ctx.measureText(name).width;
              const pillW = Math.max(textWidth + 24, 60);
              const pillH = 26;
              const pillX = pos.x - pillW / 2;
              const pillY = pos.y - 36 - pillH;

              ctx.beginPath();
              ctx.roundRect(pillX, pillY, pillW, pillH, 13);
              ctx.fillStyle = isActive ? 'rgba(255, 85, 0, 0.95)' : darkGlassRef.current ? 'rgba(15,23,42,.9)' : 'rgba(255,255,255,.9)';
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = isActive ? '#ffa044' : isHub ? '#ff9900' : 'rgba(255, 255, 255, 0.95)';
              ctx.shadowColor = 'rgba(0,0,0,0.2)';
              ctx.shadowBlur = 6;
              ctx.stroke();

              ctx.fillStyle = isActive || darkGlassRef.current ? '#ffffff' : '#0f172a';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.shadowBlur = 0;
              ctx.fillText(name, pos.x, pillY + pillH / 2);
              ctx.restore();
            }
          });
        }
      }

      ctx.restore();
      ctx.save();
      ctx.font = '12px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,.65)';
      ctx.fillRect(0, curRecCanvas.height - 24, curRecCanvas.width, 24);
      ctx.fillStyle = '#fff';
      ctx.fillText('Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community | Routing: OSRM / OpenStreetMap', 8, curRecCanvas.height - 8);
      ctx.restore();
      recordAnimRef.current = requestAnimationFrame(drawRecordFrame);
    };

    try {
      drawRecordFrame();
      recordingSessionRef.current = startMp4Recording(recCanvas, {
        onTick: setRecordingSeconds,
        onError: (error) => { finishRecording(); setRecordError(error.message); },
        onComplete: (blob) => {
          finishRecording();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `BSD_City_Cinematic_${Date.now()}.mp4`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        },
      });
      setIsRecording(true);
      setRecordingSeconds(0);

      if (recordWithEarthIntro && !autoRotateRef.current) {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat, 6500000.0),
          orientation: {
            heading: 0.0,
            pitch: Cesium.Math.toRadians(-90.0),
            roll: 0.0,
          },
        });
        recordingIntroRef.current = setTimeout(() => {
          if (viewer.isDestroyed() || !recordingSessionRef.current || autoRotateRef.current) return;
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat, 2500.0),
            orientation: {
              heading: Cesium.Math.toRadians(0.0),
              pitch: Cesium.Math.toRadians(-90.0),
              roll: 0.0,
            },
            duration: 3.2,
            easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
            complete: () => {
              if (viewer.isDestroyed() || !recordingSessionRef.current || autoRotateRef.current) return;
              if (routeSphereRef.current) { flyToRouteSphere(routeSphereRef.current, 1.6, viewer.__onIntroArrived); return; }
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat - 0.012, 1050.0),
                orientation: {
                  heading: Cesium.Math.toRadians(0.0),
                  pitch: Cesium.Math.toRadians(-38.0),
                  roll: 0.0,
                },
                duration: 1.6,
                easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
                complete: viewer.__onIntroArrived,
              });
            },
          });
        }, 600);
      }
    } catch (err) {
      finishRecording();
      setRecordError(err instanceof Error ? err.message : 'Rekaman MP4 gagal dimulai.');
    }
  };

  const finishRecording = () => {
    if (recordAnimRef.current) cancelAnimationFrame(recordAnimRef.current);
    if (recordingIntroRef.current) clearTimeout(recordingIntroRef.current);
    recordCanvasRef.current = null;
    recordingSessionRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };

  const stopRecording = () => { recordingSessionRef.current?.stop(); };

  const persistPreferences = (point: StartPoint, arrival: boolean) => {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ hub: point, autoRotateOnArrival: arrival }));
      return true;
    } catch { setHubMessage('Titik aktif, tetapi browser menolak penyimpanan. Perubahan akan hilang setelah reload.'); return false; }
  };

  const saveStartingPoint = () => {
    try {
      const point = parseStartPoint(hubName, hubLatitude, hubLongitude);
      hubRef.current = point;
      setHub(point);
      autoRotateRef.current = false;
      setAutoRotate(false);
      viewerRef.current?.camera.cancelFlight();
      resetToHub();
      setPlaceResults([]);
      if (persistPreferences(point, autoArrivalRef.current)) setHubMessage('Titik awal tersimpan di browser ini.');
    } catch (error) { setHubMessage(error instanceof Error ? error.message : 'Koordinat tidak valid.'); }
  };

  const searchStartingPoint = async () => {
    const query = placeQuery.trim();
    if (query.length < 3 || searchBusy) return;
    if (searchCacheRef.current.has(query)) { setPlaceResults(searchCacheRef.current.get(query)!); return; }
    searchRequestRef.current?.abort();
    const request = new AbortController();
    searchRequestRef.current = request;
    const timeout = setTimeout(() => request.abort(), 12000);
    setSearchBusy(true);
    setPlaceResults([]);
    setHubMessage('Mencari tempat...');
    try {
      const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lat=${hubRef.current.lat}&lon=${hubRef.current.lon}`, { signal: request.signal });
      if (!response.ok) throw new Error('Pencarian sementara tidak tersedia. Masukkan koordinat secara manual.');
      const data = await response.json();
      const points: StartPoint[] = [];
      for (const feature of data.features || []) {
        const [lon, lat] = feature.geometry?.coordinates || [];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const props = feature.properties || {};
        const label = [props.name || props.street, props.city || props.state, props.country].filter(Boolean).join(', ');
        points.push(parseStartPoint(label || query, String(lat), String(lon)));
      }
      if (searchRequestRef.current !== request) return;
      searchCacheRef.current.set(query, points);
      setPlaceResults(points);
      setHubMessage(points.length ? 'Pilih hasil, lalu simpan titik awal.' : 'Tempat tidak ditemukan. Coba nama kota atau koordinat manual.');
    } catch (error) {
      if (searchRequestRef.current === request) setHubMessage(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Pencarian kehabisan waktu. Coba lagi atau masukkan koordinat.');
    } finally {
      clearTimeout(timeout);
      if (searchRequestRef.current === request) setSearchBusy(false);
    }
  };

  const pinSub = (loc: { id: string; sub?: string } & Partial<Poi>): string => {
    if (loc.id === 'hub') return 'Starting Point';
    if (activePoi === loc.id && routeInfo) return `~${Math.round(routeInfo.durationMin)} min · ${routeInfo.distanceKm.toFixed(1)} km`;
    if (hub.lat !== DEFAULT_START_POINT.lat || hub.lon !== DEFAULT_START_POINT.lon) return '';
    return `~${(loc as Poi).estTime} · ${(loc as Poi).estDist}`;
  };

  return (
    <div className={`cesium-showcase ${darkGlass ? 'theme-dark' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div ref={containerRef} className="map" />

      {/* Pole pins overlay */}
      <div className={`pins transition-opacity duration-300 ${showTooltips ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {[hub, ...POIS].map((loc) => (
          <div
            key={loc.id}
            ref={(el) => {
              pinRefs.current[loc.id] = el;
            }}
            className={`pole ${loc.id === 'hub' ? 'hub' : ''} ${activePoi === loc.id ? 'active' : ''}`}
            onClick={() => {
              if (loc.id === 'hub') {
                if (activePoi !== null) setFreeRoam();
                else resetToHub();
              } else {
                if (activePoi === loc.id) setFreeRoam();
                else selectDestination(loc as Poi);
              }
            }}
          >
            <div className="pole-label">
              <span>{loc.id === 'hub' ? loc.name : (loc as Poi).name}</span>
              <span className="pole-sub">{pinSub(loc)}</span>
            </div>
            <div className="pole-line" />
            <div className="pole-dot" />
          </div>
        ))}
      </div>

      {recordError && <div role="alert" className="absolute bottom-5 right-4 z-40 max-w-sm rounded-xl bg-red-950/95 p-4 text-xs text-white">
        {recordError}<button type="button" className="ml-3 underline" onClick={() => setRecordError(null)}>Tutup</button>
      </div>}

      {/* Floating Presentation Recording HUD */}
      {isRecording && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-red-500/50 bg-slate-950/85 px-5 py-2 shadow-2xl backdrop-blur-2xl ring-2 ring-red-500/30 text-white">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
            <span className="text-[11px] font-bold tracking-widest uppercase text-red-400">REC</span>
            <span className="font-mono text-xs font-semibold text-white/90">{formatTime(recordingSeconds)} / {formatTime(RECORDING_SECONDS)}</span>
          </div>
          <div className="h-3.5 w-px bg-white/20" />
          <span className="text-[11px] text-white/70 hidden sm:inline">Clean Presentation Mode</span>
          <button
            onClick={stopRecording}
            className="flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 px-3 py-1 text-xs font-bold text-white shadow-lg transition active:scale-95"
          >
            <span>⏹️</span>
            <span>Stop & Simpan MP4</span>
          </button>
        </div>
      )}

      {/* Record Setup Modal */}
      {showRecordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/80 bg-white/95 p-5 shadow-2xl backdrop-blur-2xl text-slate-800">
            <div className="flex items-center gap-2 mb-2 font-bold text-base text-slate-900">
              <span className="flex h-3 w-3 rounded-full bg-red-600 animate-pulse" />
              <span>Rekam Video Sinematik (MP4)</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              MP4 otomatis berhenti dan tersimpan setelah 60 detik; bisa dihentikan lebih awal. Target 60 FPS mengikuti kemampuan perangkat. Panel kontrol tidak masuk video; rute, pin, dan atribusi peta tetap terekam.
            </p>

            <div className="space-y-2.5 mb-5 text-xs font-medium text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={recordWithEarthIntro}
                  onChange={(e) => setRecordWithEarthIntro(e.target.checked)}
                  className="rounded accent-[#ff5500] w-4 h-4 cursor-pointer"
                />
                <span>Mulai dari luar angkasa (dilewati saat autorotate aktif)</span>
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowRecordModal(false)}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 transition"
              >
                Batal
              </button>
              <button
                onClick={startRecording}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-red-500/25 transition active:scale-95"
              >
                <span>⏺️</span>
                <span>Mulai Merekam</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Left Sidebar — always visible on screen, even during recording (recording only captures Cesium canvas) */}
      <div
        className={`absolute top-5 left-4 bottom-5 z-20 transition-all duration-300 ease-in-out ${sidebarOpen
            ? 'w-[290px] translate-x-0'
            : 'w-[290px] -translate-x-[306px]'
          }`}
      >
        {/* Toggle Button attached to sidebar right edge (White Frosted Glass) */}
        <button
          onClick={() => {
            setSidebarOpen(!sidebarOpen);
          }}
          className="absolute -right-7 top-4 z-30 flex h-7 w-7 items-center justify-center rounded-r-2xl border-y border-r border-white/70 bg-white/60 text-xs font-medium text-slate-800 shadow-xl backdrop-blur-2xl transition hover:bg-white/85"
          title={sidebarOpen ? 'Sembunyikan Panel' : 'Buka Panel'}
        >
          {sidebarOpen ? '‹' : '›'}
        </button>

        <aside className="navigation-panel h-full w-full flex flex-col rounded-2xl border border-white/70 bg-white/40 text-slate-800 shadow-[0_16px_40px_0_rgba(0,0,0,0.18)] backdrop-blur-2xl ring-1 ring-white/60 overflow-hidden">
          {/* Top scrollable POI area */}
          <div className="flex-1 overflow-y-auto p-4 cesium-glass-scroll">
            {settingsOpen ? (
      <section className="settings-panel" aria-label="Pengaturan surrounding area">
        <div className="flex items-center justify-between border-b border-slate-500/20 pb-3 text-[11px] font-medium uppercase tracking-wider">
          <span>Surrounding settings</span>
          <button type="button" aria-label="Kembali ke Surrounding Area" onClick={() => setSettingsOpen(false)} className="rounded-lg px-2 py-1 text-base">×</button>
        </div>
        <div className="mt-2">
          <button type="button" onClick={() => setSettingsOpen(false)} className="mb-3 text-xs font-medium text-orange-600">← Kembali ke Surrounding Area</button>
          {[
            { label: 'Marker / batas BSD', value: showBsd, toggle: () => setShowBsd(!showBsd) },
            { label: 'Rel kereta & stasiun', value: showRailways, toggle: () => setShowRailways(!showRailways) },
            { label: 'Jalan tol', value: showTolls, toggle: () => setShowTolls(!showTolls) },
            { label: 'Nama kecamatan', value: showDistricts, toggle: () => setShowDistricts(!showDistricts) },
            { label: 'Label Esri / Informatif', value: showEsriLabels, toggle: () => setShowEsriLabels(!showEsriLabels) },
            { label: 'Tooltip A-B saja', value: onlyABTooltips, toggle: () => setOnlyABTooltips(!onlyABTooltips) },
            { label: 'Dark glassmorphism', value: darkGlass, toggle: () => setDarkGlass(!darkGlass) },
          ].map(setting => <button key={setting.label} type="button" role="switch" aria-checked={setting.value} className="layer-switch" onClick={setting.toggle}>
            <span>{setting.label}</span><span aria-hidden="true" className={`switch-track ${setting.value ? 'on' : ''}`}><span /></span>
          </button>)}
          <p className="mt-3 text-[11px] opacity-70">{showEsriLabels ? 'Informatif: nama tempat & batas wilayah Esri.' : 'Clean: citra satelit tanpa label Esri.'}</p>
          <div className="mt-4 border-t border-slate-500/20 pt-3 text-xs">
            <label className="flex items-center justify-between gap-2">Radius data OSM
              <select aria-label="Radius data OSM" value={coverageRadius} onChange={event => setCoverageRadius(Number(event.target.value))} className="rounded-lg border border-slate-400/50 bg-white/60 px-2 py-1 text-slate-800">
                {COVERAGE_RADII.map(radius => <option key={radius} value={radius}>{radius} km</option>)}
              </select>
            </label>
            <p className="mt-2 text-[11px] opacity-75">Pusat: {hub.name}. Tol, rel & stasiun dalam radius {coverageRadius} km dari titik awal.</p>
            <button type="button" disabled={!needsTransport || transportStatus === 'loading'} onClick={() => setCoverageRefresh(version => version + 1)} className="mt-3 w-full rounded-lg bg-orange-600 px-3 py-2 font-medium text-white disabled:opacity-40">Refresh data Overpass</button>
            {needsTransport && transportStatus === 'loading' && <p role="status" className="mt-2 text-[11px]">Mengambil data OpenStreetMap radius {coverageRadius} km...</p>}
            {needsTransport && transportStatus === 'error' && <p role="alert" className="mt-2 text-[11px] text-red-600">{transportError}</p>}
            {needsTransport && transportStatus === 'ready' && transportInfo && <p role="status" className="mt-2 text-[11px] opacity-80">
              {transportInfo.toll} segmen tol / ramp; {transportInfo.railway} fitur rel & stasiun.
              <br />Diambil: {new Date(transportInfo.fetchedAt).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.
              {transportInfo.timestamp && <><br />Data OSM: {new Date(transportInfo.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.</>}
            </p>}
            <p className="mt-2 text-[10px] opacity-60">Cache cakupan 10 menit. Refresh mengambil ulang dari server. Kecamatan masih memakai data referensi proyek.</p>
          </div>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="mt-3 block text-[10px] underline opacity-70">© OpenStreetMap contributors / ODbL</a>
        </div>
      </section>
            ) : <>
            <div className="flex items-center justify-between pb-3 border-b border-slate-900/10 mb-3.5">
              <h1 className="text-xs font-medium uppercase tracking-wider text-slate-800">
                Surrounding Area
              </h1>
              <button type="button" aria-label="Buka pengaturan layer" aria-expanded={settingsOpen} onClick={() => {
                setSettingsOpen(true);
              }} className="rounded-lg px-2 py-1 text-base" title="Pengaturan layer">⚙</button>
            </div>

            {/* Hub */}
            <div className="flex items-center justify-between mt-1 mb-1.5">
              <h3 className="text-[10px] uppercase tracking-wider font-medium text-slate-500">
                Starting Point (Hub)
              </h3>
              {activePoi !== null && (
                <span className="text-[10px] text-orange-600 font-medium">Rute Aktif</span>
              )}
            </div>
            <div
              className={`flex items-center justify-between rounded-xl px-3 py-2.5 mb-2 cursor-pointer text-[12.5px] font-normal border transition-all duration-200 ${activePoi === null
                  ? 'bg-slate-900 text-white border-slate-800 shadow-md font-medium'
                  : 'bg-white/45 border-white/70 text-slate-800 hover:bg-white/75 hover:border-white shadow-sm'
                }`}
              onClick={resetToHub}
            >
              <span className="truncate mr-2">{hub.name}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-[11px] ${activePoi === null ? 'text-white/80' : 'text-slate-500 font-normal'}`}>0 km</span>
                {activePoi !== null && (
                  <button
                    type="button"
                    title="Keluar ke Free Roam (Hapus Rute)"
                    aria-label="Free roam / Batalkan rute"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFreeRoam();
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded-md bg-red-500/15 hover:bg-red-500 text-red-600 hover:text-white transition text-xs font-semibold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <button type="button" onClick={() => setHubEditorOpen(!hubEditorOpen)} aria-expanded={hubEditorOpen} className="mb-2 w-full rounded-lg border border-white/50 bg-white/45 px-3 py-2 text-left text-xs font-normal text-slate-800">
              Ubah titik awal <span className="float-right">{hubEditorOpen ? '\u2212' : '+'}</span>
            </button>
            {hubEditorOpen && <div className="mb-3 space-y-2 rounded-xl border border-white/50 bg-white/45 p-3 text-xs text-slate-800">
              <form onSubmit={event => { event.preventDefault(); void searchStartingPoint(); }} className="flex gap-1.5">
                <input aria-label="Cari tempat titik awal" value={placeQuery} onChange={event => setPlaceQuery(event.target.value)} placeholder="Cari tempat / alamat" minLength={3} className="min-w-0 flex-1 rounded-lg border border-slate-400/40 bg-white/60 px-2 py-2 text-slate-800" />
                <button type="submit" disabled={searchBusy || placeQuery.trim().length < 3} className="rounded-lg bg-slate-900 px-3 text-white disabled:opacity-40">{searchBusy ? '...' : 'Cari'}</button>
              </form>
              {placeResults.map((point, index) => <button key={`${point.lon}-${point.lat}-${index}`} type="button" onClick={() => {
                setHubName(point.name); setHubLatitude(String(point.lat)); setHubLongitude(String(point.lon)); setPlaceResults([]);
              }} className="block w-full rounded-lg bg-white/60 p-2 text-left text-slate-800">{point.name}</button>)}
              <p className="text-[10px] opacity-70">Pencarian: <a href="https://photon.komoot.io" target="_blank" rel="noreferrer" className="underline">Photon</a> / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a></p>
              <form onSubmit={event => { event.preventDefault(); saveStartingPoint(); }} className="space-y-2">
                <label className="block">Nama titik awal<input value={hubName} onChange={event => setHubName(event.target.value)} maxLength={100} className="mt-1 w-full rounded-lg border border-slate-400/40 bg-white/60 p-2 text-slate-800" /></label>
                <label className="block">Latitude<input value={hubLatitude} onChange={event => setHubLatitude(event.target.value)} type="number" min={-90} max={90} step="any" required className="mt-1 w-full rounded-lg border border-slate-400/40 bg-white/60 p-2 text-slate-800" /></label>
                <label className="block">Longitude<input value={hubLongitude} onChange={event => setHubLongitude(event.target.value)} type="number" min={-180} max={180} step="any" required className="mt-1 w-full rounded-lg border border-slate-400/40 bg-white/60 p-2 text-slate-800" /></label>
                <button type="submit" disabled={status !== 'ready'} className="w-full rounded-lg bg-orange-600 px-3 py-2 font-medium text-white disabled:opacity-40">Simpan titik awal</button>
              </form>
            </div>}
            <label className="mb-2 flex cursor-pointer items-start gap-2 text-[11px] text-slate-800">
              <input type="checkbox" checked={autoRotateOnArrival} onChange={event => {
                const checked = event.target.checked;
                autoArrivalRef.current = checked;
                setAutoRotateOnArrival(checked);
                if (persistPreferences(hub, checked)) setHubMessage('Pilihan autorotate tersimpan.');
              }} className="mt-0.5 accent-orange-600" />
              Autorotate otomatis setelah intro sampai
            </label>
            {hubMessage && <p role="status" className="mb-3 text-[11px] text-slate-700">{hubMessage}</p>}

            {/* Near POIs */}
            <h3 className="mt-3.5 mb-1.5 text-[10px] uppercase tracking-wider font-medium text-slate-500">
              Destinasi sekitar BSD
            </h3>
            <div className="space-y-1.5">
              {POIS.filter((p) => p.category === 'near').map((poi) => {
                const isActive = activePoi === poi.id;
                return (
                  <div
                    key={poi.id}
                    className={`flex items-center justify-between rounded-xl px-3 py-2 cursor-pointer text-[12.5px] font-normal border transition-all duration-200 ${isActive
                        ? 'bg-gradient-to-r from-[#ff5500] to-[#ff7700] border-[#ffa044] text-white shadow-[0_4px_22px_rgba(255,85,0,0.45)] font-medium scale-[1.02]'
                        : 'bg-white/45 border-white/70 text-slate-800 hover:bg-white/75 hover:border-white shadow-sm hover:shadow-md'
                      }`}
                    onClick={() => {
                      if (isActive) {
                        setFreeRoam();
                      } else {
                        selectDestination(poi);
                      }
                    }}
                  >
                    <span className="truncate font-normal">{poi.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1">
                      <span className={`text-[11px] ${isActive ? 'text-white/90 font-medium' : 'text-slate-500'}`}>{hub.lat === DEFAULT_START_POINT.lat && hub.lon === DEFAULT_START_POINT.lon ? `~${poi.estTime}` : ''}</span>
                      {isActive && (
                        <span title="Batal ke Free Roam" className="text-xs text-white/80 hover:text-white font-bold ml-0.5">✕</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Far POIs */}
            <h3 className="mt-3.5 mb-1.5 text-[10px] uppercase tracking-wider font-medium text-slate-500">
              Greater Access (Tol / Bandara)
            </h3>
            <div className="space-y-1.5">
              {POIS.filter((p) => p.category === 'far').map((poi) => {
                const isActive = activePoi === poi.id;
                return (
                  <div
                    key={poi.id}
                    className={`flex items-center justify-between rounded-xl px-3 py-2 cursor-pointer text-[12.5px] font-normal border transition-all duration-200 ${isActive
                        ? 'bg-gradient-to-r from-[#ff5500] to-[#ff7700] border-[#ffa044] text-white shadow-[0_4px_22px_rgba(255,85,0,0.45)] font-medium scale-[1.02]'
                        : 'bg-white/45 border-white/70 text-slate-800 hover:bg-white/75 hover:border-white shadow-sm hover:shadow-md'
                      }`}
                    onClick={() => {
                      if (isActive) {
                        setFreeRoam();
                      } else {
                        selectDestination(poi);
                      }
                    }}
                  >
                    <span className="truncate font-normal">{poi.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1">
                      <span className={`text-[11px] ${isActive ? 'text-white/90 font-medium' : 'text-slate-500'}`}>{hub.lat === DEFAULT_START_POINT.lat && hub.lon === DEFAULT_START_POINT.lon ? `~${poi.estTime}` : ''}</span>
                      {isActive && (
                        <span title="Batal ke Free Roam" className="text-xs text-white/80 hover:text-white font-bold ml-0.5">✕</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            </>}
          </div>

          {/* Bottom Toolbar: 5 Tool Icons */}
          <div className="relative border-t border-slate-900/10 bg-white/50 p-2 backdrop-blur-md">
            {/* Auto-Rotate Speed Slider Popover */}
            {showRotateSlider && (
              <div className="absolute bottom-[60px] left-2 right-2 z-30 rounded-2xl border border-white/80 bg-white/95 p-3 shadow-xl backdrop-blur-2xl text-slate-800">
                <div className="flex items-center justify-between text-[11px] font-medium mb-1">
                  <span>Kecepatan Rotasi</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#ff5500] font-mono">{rotateSpeed.toFixed(1)}x</span>
                    <button
                      onClick={() => setShowRotateSlider(false)}
                      className="text-slate-400 hover:text-slate-700 text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="3.0"
                  step="0.1"
                  value={rotateSpeed}
                  onChange={(e) => setRotateSpeed(parseFloat(e.target.value))}
                  className="w-full accent-[#ff5500] h-1.5 bg-slate-200 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-slate-400 mt-1 font-semibold">
                  <span>Pelan (0.2x)</span>
                  <span>Normal (1.0x)</span>
                  <span>Kencang (3.0x)</span>
                </div>
              </div>
            )}

            {/* 5 Icons Grid */}
            <div className="grid grid-cols-5 gap-1.5">
              {/* 1. Mata Coret: Hide/Show Tooltip */}
              <button
                onClick={() => setShowTooltips(!showTooltips)}
                className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all active:scale-95 ${!showTooltips
                    ? 'bg-rose-50 border-rose-300 text-rose-600 shadow-sm'
                    : 'bg-white/60 border-white/80 text-slate-700 hover:bg-white hover:text-black shadow-sm'
                  }`}
                title={showTooltips ? 'Sembunyikan Pin & Tooltip (Mata Coret)' : 'Tampilkan Pin & Tooltip'}
              >
                {!showTooltips ? (
                  <svg className="w-4 h-4 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>

              {/* 2. Auto Rotate */}
              <button
                onClick={() => {
                  const next = !autoRotate;
                  autoRotateRef.current = next;
                  setAutoRotate(next);
                  if (next && viewerRef.current) {
                    const C = (window as any).Cesium;
                    if (C) {
                      viewerRef.current.camera.cancelFlight();
                      orbitHeadingRef.current = viewerRef.current.camera.heading || 0;
                      const sphere = routeSphereRef.current || freeRoamSphereRef.current || getFreeRoamSphere(viewerRef.current, C, hubRef.current);
                      freeRoamSphereRef.current = sphere;
                      orbitRangeRef.current = C.Cartesian3.distance(viewerRef.current.camera.positionWC, sphere.center);
                    }
                    setShowRotateSlider(true);
                  } else {
                    orbitRangeRef.current = null;
                    freeRoamSphereRef.current = null;
                  }
                }}
                className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all active:scale-95 ${autoRotate
                    ? 'bg-[#ff5500]/15 border-[#ff5500]/50 text-[#ff5500] shadow-sm'
                    : 'bg-white/60 border-white/80 text-slate-700 hover:bg-white hover:text-black shadow-sm'
                  }`}
                title="Auto-Rotate Kamera (Orbit 360)"
              >
                <svg className={`w-4 h-4 ${autoRotate ? 'animate-spin' : ''}`} style={autoRotate ? { animationDuration: `${Math.max(1, 4 / rotateSpeed)}s` } : {}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
              </button>

              {/* 3. Bird Eye (Icon Burung) */}
              <button
                onClick={flyToMacroOverview}
                className="flex flex-col items-center justify-center p-2 rounded-xl border border-white/80 bg-white/60 text-slate-700 hover:bg-white hover:text-black shadow-sm transition-all active:scale-95"
                title="Bird-Eye Cloud Overview (Burung)"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 7h.01" />
                  <path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 18Z" />
                  <path d="m20 7 2 .5-2 .5" />
                  <path d="M10 18v3" />
                  <path d="M14 17.75V21" />
                  <path d="M7 18a6 6 0 0 0 3.84-10.61" />
                </svg>
              </button>

              {/* 4. Zoom Earth (Icon Bumi) */}
              <button
                onClick={replayIntro}
                className="flex flex-col items-center justify-center p-2 rounded-xl border border-white/80 bg-white/60 text-slate-700 hover:bg-white hover:text-black shadow-sm transition-all active:scale-95"
                title="Zoom Earth dari Luar Angkasa (Bumi)"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </button>

              {/* 5. Record MP4 */}
              <button
                onClick={() => {
                  if (isRecording) stopRecording();
                  else setShowRecordModal(true);
                }}
                className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all active:scale-95 ${isRecording
                    ? 'bg-red-50 border-red-400 text-red-600 shadow-sm animate-pulse'
                    : 'bg-white/60 border-white/80 text-slate-700 hover:bg-white hover:text-black shadow-sm'
                  }`}
                title="Rekam Video MP4 (Presentation Mode)"
              >
                {isRecording ? (
                  <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-sm h-3 w-3 bg-red-600"></span>
                  </span>
                ) : (
                  <svg className="w-4 h-4 text-red-500 fill-red-500" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </aside>
      </div>



      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md">
          <div className="rounded-2xl border border-white/20 bg-slate-950/70 p-6 text-center shadow-[0_16px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl ring-1 ring-white/10">
            <div className="text-sm font-bold text-white">Memuat Cesium 3D Globe…</div>
            <div className="mt-1.5 text-xs text-white/60">Menyiapkan Cinematic Globe Zoom & Glassmorphism UI</div>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-slate-950/85 p-6 shadow-2xl backdrop-blur-2xl ring-1 ring-white/10">
            <h2 className="mb-2 text-sm font-bold text-red-300">Cesium view gagal dimuat</h2>
            <p className="mb-4 text-xs leading-relaxed text-white/60">{error}</p>
            <div className="flex justify-end gap-2">
              <Link href="/" className="rounded-xl px-4 py-2 text-xs font-semibold text-white/70 hover:text-white border border-white/10 hover:bg-white/10 transition">Kembali</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
