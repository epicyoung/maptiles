'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { TilesRenderer, WGS84_ELLIPSOID, GlobeControls } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins';

interface LocationInfo {
  id: string;
  name: string;
  icon: string;
  lat: number;
  lon: number;
  altitude: number;
  camAltitude: number;
  camOffsetSouth: number;
  color: number;
  colorHex: string;
  description: string;
}

const LOCATIONS: Record<string, LocationInfo> = {
  bsd: {
    id: 'bsd',
    name: 'BSD City',
    icon: '📍',
    lat: -6.3016,
    lon: 106.6534,
    altitude: 45,
    camAltitude: 1400,
    camOffsetSouth: 2000,
    color: 0x00f0ff,
    colorHex: '#00f0ff',
    description: 'Kawasan BSD City, Tangerang Selatan',
  },
  soetta: {
    id: 'soetta',
    name: 'Bandara Soetta',
    icon: '✈️',
    lat: -6.1256,
    lon: 106.6558,
    altitude: 30,
    camAltitude: 1600,
    camOffsetSouth: 2400,
    color: 0xffaa00,
    colorHex: '#ffaa00',
    description: 'Bandara Internasional Soekarno-Hatta (CGK)',
  },
  monas: {
    id: 'monas',
    name: 'Monas Jakarta',
    icon: '🏛️',
    lat: -6.1754,
    lon: 106.8272,
    altitude: 35,
    camAltitude: 1300,
    camOffsetSouth: 1900,
    color: 0xff3366,
    colorHex: '#ff3366',
    description: 'Monumen Nasional & Pusat Jakarta',
  },
};

const LOCATION_KEYS = ['bsd', 'soetta', 'monas'];

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

function createCurvedRouteArc(p1: THREE.Vector3, p2: THREE.Vector3, color: number): {
  line: THREE.Line;
  curve: THREE.QuadraticBezierCurve3;
} {
  const mid = p1.clone().add(p2).multiplyScalar(0.5);
  const normal = mid.clone().normalize();
  mid.addScaledVector(normal, 900); // 900m lift above terrain

  const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
  const points = curve.getPoints(50);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    linewidth: 3,
    transparent: true,
    opacity: 0.85,
  });
  return { line: new THREE.Line(geometry, material), curve };
}

export default function BsdMapShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeLocation, setActiveLocation] = useState<string>('bsd');
  const [apiKey, setApiKey] = useState<string>(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  );
  const [inputKey, setInputKey] = useState<string>('');
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAutoOrbit, setIsAutoOrbit] = useState<boolean>(false);
  const [isTourRunning, setIsTourRunning] = useState<boolean>(false);

  // References to pass into the animation loop
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<GlobeControls | null>(null);
  const currentLookAtRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const activeLocationRef = useRef<string>('bsd');
  const isAutoOrbitRef = useRef<boolean>(false);
  const isTourRunningRef = useRef<boolean>(false);
  const isUserInteractingRef = useRef<boolean>(false);
  const lastInteractionTimeRef = useRef<number>(0);

  // Zoom in / out helper for on-screen buttons
  const handleZoom = (direction: 'in' | 'out') => {
    if (!cameraRef.current) return;
    const camera = cameraRef.current;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const dist = camera.position.distanceTo(currentLookAtRef.current);
    const moveDist = direction === 'in' ? Math.max(dist * 0.35, 80) : -Math.max(dist * 0.45, 120);
    camera.position.addScaledVector(forward, moveDist);
    lastInteractionTimeRef.current = performance.now();
  };

  // Flight transition ref
  const flightAnimRef = useRef<{
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startLookAt: THREE.Vector3;
    endLookAt: THREE.Vector3;
    startUp: THREE.Vector3;
    endUp: THREE.Vector3;
    peakAltitude: number;
    progress: number;
    duration: number;
  } | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    activeLocationRef.current = activeLocation;
  }, [activeLocation]);

  useEffect(() => {
    isAutoOrbitRef.current = isAutoOrbit;
  }, [isAutoOrbit]);

  useEffect(() => {
    isTourRunningRef.current = isTourRunning;
  }, [isTourRunning]);

  // Fly camera smoothly to a location
  const flyTo = useCallback((locKey: string, customDuration = 2.2) => {
    const loc = LOCATIONS[locKey];
    if (!loc || !cameraRef.current) return;

    setActiveLocation(locKey);

    const groundPos = getCartesian(loc.lat, loc.lon, loc.altitude);
    const { up, north } = getEnuAxes(loc.lat, loc.lon);

    const targetCamPos = groundPos
      .clone()
      .addScaledVector(up, loc.camAltitude)
      .addScaledVector(north, -loc.camOffsetSouth);

    if (controlsRef.current) {
      controlsRef.current.enabled = false;
    }

    const distance = cameraRef.current.position.distanceTo(targetCamPos);
    const peakAltitude = Math.min(Math.max(distance * 0.2, 500), 5000);

    flightAnimRef.current = {
      startPos: cameraRef.current.position.clone(),
      endPos: targetCamPos,
      startLookAt: currentLookAtRef.current.clone(),
      endLookAt: groundPos,
      startUp: cameraRef.current.up.clone(),
      endUp: up.clone(),
      peakAltitude,
      progress: 0,
      duration: customDuration,
    };
  }, []);

  // Preflight check for Google 3D Tiles API key
  useEffect(() => {
    if (!apiKey) return;

    let isCancelled = false;
    setErrorMessage(null);

    fetch(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${apiKey}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const detail = data?.error?.message || `HTTP ${res.status} ${res.statusText}`;
          if (!isCancelled) {
            if (detail.includes('HTTP_REFERRER') || detail.includes('referer')) {
              setErrorMessage(
                `Google 3D Tiles: Referer diblokir (${detail}). Buka Google Cloud Console > Credentials > Edit API Key > tambahkan "http://localhost:3000/*" ke Website Restrictions, atau ganti dengan API Key lain.`
              );
            } else {
              setErrorMessage(`Google 3D Tiles Error: ${detail}`);
            }
          }
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setErrorMessage(`Koneksi ke Google Tiles gagal: ${err.message}`);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [apiKey]);

  // Main Three.js Scene Setup & Animation Loop
  useEffect(() => {
    if (!containerRef.current) return;
    if (!apiKey) return;

    setIsLoading(true);

    // 1. Scene, Camera, WebGLRenderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040814);

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      20000000
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      logarithmicDepthBuffer: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff6ea, 2.0);
    sunLight.position.set(1.5, 2.5, 1.0).normalize();
    scene.add(sunLight);

    // 2. Google Photorealistic 3D Tiles with GoogleCloudAuthPlugin
    const tiles = new TilesRenderer();
    tiles.registerPlugin(
      new GoogleCloudAuthPlugin({
        apiToken: apiKey,
        autoRefreshToken: true,
      })
    );
    scene.add(tiles.group);

    (window as any).__tiles = tiles;
    (window as any).__camera = camera;
    (window as any).__scene = scene;

    tiles.addEventListener('tile-download-start', (e: any) => {
      console.log('[Tiles] Download start:', e.url);
    });
    tiles.addEventListener('tile-download-finish', (e: any) => {
      console.log('[Tiles] Download finish:', e.url);
    });
    tiles.addEventListener('load-tile-set', (e: any) => {
      console.log('[Tiles] Tileset loaded:', e);
    });
    tiles.addEventListener('load-error', (e: any) => {
      console.error('[Tiles] Load error:', e);
      setIsLoading(false);
    });

    // 3. Globe Controls for manual drag/zoom
    const controls = new GlobeControls(scene, camera, renderer.domElement);
    controls.setEllipsoid(tiles.ellipsoid, tiles.group);
    controls.nearMargin = 0.05;
    controls.farMargin = 0.8;
    controls.minDistance = 10;
    controls.maxDistance = 25000000;
    controls.zoomSpeed = 1.3;
    controlsRef.current = controls;
    (window as any).__controls = controls;

    // Detect user interaction (pointer & wheel)
    const onPointerDown = () => {
      isUserInteractingRef.current = true;
      lastInteractionTimeRef.current = performance.now();
    };
    const onPointerUp = () => {
      isUserInteractingRef.current = false;
      lastInteractionTimeRef.current = performance.now();
    };
    const onWheel = () => {
      lastInteractionTimeRef.current = performance.now();
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });

    // 4. Hitung Posisi Lokasi
    const pBsd = getCartesian(LOCATIONS.bsd.lat, LOCATIONS.bsd.lon, LOCATIONS.bsd.altitude);
    const pSoetta = getCartesian(LOCATIONS.soetta.lat, LOCATIONS.soetta.lon, LOCATIONS.soetta.altitude);
    const pMonas = getCartesian(LOCATIONS.monas.lat, LOCATIONS.monas.lon, LOCATIONS.monas.altitude);

    // 5. 3D Markers & Animated Radar Ping Rings for BSD, Soetta, Monas
    const animatedPins: {
      orb: THREE.Mesh;
      basePos: THREE.Vector3;
      up: THREE.Vector3;
      beaconHeight: number;
    }[] = [];

    const animatedRadarRings: {
      mesh: THREE.Mesh;
      material: THREE.MeshBasicMaterial;
      offset: number;
    }[] = [];

    const markersGroup = new THREE.Group();
    Object.values(LOCATIONS).forEach((loc, idx) => {
      const pos = getCartesian(loc.lat, loc.lon, loc.altitude);
      const { up } = getEnuAxes(loc.lat, loc.lon);

      // Vertical Beacon Cylinder
      const beaconH = 400;
      const cylGeom = new THREE.CylinderGeometry(6, 2, beaconH, 16);
      cylGeom.translate(0, beaconH / 2, 0);
      const cylMat = new THREE.MeshBasicMaterial({
        color: loc.color,
        transparent: true,
        opacity: 0.8,
      });
      const cylMesh = new THREE.Mesh(cylGeom, cylMat);
      cylMesh.position.copy(pos);
      cylMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      markersGroup.add(cylMesh);

      // Glowing Sphere at top (Bobbing animation)
      const orbGeom = new THREE.SphereGeometry(32, 16, 16);
      const orbMat = new THREE.MeshBasicMaterial({ color: loc.color });
      const orb = new THREE.Mesh(orbGeom, orbMat);
      orb.position.copy(pos).addScaledVector(up, beaconH);
      markersGroup.add(orb);
      animatedPins.push({ orb, basePos: pos, up, beaconHeight: beaconH });

      // Ground Radar Ripple Rings (Expanding sonar animation)
      for (let r = 0; r < 2; r++) {
        const ringGeom = new THREE.RingGeometry(15, 30, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: loc.color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.8,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.copy(pos).addScaledVector(up, 6 + r * 2);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
        markersGroup.add(ring);

        animatedRadarRings.push({
          mesh: ring,
          material: ringMat,
          offset: r * 0.5 + idx * 0.33,
        });
      }
    });
    scene.add(markersGroup);

    // 8. Initial Camera Position (BSD City)
    const bsdAxes = getEnuAxes(LOCATIONS.bsd.lat, LOCATIONS.bsd.lon);
    camera.position
      .copy(pBsd)
      .addScaledVector(bsdAxes.up, LOCATIONS.bsd.camAltitude)
      .addScaledVector(bsdAxes.north, -LOCATIONS.bsd.camOffsetSouth);
    camera.up.copy(bsdAxes.up);
    camera.lookAt(pBsd);
    currentLookAtRef.current.copy(pBsd);

    // Initial resolution setup
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);

    // 9. Tour Timer state
    let tourWaitTimer = 0;
    let tourIndex = 0;

    // 10. Main Animation Loop (Runs 60fps)
    let animationFrameId: number;
    let lastTime = performance.now();
    let routeProgress = 0;

    function animate() {
      animationFrameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const elapsedTime = now * 0.001;

      // ANIMASI: Flight Transition (Fly-To Antar Kota)
      if (flightAnimRef.current) {
        const anim = flightAnimRef.current;
        anim.progress += delta / anim.duration;

        if (anim.progress >= 1) {
          anim.progress = 1;
          camera.position.copy(anim.endPos);
          camera.up.copy(anim.endUp);
          camera.lookAt(anim.endLookAt);
          currentLookAtRef.current.copy(anim.endLookAt);
          flightAnimRef.current = null;

          if (controlsRef.current) {
            controlsRef.current.enabled = true;
          }
        } else {
          // Smooth Hermite / EaseInOut Cubic
          const t = anim.progress;
          const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

          // Interpolasi posisi dasar dengan busur parabola (swoop lift)
          const basePos = new THREE.Vector3().lerpVectors(anim.startPos, anim.endPos, ease);
          const currentUp = new THREE.Vector3()
            .lerpVectors(anim.startUp, anim.endUp, ease)
            .normalize();
          const arcLift = Math.sin(ease * Math.PI) * anim.peakAltitude;
          camera.position.copy(basePos).addScaledVector(currentUp, arcLift);

          // Interpolasi orientasi lookAt
          currentLookAtRef.current.lerpVectors(anim.startLookAt, anim.endLookAt, ease);
          camera.up.copy(currentUp);
          camera.lookAt(currentLookAtRef.current);
        }
      } else {
        // ALWAYS update controls so zoom (wheel/drag/touch) is 100% active and smooth!
        if (controlsRef.current && controlsRef.current.enabled) {
          controlsRef.current.update();
        }

        // Auto-Tour Mode (Otomatis ganti kota jika diaktifkan)
        if (isTourRunningRef.current) {
          tourWaitTimer += delta;
          if (tourWaitTimer >= 7.0) {
            tourWaitTimer = 0;
            tourIndex = (tourIndex + 1) % LOCATION_KEYS.length;
            const nextKey = LOCATION_KEYS[tourIndex];
            flyTo(nextKey, 2.5);
          }
        }

        // Auto-Orbit Kamera (Hanya aktif jika tombol Auto-Orbit dinyalakan user)
        const userRecentlyInteracted =
          isUserInteractingRef.current || now - lastInteractionTimeRef.current < 2500;

        if (isAutoOrbitRef.current && !userRecentlyInteracted) {
          const loc = LOCATIONS[activeLocationRef.current] || LOCATIONS.bsd;
          const { up } = getEnuAxes(loc.lat, loc.lon);
          const orbitSpeed = delta * 0.08;

          const camOffset = camera.position.clone().sub(currentLookAtRef.current);
          camOffset.applyAxisAngle(up, orbitSpeed);
          camera.position.copy(currentLookAtRef.current).add(camOffset);
          camera.up.copy(up);
          camera.lookAt(currentLookAtRef.current);
        }
      }

      // Update 3D Tiles & Render
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();

      renderer.render(scene, camera);
      setIsLoading(false);
    }

    animate();

    // Resize Handling
    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      tiles.setResolutionFromRenderer(camera, renderer);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      controls.dispose();
      tiles.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [apiKey, flyTo]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#040814] select-none font-sans text-white">
      {/* 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Header Info Panel */}
      <header className="absolute top-6 left-6 z-20 flex flex-col gap-1.5 bg-black/60 backdrop-blur-md px-5 py-3.5 rounded-2xl border border-white/10 shadow-2xl max-w-sm">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
          <h1 className="font-semibold text-sm tracking-wide text-zinc-100">
            BSD 3D Photorealistic Map
          </h1>
        </div>
        <p className="text-xs text-zinc-400">
          Google 3D Tiles & Three.js Geospatial Viewer
        </p>
        <div className="text-[11px] text-zinc-400 flex items-center gap-3 pt-1 border-t border-white/10">
          <span>📍 {LOCATIONS[activeLocation]?.name}</span>
          <span>Lat: {LOCATIONS[activeLocation]?.lat}</span>
          <span>Lon: {LOCATIONS[activeLocation]?.lon}</span>
        </div>
      </header>

      {/* Controls & Mode Toggles (Top Right) */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
        <button
          onClick={() => setIsAutoOrbit(!isAutoOrbit)}
          className={`flex items-center gap-2 backdrop-blur-md px-4 py-2 rounded-full border text-xs font-medium transition ${
            isAutoOrbit
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
              : 'bg-black/60 border-white/10 text-zinc-300 hover:bg-black/80'
          }`}
          title="Putar kamera otomatis mengelilingi lokasi"
        >
          <span>🔄</span>
          <span>Auto-Orbit: {isAutoOrbit ? 'ON' : 'OFF'}</span>
        </button>

        <button
          onClick={() => {
            const nextState = !isTourRunning;
            setIsTourRunning(nextState);
            if (nextState) {
              flyTo(activeLocation);
            }
          }}
          className={`flex items-center gap-2 backdrop-blur-md px-4 py-2 rounded-full border text-xs font-medium transition ${
            isTourRunning
              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 animate-pulse'
              : 'bg-black/60 border-white/10 text-zinc-300 hover:bg-black/80'
          }`}
          title="Tur otomatis keliling BSD -> Soetta -> Monas"
        >
          <span>{isTourRunning ? '⏸️' : '▶️'}</span>
          <span>{isTourRunning ? 'Jeda Tour' : 'Mulai Tour'}</span>
        </button>

        <button
          onClick={() => {
            setInputKey(apiKey);
            setShowKeyModal(true);
          }}
          className="flex items-center gap-2 bg-black/60 hover:bg-black/80 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-xs font-medium text-zinc-200 transition"
        >
          🔑 <span>API Key</span>
        </button>
      </div>

      {/* Error / Referrer Warning Banner */}
      {errorMessage && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 max-w-2xl w-[90%] bg-red-950/85 backdrop-blur-lg border border-red-500/40 rounded-xl p-4 shadow-2xl text-xs text-red-200 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold text-red-100">
              <span className="text-base">⚠️</span> Perhatian API Key Google Tiles
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-white text-sm leading-none"
            >
              ✕
            </button>
          </div>
          <p className="leading-relaxed">{errorMessage}</p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => {
                setInputKey(apiKey);
                setShowKeyModal(true);
              }}
              className="px-3 py-1 bg-red-700/70 hover:bg-red-600 rounded-md font-medium text-white transition"
            >
              Ganti API Key
            </button>
          </div>
        </div>
      )}

      {/* Loading Indicator */}
      {isLoading && apiKey && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
          <div className="bg-black/70 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 flex items-center gap-3 shadow-2xl">
            <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-zinc-200">Memuat 3D Map Showcase...</span>
          </div>
        </div>
      )}

      {/* Navigation Buttons (Bottom Center) */}
      <nav className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 bg-black/70 backdrop-blur-xl px-3 py-2 rounded-full border border-white/15 shadow-2xl">
          {Object.values(LOCATIONS).map((loc) => {
            const isActive = activeLocation === loc.id;
            return (
              <button
                key={loc.id}
                onClick={() => flyTo(loc.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium text-xs transition duration-200 ${
                  isActive
                    ? 'bg-zinc-100 text-black shadow-lg scale-105 font-semibold'
                    : 'text-zinc-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <span>{loc.icon}</span>
                <span>{loc.name}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-300 bg-black/60 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 shadow-lg">
          🔍 <strong>Scroll Mouse:</strong> Zoom In / Out | 🖱️ <strong>Klik Kiri + Geser:</strong> Muter Kamera | 📍 <strong>Klik Tombol:</strong> Pindah Kota
        </p>
      </nav>

      {/* Floating Zoom Buttons (Bottom Right) */}
      <div className="absolute bottom-8 right-8 z-30 flex flex-col gap-2.5">
        <button
          onClick={() => handleZoom('in')}
          className="w-11 h-11 bg-black/70 hover:bg-cyan-500 hover:text-black backdrop-blur-md border border-white/20 rounded-xl flex items-center justify-center text-xl font-bold text-white shadow-2xl transition active:scale-90"
          title="Zoom Dekat (Perbesar)"
        >
          +
        </button>
        <button
          onClick={() => handleZoom('out')}
          className="w-11 h-11 bg-black/70 hover:bg-cyan-500 hover:text-black backdrop-blur-md border border-white/20 rounded-xl flex items-center justify-center text-xl font-bold text-white shadow-2xl transition active:scale-90"
          title="Zoom Jauh (Perkecil)"
        >
          −
        </button>
        <button
          onClick={() => flyTo(activeLocation)}
          className="w-11 h-11 bg-black/70 hover:bg-black/90 backdrop-blur-md border border-white/20 rounded-xl flex items-center justify-center text-sm text-white shadow-2xl transition active:scale-90"
          title="Reset Kamera ke Titik Awal"
        >
          🎯
        </button>
      </div>

      {/* API Key Modal */}
      {(showKeyModal || !apiKey) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-white/15 rounded-2xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 text-zinc-200">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              🔑 Ganti Google Maps 3D Tiles API Key
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Google Photorealistic 3D Tiles membutuhkan API Key Google Cloud dengan{' '}
              <strong className="text-zinc-200">Map Tiles API</strong> aktif. Default dibaca dari{' '}
              <code className="bg-black/50 px-1.5 py-0.5 rounded text-amber-300 font-mono">
                NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
              </code>{' '}
              di <code className="bg-black/50 px-1.5 py-0.5 rounded text-amber-300 font-mono">.env.local</code>.
              Jika API Key Anda dibatasi dengan HTTP Referrer restriction, tambahkan{' '}
              <code className="bg-black/50 px-1.5 py-0.5 rounded text-amber-300 font-mono">
                http://localhost:3000/*
              </code>{' '}
              ke daftar domain yang diizinkan.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-300">API Key:</label>
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-black/60 border border-white/20 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (inputKey.trim()) {
                    setApiKey(inputKey.trim());
                    setShowKeyModal(false);
                  }
                }}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-cyan-500 hover:bg-cyan-400 text-black font-semibold transition"
              >
                Simpan & Muat Ulang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Required attribution for Google Photorealistic 3D Tiles */}
      <a
        href="https://maps.google.com"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 right-3 z-40 px-2 py-1 rounded-md bg-black/55 backdrop-blur-md border border-white/10 text-[10px] font-medium text-white/80 hover:text-white transition-colors"
      >
        Powered by Google
      </a>
    </div>
  );
}
