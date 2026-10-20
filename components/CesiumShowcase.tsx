"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BSD_LINE_COORDINATES } from "@/lib/bsdline";
import { DISTRICTS } from "@/lib/mapLayersData";
import { loadRailwayGeoJson } from "@/lib/localRailway";
import { startMp4Recording, RECORDING_SECONDS } from "@/lib/cesiumRecording";
import { buildTollLabels, loadTollGeoJson } from "@/lib/localToll";
import { POIS_KEY, buildSetupBundle, readPois, readSetupBundle, type StoredPoi } from "@/lib/placesStore";
import { DEFAULT_MAP_SKIN, DEFAULT_START_POINT, MAP_SKINS, PREFERENCES_KEY, parseStartPoint, readPreferences, type MapSkin, type StartPoint } from "@/lib/cesiumPreferences";
import { LOGO_RATIOS, PLACES_KEY, mergeOverride, placeName, readPlaceOverrides, removeOverride, type PlaceOverride, type PlaceOverrides } from "@/lib/placeOverrides";
const CESIUM_VERSION = "1.115";
const CESIUM_JS = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/Cesium.js`;
const CESIUM_CSS = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/Widgets/widgets.css`;
type Poi = StoredPoi; /* Default pins stay minimal: users add their own places via search / Point B. */
const DEFAULT_POIS: Poi[] = [{
  id: "soetta",
  name: "Soekarno-Hatta Airport",
  lon: 106.6558,
  lat: -6.1256,
  height: 55,
  estTime: "32 min",
  estDist: "28.5 km",
  category: "far"
}]; /* Low altitude offset to precisely hug the road surface (zero floating parallax) */
const ROUTE_HEIGHT_M = 10;
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
} /** Ikon SVG (bukan emoji) supaya render konsisten di semua Windows/browser. */
function EyeIcon({
  off = false
}: {
  off?: boolean;
}) {
  return <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">      {off ? <>
<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
<path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
<line x1="2" y1="2" x2="22" y2="22" />
</> : <>
<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
<circle cx="12" cy="12" r="3" />
</>}    </svg>;
}
function TrashIcon() {
  return <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
<path d="M3 6h18" />
<path d="M8 6V4h8v2" />
<path d="M19 6l-1 14H6L5 6" />
<path d="M10 11v6" />
<path d="M14 11v6" />
</svg>;
}
function buildCumulative(coords: [number, number][]): number[] {
  const c = [0];
  for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + haversineKm(coords[i - 1], coords[i]));
  return c;
} /** Kecilkan logo (maks 384x256) supaya aman disimpan di localStorage sebagai data URL. */
async function fileToLogoDataUrl(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 384 / bitmap.width, 256 / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
} /** * Smart Coordinate Parser: * Supports "-6.3022, 106.6542", "106.6542, -6.3022", "-6.3022 106.6542", or Google Maps URLs containing @lat,lon */
function parseSmartCoordinates(rawInput: string): {
  lat: number;
  lon: number;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null; /* Check Google Maps URL pattern @lat,lon */
  const gmapsMatch = trimmed.match(/@([+-]?\d+\.\d+),([+-]?\d+\.\d+)/);
  const candidateStr = gmapsMatch ? `${gmapsMatch[1]},${gmapsMatch[2]}` : trimmed;
  const match = candidateStr.match(/^([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const a = parseFloat(match[1]);
  const b = parseFloat(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let lat = a;
  let lon = b; /* Auto-swap if user pasted [lon, lat] (e.g. 106.65, -6.30) */
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
    lon = a;
    lat = b;
  } else if (Math.abs(a) <= 90 && Math.abs(b) <= 90) {
    /* In Indonesia, latitude is around -11..6 and longitude is > 94 */
    if (Math.abs(a) > 20 && Math.abs(b) < 20) {
      lon = a;
      lat = b;
    }
  }
  if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return {
      lat,
      lon
    };
  }
  return null;
}
async function reverseGeocodeName(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${lon},${lat}&f=json`);
    if (res.ok) {
      const data = await res.json();
      const addr = data?.address;
      const name = addr?.PlaceName || addr?.Address || addr?.Neighborhood || addr?.District || addr?.City;
      if (name) return String(name);
    }
  } catch {/* ignore */}
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
type SearchCandidate = {
  name: string;
  lat: number;
  lon: number;
  type: string;
  city: string;
}; /* Bobot tipe places: destinasi (mall, toko, stasiun) diprioritaskan di atas */
/* objek kecil seperti halte/parkiran yang namanya kebetulan sama. */
const PLACE_TYPE_BONUS: Record<string, number> = {
  mall: 40,
  department_store: 35,
  supermarket: 30,
  retail: 26,
  station: 30,
  attraction: 28,
  monument: 28,
  park: 22,
  hospital: 24,
  school: 20,
  bus_stop: 2,
  parking: 1,
  motorcycle_parking: 1,
  fuel: 3,
  atm: 2,
  bank: 6
}; /* Samakan ejaan sebelum membandingkan nama: "ÆON" -> "aeon", buang tanda baca. */
function normalizePlaceName(value: string): string {
  return value.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
} /* Bonus bila nama hasil diawali kata kunci (mis. "aeon" -> "ÆON Mall"). */
function nameMatchBonus(name: string, query: string): number {
  const nq = normalizePlaceName(query);
  const nn = normalizePlaceName(name);
  if (!nq || !nn) return 0;
  if (nn === nq || nn.startsWith(`${nq} `)) return 12;
  return nn.includes(nq) ? 6 : 0;
}
function approxDistanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
async function searchEsri(query: string, biasLat: number, biasLon: number, signal?: AbortSignal): Promise<SearchCandidate[]> {
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates` + `?SingleLine=${encodeURIComponent(query)}` + `&location=${biasLon},${biasLat}&distance=50000&maxLocations=5&outFields=PlaceName,Match_addr&f=json`;
  const res = await fetch(url, {
    signal
  });
  if (!res.ok) return [];
  const data = await res.json();
  const out: SearchCandidate[] = [];
  for (const c of data?.candidates || []) {
    const lat = c?.location?.y;
    const lon = c?.location?.x;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      name: String(c?.attributes?.PlaceName || c?.address || query),
      lat,
      lon,
      type: '',
      city: ''
    });
  }
  return out;
}
async function searchPhoton(query: string, biasLat: number, biasLon: number, signal?: AbortSignal): Promise<SearchCandidate[]> {
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=25&lat=${biasLat}&lon=${biasLon}`, {
    signal
  });
  if (!res.ok) return [];
  const data = await res.json();
  const out: SearchCandidate[] = [];
  for (const f of data?.features || []) {
    const [lon, lat] = f?.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p = f?.properties || {};
    out.push({
      name: String(p.name || p.street || query),
      lat,
      lon,
      type: String(p.osm_value || p.osm_key || ''),
      city: String(p.city || p.district || p.state || '')
    });
  }
  return out;
}
async function searchNominatim(query: string, biasLat: number, biasLon: number, signal?: AbortSignal): Promise<SearchCandidate[]> {
  const viewbox = `${biasLon - 0.6},${biasLat + 0.6},${biasLon + 0.6},${biasLat - 0.6}`;
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}` + `&format=jsonv2&limit=10&viewbox=${viewbox}&bounded=0`, {
    signal
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  const out: SearchCandidate[] = [];
  for (const x of data) {
    const lat = Number(x?.lat);
    const lon = Number(x?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      name: String(x?.name || x?.display_name || query),
      lat,
      lon,
      type: String(x?.type || ''),
      city: ''
    });
  }
  return out;
}
async function searchPlacesOmnibox(query: string, biasLat: number, biasLon: number, signal?: AbortSignal): Promise<StartPoint[]> {
  const results: StartPoint[] = []; /* 1. Check if raw input is coordinates */
  const coords = parseSmartCoordinates(query);
  if (coords) {
    const label = await reverseGeocodeName(coords.lat, coords.lon);
    results.push({
      id: 'hub',
      name: `${label} (${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)})`,
      lat: coords.lat,
      lon: coords.lon,
      height: 60,
      sub: 'Coordinates found'
    });
    return results;
  } /* 2. Beberapa geocoder gratis dijalankan PARALEL, lalu hasilnya digabung dan diurutkan. */
  /* Esri sendiri sering mengembalikan "AEON" acak (bahkan di luar negeri) dengan score 100, */
  /* jadi hasilnya tidak boleh langsung di-return sebelum Photon/Nominatim ikut dicoba. */
  const settled = await Promise.allSettled([searchEsri(query, biasLat, biasLon, signal), searchPhoton(query, biasLat, biasLon, signal), searchNominatim(query, biasLat, biasLon, signal)]);
  const merged: SearchCandidate[] = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      merged.push(...item.value);
    } else if ((item.reason as any)?.name === 'AbortError') {
      throw item.reason;
    }
  } /* Buang duplikat (nama + koordinat berdekatan), lalu rangking: */
  /* bonus tipe destinasi dikurangi penalti jarak dari titik awal peta. */
  const seen = new Set<string>();
  const ranked = merged.filter(c => {
    const key = `${c.name.toLowerCase().replace(/\s+/g, ' ').slice(0, 40)}|${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(c => ({
    candidate: c,
    score: (PLACE_TYPE_BONUS[c.type] ?? 8) + nameMatchBonus(c.name, query) - approxDistanceKm(biasLat, biasLon, c.lat, c.lon) * 0.5
  })).sort((a, b) => b.score - a.score).slice(0, 6);
  for (const {
    candidate
  } of ranked) {
    const label = [candidate.name, candidate.city].filter(Boolean).join(', ');
    results.push(parseStartPoint((label || query).slice(0, 95), String(candidate.lat), String(candidate.lon)));
  }
  return results;
}
const CSS = `@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap');.cesium-showcase, .cesium-showcase * {  font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;}.cesium-showcase {  font-weight: 400;  position: relative;  width: 100%;  height: 100vh;  overflow: hidden;  background: #040814;}.cesium-showcase h1 {  font-weight: 500 !important;}.cesium-showcase .map {  position: absolute;  inset: 0;}.cesium-showcase.pick-cursor .map,.cesium-showcase.pick-cursor .map canvas {  cursor: crosshair !important;}.cesium-showcase .pins {  position: absolute;  inset: 0;  pointer-events: none;  z-index: 10;  overflow: hidden;}.cesium-showcase .pole {  position: absolute;  transform: translate(-50%, -100%);  display: flex;  flex-direction: column;  align-items: center;  pointer-events: auto;  cursor: pointer;  transition: transform .25s cubic-bezier(0.16, 1, 0.3, 1), opacity .25s ease;}.cesium-showcase .pole:hover {  transform: translate(-50%, -100%) scale(1.08);  z-index: 20;}.cesium-showcase .pole.hub { z-index: 100; }.cesium-showcase .pole.active { z-index: 110; }.cesium-showcase .pole.hub:hover, .cesium-showcase .pole.active:hover { z-index: 120; }.cesium-showcase .settings-panel {  position: relative; width: 100%; margin-top: 0;  border: 1px solid rgba(255,255,255,.7); border-radius: 16px;  background: rgba(255,255,255,.72); color: #1e293b; backdrop-filter: blur(24px);  padding: 12px;}.cesium-showcase .settings-panel.collapsed { padding: 12px; }.cesium-showcase .layer-switch {  display: flex; align-items: center; justify-content: space-between; gap: 12px;  width: 100%; padding: 12px 0; text-align: left; font-size: 12px;  border-bottom: 1px solid rgba(100,116,139,.15); cursor: pointer;}.cesium-showcase .layer-switch:focus-visible { outline: 2px solid #ff7700; outline-offset: 4px; }.cesium-showcase .switch-track { width: 30px; height: 18px; border-radius: 20px; background: #94a3b8; padding: 3px; flex-shrink: 0; }.cesium-showcase .switch-track.on { background: #ea580c; }.cesium-showcase .switch-track span { display: block; width: 12px; height: 12px; border-radius: 50%; background: white; transition: transform .2s; }.cesium-showcase .switch-track.on span { transform: translateX(12px); }.cesium-showcase.theme-dark .settings-panel,.cesium-showcase.theme-dark .navigation-panel {  background: rgba(15,23,42,.82); color: #f1f5f9; border-color: rgba(255,255,255,.18);}.cesium-showcase.theme-dark .navigation-panel [class*="text-slate-800"],.cesium-showcase.theme-dark .navigation-panel [class*="text-slate-700"] { color: #e2e8f0; }.cesium-showcase.theme-dark .navigation-panel [class*="text-slate-500"] { color: #cbd5e1; }.cesium-showcase.theme-dark .navigation-panel [class*="bg-white/"] { background-color: rgba(15,23,42,.72); border-color: rgba(255,255,255,.2); }@media (max-width: 700px) {  .cesium-showcase .settings-panel { margin-top: 0; }}/* Logo pin: pengganti label teks, rasio 3:2 atau 4:3 */.cesium-showcase .pole-logo {  background: rgba(255, 255, 255, 0.82);  backdrop-filter: blur(20px);  -webkit-backdrop-filter: blur(20px);  border: 1px solid rgba(255, 255, 255, 0.95);  border-radius: 8px;  padding: 4px;  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.22), inset 0 1px 0 0 rgba(255, 255, 255, 0.95);  transition: all .25s cubic-bezier(0.16, 1, 0.3, 1);  overflow: hidden;}.cesium-showcase .pole-logo.ratio-3-2 { width: 96px; aspect-ratio: 3 / 2; }.cesium-showcase .pole-logo.ratio-4-3 { width: 88px; aspect-ratio: 4 / 3; }.cesium-showcase .pole-logo img {  display: block;  width: 100%;  height: 100%;  object-fit: contain;  border-radius: 5px;}.cesium-showcase .pole.hub .pole-logo { width: 108px; }.cesium-showcase .pole.active .pole-logo { border-color: #ffa044; box-shadow: 0 0 0 2px rgba(255, 85, 0, 0.45); }/* Glassmorphic 3D Pole Pin Badges (Frosted White Glass) */.cesium-showcase .pole-label {  display: flex;  flex-direction: column;  align-items: center;  gap: 2px;  white-space: nowrap;  max-width: 240px;  background: rgba(255, 255, 255, 0.72);  backdrop-filter: blur(20px);  -webkit-backdrop-filter: blur(20px);  color: #0f172a;  padding: 6px 14px;  border-radius: 5px;  border: 1px solid rgba(255, 255, 255, 0.9);  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.18), inset 0 1px 0 0 rgba(255, 255, 255, 0.95);  font-size: 12px;  font-weight: 400;  letter-spacing: 0.01em;  transition: all .25s cubic-bezier(0.16, 1, 0.3, 1);}.cesium-showcase .pole.hub .pole-label {  background: rgba(255, 255, 255, 0.88);  backdrop-filter: blur(20px);  -webkit-backdrop-filter: blur(20px);  border: 1.5px solid rgba(255, 140, 0, 0.8);  color: #0f172a;  font-weight: 500;  border-radius: 5px !important;  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22), 0 0 18px rgba(255, 150, 0, 0.4);}.cesium-showcase .pole.active .pole-label {  background: rgba(255, 85, 0, 0.95) !important;  backdrop-filter: blur(20px);  -webkit-backdrop-filter: blur(20px);  color: #ffffff !important;  border: 1.5px solid rgba(255, 200, 140, 0.9) !important;  border-radius: 5px !important;  padding: 7px 18px !important;  font-weight: 500 !important;  box-shadow: 0 10px 32px rgba(255, 85, 0, 0.55), 0 0 24px rgba(255, 85, 0, 0.5) !important;}.cesium-showcase .pole-sub {  font-size: 10.5px;  color: #475569;  font-weight: 400;  display: block;}.cesium-showcase .pole.active .pole-sub {  display: block;  color: #fff3e0 !important;  opacity: 1;}.cesium-showcase .pole.hub .pole-sub {  display: block;  color: #c2410c;  font-weight: 500;}.cesium-showcase .pole-line {  width: 2px;  height: 36px;  background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0.4) 100%);  box-shadow: 0 0 8px rgba(0,0,0,0.35);}.cesium-showcase .pole.hub .pole-line {  background: linear-gradient(180deg, #ff9900 0%, rgba(255,153,0,0.4) 100%);  height: 48px;  box-shadow: 0 0 10px rgba(255,153,0,0.6);}.cesium-showcase .pole.active .pole-line {  background: linear-gradient(180deg, #ff7700 0%, #ff3300 100%) !important;  box-shadow: 0 0 12px rgba(255,85,0,0.9) !important;  height: 46px;}.cesium-showcase .pole-dot {  width: 12px;  height: 12px;  border-radius: 50%;  background: #ffffff;  border: 2px solid #0f172a;  box-shadow: 0 0 8px rgba(0,0,0,0.4);}.cesium-showcase .pole.hub .pole-dot {  width: 16px;  height: 16px;  background: #ff9900;  border-color: #ffffff;  box-shadow: 0 0 0 4px rgba(255, 153, 0, 0.4), 0 0 14px rgba(255, 153, 0, 0.8);}.cesium-showcase .pole.active .pole-dot {  width: 15px;  height: 15px;  background: #ff5500 !important;  border-color: #ffffff !important;  box-shadow: 0 0 0 4px rgba(255, 85, 0, 0.4), 0 0 14px rgba(255, 85, 0, 0.8) !important;}.cesium-showcase .pole-label > span:first-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }/* Custom Glassmorphism Scrollbar */.cesium-glass-scroll::-webkit-scrollbar {  width: 5px;}.cesium-glass-scroll::-webkit-scrollbar-track {  background: transparent;}.cesium-glass-scroll::-webkit-scrollbar-thumb {  background: rgba(0, 0, 0, 0.2);  border-radius: 999px;}.cesium-glass-scroll::-webkit-scrollbar-thumb:hover {  background: rgba(0, 0, 0, 0.35);}/* Dark Glassmorphism Theme Overrides */.cesium-showcase.theme-dark {  background: #020409;}.cesium-showcase.theme-dark .pole-label {  background: rgba(15, 23, 42, 0.78);  border: 1px solid rgba(255, 255, 255, 0.18);  color: #f1f5f9;  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.45), inset 0 1px 0 0 rgba(255, 255, 255, 0.2);}.cesium-showcase.theme-dark .pole.hub .pole-label {  background: rgba(26, 32, 53, 0.92);  border: 1.5px solid rgba(255, 140, 0, 0.9);  color: #ffedd5;  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55), 0 0 18px rgba(255, 150, 0, 0.45);}.cesium-showcase.theme-dark .pole-sub {  color: #94a3b8;}.cesium-showcase.theme-dark .pole.hub .pole-sub {  color: #fb923c;}.cesium-showcase.theme-dark .cesium-glass-scroll::-webkit-scrollbar-thumb {  background: rgba(255, 255, 255, 0.2);}.cesium-showcase.theme-dark .cesium-glass-scroll::-webkit-scrollbar-thumb:hover {  background: rgba(255, 255, 255, 0.35);}/* Hide Cesium ion logo but keep data attribution */.cesium-showcase .cesium-credit-logoContainer { display: none !important; }`;
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
      if ((window as any).Cesium) resolve((window as any).Cesium);else reject(new Error('Cesium is unavailable after loading.'));
    };
    script.onerror = () => reject(new Error('Failed to load CesiumJS from the CDN.'));
    document.head.appendChild(script);
  });
  return cesiumLoader;
}
 /* Fit the entire route inside the viewport beside the navigation panel. */
function positionRouteCamera(viewer: any, C: any, sphere: any, heading: number, customRange?: number | null, customPitchDeg = -42) {
  const camera = viewer.camera;
  const canvas = viewer.canvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const shell = canvas.closest('.cesium-showcase');
  const nav = shell?.querySelector('.navigation-panel')?.getBoundingClientRect();
  const left = Math.max(32, nav ? Math.max(0, nav.right) + 32 : 32);
  const right = 48;
  const top = 130;
  const usableWidth = Math.max(width * 0.2, width - left - right);
  const usableHeight = Math.max(height * 0.2, height - top - 90);
  const halfFov = camera.frustum.fovy / 2;
  const tanHalf = Math.tan(halfFov);
  const aspect = width / height;
  const angle = Math.min(Math.atan(tanHalf * usableHeight / height), Math.atan(tanHalf * aspect * usableWidth / width));
  const defaultRange = Math.max(850, sphere.radius / Math.sin(angle) * 1.15);
  const range = customRange && customRange > 30 ? customRange : defaultRange;
  camera.lookAt(sphere.center, new C.HeadingPitchRange(heading, C.Math.toRadians(customPitchDeg), range));
  camera.lookAtTransform(C.Matrix4.IDENTITY); /* Move the camera so the orbit target projects into the unobstructed area's center. */
  const centerX = left + usableWidth / 2;
  const centerY = top + usableHeight / 2;
  camera.moveRight((width / 2 - centerX) * 2 * range * tanHalf * aspect / width);
  camera.moveUp((centerY - height / 2) * 2 * range * tanHalf / height);
}
function getFreeRoamSphere(viewer: any, Cesium: any, defaultHub: {
  lat: number;
  lon: number;
}) {
  const canvas = viewer.canvas;
  const centerRay = viewer.camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
  let pos = centerRay ? viewer.scene.globe.pick(centerRay, viewer.scene) : undefined;
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
  const [pois, setPois] = useState<Poi[]>(DEFAULT_POIS);
  const poisRef = useRef<Poi[]>(DEFAULT_POIS);
  const [autoRotateOnArrival, setAutoRotateOnArrival] = useState(false);
  const autoArrivalRef = useRef(false); /* Point 1: Hub (Titik A) Single-Input Omnibox + Map Pick Mode */
  const [hubEditorOpen, setHubEditorOpen] = useState(false);
  const [hubQuery, setHubQuery] = useState('');
  const [hubResults, setHubResults] = useState<StartPoint[]>([]);
  const [hubSearchBusy, setHubSearchBusy] = useState(false);
  const [hubMessage, setHubMessage] = useState(''); /* Point 2: Destination (Titik B) Single-Input Omnibox + Map Pick Mode */
  const [destSearchOpen, setDestSearchOpen] = useState(false);
  const [destQuery, setDestQuery] = useState('');
  const [destResults, setDestResults] = useState<StartPoint[]>([]);
  const [destSearchBusy, setDestSearchBusy] = useState(false);
  const [destMessage, setDestMessage] = useState(''); /* Shared Map Pick ("Free Roam Click on Globe") mode: null | 'hub' | 'dest' */
  const [mapPickMode, setMapPickMode] = useState<'hub' | 'dest' | 'place' | null>(null);
  const mapPickModeRef = useRef<'hub' | 'dest' | 'place' | null>(null);
  const searchRequestRef = useRef<AbortController | null>(null);
  const destSearchRequestRef = useRef<AbortController | null>(null);
  const searchCacheRef = useRef(new Map<string, StartPoint[]>());
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const pinRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const routeEntitiesRef = useRef<any[]>([]);
  const trailEntityRef = useRef<any>(null);
  const trailAnimRef = useRef<number | null>(null);
  const routeSphereRef = useRef<any>(null);
  const freeRoamSphereRef = useRef<any>(null); /* Point 5: Smooth Ease-In-Out Auto-Rotate Range & Spin-Up state */
  const orbitRangeRef = useRef<number | null>(null);
  const orbitAnimStartRangeRef = useRef<number | null>(null);
  const orbitAnimTargetRangeRef = useRef<number | null>(null);
  const orbitAnimStartTimeRef = useRef<number>(0);
  const orbitAnimDurationMsRef = useRef<number>(900);
  const orbitSpinUpStartRef = useRef<number>(0);
  const orbitHeadingRef = useRef(0);
  const introGenerationRef = useRef(0);
  const routeRequestRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [activePoi, setActivePoi] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    distanceKm: number;
    durationMin: number;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBsd, setShowBsd] = useState(true);
  const [showRailways, setShowRailways] = useState(false);
  const [showTolls, setShowTolls] = useState(true);
  const [tollReady, setTollReady] = useState(false);
  const [tollCount, setTollCount] = useState(0);
  const [tollLabelCount, setTollLabelCount] = useState(0);
  const [tollError, setTollError] = useState('');
  const [showTollLabels, setShowTollLabels] = useState(true);
  const tollCollectionRef = useRef<any>(null);
  const tollLabelsRef = useRef<any>(null);
  const tollVisibilityRef = useRef({ roads: true, labels: true });
  const [showDistricts, setShowDistricts] = useState(false);
  const [showEsriLabels, setShowEsriLabels] = useState(false);
  const [mapSkin, setMapSkin] = useState<MapSkin>(DEFAULT_MAP_SKIN);
  const mapSkinRef = useRef<MapSkin>(DEFAULT_MAP_SKIN);
  const skinLayersRef = useRef<Record<string, any> | null>(null);
  const [placeOverrides, setPlaceOverrides] = useState<PlaceOverrides>({});
  const placeOverridesRef = useRef<PlaceOverrides>({});
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [editNameDraft, setEditNameDraft] = useState('');
  const [editLabelDraft, setEditLabelDraft] = useState('');
  const [editLatDraft, setEditLatDraft] = useState('');
  const [editLonDraft, setEditLonDraft] = useState('');
  const [placeSearchQuery, setPlaceSearchQuery] = useState('');
  const [placeSearchResults, setPlaceSearchResults] = useState<StartPoint[]>([]);
  const [placeSearchBusy, setPlaceSearchBusy] = useState(false);
  const [placePickId, setPlacePickId] = useState<string | null>(null);
  const [poisReady, setPoisReady] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const placePickIdRef = useRef<string | null>(null);
  const [dragPlaceId, setDragPlaceId] = useState<string | null>(null);
  const routeInfoRef = useRef<{
    distanceKm: number;
    durationMin: number;
  } | null>(null);
  const [darkGlass, setDarkGlass] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const layersRef = useRef<{
    district: any[];
    labels: any;
  } | null>(null);

  /* Toolbar action states */
  const [showTooltips, setShowTooltips] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(1.0);
  const [showRotateSlider, setShowRotateSlider] = useState(false); /* Video recording states */
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordWithEarthIntro, setRecordWithEarthIntro] = useState(true); /* Refs for requestAnimationFrame loops */
  const showTooltipsRef = useRef(true);
  const autoRotateRef = useRef(false);
  const rotateSpeedRef = useRef(1.0);
  const activePoiRef = useRef<string | null>(null);
  const recordCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingSessionRef = useRef<ReturnType<typeof startMp4Recording> | null>(null);
  const recordingIntroRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const darkGlassRef = useRef(false);
  const recordAnimRef = useRef<number | null>(null); /* Helper to trigger smooth Ease-In-Out zoom while Auto-Rotating */
  const triggerSmoothOrbitZoom = (nextTargetRange: number, durationMs = 750) => {
    const clamped = Math.max(80, Math.min(25000000, nextTargetRange));
    const current = orbitRangeRef.current ?? clamped;
    orbitAnimStartRangeRef.current = current;
    orbitAnimTargetRangeRef.current = clamped;
    orbitAnimStartTimeRef.current = performance.now();
    orbitAnimDurationMsRef.current = durationMs;
  };
  useEffect(() => {
    poisRef.current = pois;
  }, [pois]);
  useEffect(() => {
    mapPickModeRef.current = mapPickMode;
  }, [mapPickMode]);
  useEffect(() => {
    placePickIdRef.current = placePickId;
  }, [placePickId]);
  useEffect(() => {
    showTooltipsRef.current = showTooltips;
    autoRotateRef.current = autoRotate;
    rotateSpeedRef.current = rotateSpeed;
    activePoiRef.current = activePoi;
    darkGlassRef.current = darkGlass;
    tollVisibilityRef.current = { roads: showTolls, labels: showTollLabels };

    /* Sync native zoom controller so it never fights with our smooth Ease-In-Out orbit zoom */
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.screenSpaceCameraController.enableZoom = !autoRotate;
    } /* Update visibility of custom transport entities immediately */
  }, [showTooltips, autoRotate, rotateSpeed, activePoi, darkGlass, showDistricts, showTolls, showTollLabels, showRailways]);
  useEffect(() => {
    const resizePanels = () => {
      if (window.innerWidth < 1000) {
        setSidebarOpen(false);
        setSettingsOpen(false);
      }
    };
    const id = requestAnimationFrame(resizePanels);
    window.addEventListener('resize', resizePanels);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', resizePanels);
    };
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
    loadCesium().then(Cesium => {
      if (cancelled || !container) return;
      try {
        const preferences = readPreferences(localStorage.getItem(PREFERENCES_KEY));
        hubRef.current = preferences.hub;
        autoArrivalRef.current = preferences.autoRotateOnArrival;
        mapSkinRef.current = preferences.skin;
        setHub(preferences.hub);
        setAutoRotateOnArrival(preferences.autoRotateOnArrival);
        setMapSkin(preferences.skin); /* Override places (nama / sembunyikan / logo) — dibaca setelah mount supaya */
        /* tidak bentrok dengan HTML hasil SSR. */
        const savedOverrides = readPlaceOverrides(localStorage.getItem(PLACES_KEY));
        placeOverridesRef.current = savedOverrides;
        setPlaceOverrides(savedOverrides); /* Daftar places (destinasi hasil search, rename, dsb) ikut dipulihkan. */
        /* `null` = belum pernah disimpan; `[]` = user memang menghapus semua pin. */
        const savedPoisRaw = localStorage.getItem(POIS_KEY);
        if (savedPoisRaw !== null) setPois(readPois(savedPoisRaw));
        setPoisReady(true);
      } catch {
        setHubMessage('Browser storage is unavailable; changes will last for this session only.');
      }
      const viewer = new Cesium.Viewer(container, {
        baseLayer: false,
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
            preserveDrawingBuffer: true
          }
        }
      }); /* 1. Map skins — semua provider dibuat sekali, hanya satu yang visible (lihat effect mapSkin) */
      const skinLayers: Record<string, any> = {};
      const addSkin = (skin: string, options: any) => {
        skinLayers[skin] = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider(options));
        return skinLayers[skin];
      };
      addSkin('esri', {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: new Cesium.Credit('Esri World Imagery'),
        maximumLevel: 19
      });
      addSkin('gmap', {
        url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        subdomains: ['0', '1', '2', '3'],
        credit: new Cesium.Credit('Google Maps'),
        maximumLevel: 20
      });
      addSkin('dark', {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        credit: new Cesium.Credit('Esri Dark Gray Canvas'),
        maximumLevel: 16
      });
      addSkin('osm', {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: new Cesium.Credit('© OpenStreetMap contributors'),
        maximumLevel: 19
      });
      skinLayersRef.current = skinLayers;
      Object.entries(skinLayers).forEach(([skin, layer]) => {
        layer.show = skin === mapSkinRef.current;
      }); /* 2. Official Reference Boundaries and Places (overlay di atas skin apa pun) */
      const referenceLabels = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        credit: new Cesium.Credit('Esri Boundaries & Places')
      }));
      viewer.scene.globe.enableLighting = true;
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date('2024-06-21T13:45:00+07:00'));
      viewer.clock.shouldAnimate = false;
      if (viewer.scene.skyAtmosphere) {
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.skyAtmosphere.saturationShift = 0.15;
        viewer.scene.skyAtmosphere.brightnessShift = 0.08;
      }
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.00012;
      viewer.scene.fog.minimumBrightness = 0.2;
      viewerRef.current = viewer;
      const controller = viewer.scene.screenSpaceCameraController;
      controller.minimumZoomDistance = 25;
      controller.maximumZoomDistance = 25000000;
      controller.zoomFactor = 2.2;
      controller.inertiaZoom = 0.75;
      controller.enableCollisionDetection = false; /* Border Area BSD from bsdline.kmz */
      const bsdEntities: any[] = [];
      const flat3D: number[] = [];
      BSD_LINE_COORDINATES.forEach(([lon, lat]) => {
        flat3D.push(lon, lat, 1);
      });
      const bsdGlowBorder = viewer.entities.add({
        name: 'BSD City Border Glow',
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat3D),
          width: 6,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            taperPower: 0.9,
            color: Cesium.Color.fromCssColorString('#ffaa00')
          }),
          clampToGround: false
        }
      });
      bsdEntities.push(bsdGlowBorder);
      const bsdCoreBorder = viewer.entities.add({
        name: 'BSD City Border Core',
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat3D),
          width: 2.0,
          material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#fff4e0').withAlpha(0.95)),
          clampToGround: false
        }
      });
      bsdEntities.push(bsdCoreBorder);
      (viewer as any).__bsdHighlightEntities = bsdEntities; /* Initial static districts + dynamic camera moveEnd listener */
      referenceLabels.show = false;
      const layers = {
        district: [] as any[],
        labels: referenceLabels
      };
      const addLabel = (name: string, lon: number, lat: number, color = '#e2e8f0') => {
        return viewer.entities.add({
          name,
          show: false,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 8),
          label: {
            text: name,
            font: '500 12px Geist, sans-serif',
            fillColor: Cesium.Color.fromCssColorString(color),
            outlineColor: Cesium.Color.fromCssColorString('#090d16'),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 65000)
          }
        });
      };
      DISTRICTS.forEach(district => {
        layers.district.push(addLabel(district.name, ...district.coord));
      });
      layersRef.current = layers;
      /* Pin projection each frame (includes custom searched POIs) */
      const onPostRender = viewer.scene.postRender.addEventListener(() => {
        const allLocs: {
          id: string;
          lon: number;
          lat: number;
          height: number;
        }[] = [hubRef.current, ...poisRef.current];
        const camHeight = viewer.camera.positionCartographic.height;
        allLocs.forEach(loc => {
          const el = pinRefs.current[loc.id];
          if (!el) return;
          if (camHeight > 75000 || !showTooltipsRef.current) {
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
      const startCinematicOrbit = () => {
        const C = (window as any).Cesium;
        if (!C || !viewer || viewer.isDestroyed()) return;
        viewer.camera.cancelFlight();
        orbitHeadingRef.current = viewer.camera.heading || 0;
        const sphere = routeSphereRef.current || freeRoamSphereRef.current || getFreeRoamSphere(viewer, C, hubRef.current);
        freeRoamSphereRef.current = sphere;
        const currentDist = C.Cartesian3.distance(viewer.camera.positionWC, sphere.center);
        orbitRangeRef.current = currentDist;
        orbitSpinUpStartRef.current = performance.now(); /* Smooth Ease-In-Out pull-back zoom out when starting orbit */
        triggerSmoothOrbitZoom(Math.max(currentDist * 1.28, 1650), 1800);
        autoRotateRef.current = true;
        setAutoRotate(true);
        setShowRotateSlider(true);
      };
      (viewer as any).__startCinematicOrbit = startCinematicOrbit;
      const onIntroArrived = () => {
        if (cancelled || !autoArrivalRef.current) return;
        startCinematicOrbit();
      };
      viewer.__onIntroArrived = onIntroArrived;
      function playGlobeIntro(C: any) {
        const generation = ++introGenerationRef.current;
        viewer.camera.setView({
          destination: C.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat, 6500000.0),
          orientation: {
            heading: 0.0,
            pitch: C.Math.toRadians(-90.0),
            roll: 0.0
          }
        });
        setTimeout(() => {
          if (cancelled || generation !== introGenerationRef.current || autoRotateRef.current || activePoiRef.current) return;
          viewer.camera.flyTo({
            destination: C.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat, 2500.0),
            orientation: {
              heading: C.Math.toRadians(0.0),
              pitch: C.Math.toRadians(-90.0),
              roll: 0.0
            },
            duration: 3.0,
            easingFunction: C.EasingFunction.CUBIC_IN_OUT,
            complete: () => {
              if (cancelled || generation !== introGenerationRef.current || autoRotateRef.current || activePoiRef.current) return;
              viewer.camera.flyTo({
                destination: C.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat - 0.012, 1050.0),
                orientation: {
                  heading: C.Math.toRadians(0.0),
                  pitch: C.Math.toRadians(-38.0),
                  roll: 0.0
                },
                duration: 1.5,
                easingFunction: C.EasingFunction.QUADRATIC_OUT,
                complete: onIntroArrived
              });
            }
          });
        }, 1200);
      }
      (viewer as any).__playGlobeIntro = playGlobeIntro; /* Drag detection, Map Pick click detection & Smooth Ease-In-Out Wheel Zoom during autorotate */
      let isPointerDown = false;
      let startX = 0;
      let startY = 0;
      let movedDuringPress = false;
      let activePointers = 0;
      const onPointerDown = (e: PointerEvent) => {
        isPointerDown = true;
        movedDuringPress = false;
        startX = e.clientX;
        startY = e.clientY;
        activePointers++;
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!isPointerDown) return;
        if (activePointers > 1) return;
        const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (dist > 6) {
          movedDuringPress = true;
          if (autoRotateRef.current) {
            autoRotateRef.current = false;
            setAutoRotate(false);
            orbitRangeRef.current = null;
            orbitAnimTargetRangeRef.current = null;
            freeRoamSphereRef.current = null;
          }
        }
      };
      const onPointerUp = async (e: PointerEvent) => {
        const wasClick = isPointerDown && !movedDuringPress && activePointers <= 1;
        isPointerDown = false;
        activePointers = Math.max(0, activePointers - 1); /* Handle Free Roam Map Pick Mode (Click on Globe to set Hub A or Destination B) */
        if (wasClick && mapPickModeRef.current && viewerRef.current) {
          const C = (window as any).Cesium;
          const rect = viewer.canvas.getBoundingClientRect();
          const clickPos = new C.Cartesian2(e.clientX - rect.left, e.clientY - rect.top);
          const ray = viewer.camera.getPickRay(clickPos);
          let cartesian = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
          if (!cartesian) {
            cartesian = viewer.camera.pickEllipsoid(clickPos, viewer.scene.globe.ellipsoid);
          }
          if (cartesian) {
            const carto = C.Cartographic.fromCartesian(cartesian);
            const lat = Number(C.Math.toDegrees(carto.latitude).toFixed(6));
            const lon = Number(C.Math.toDegrees(carto.longitude).toFixed(6));
            const currentMode = mapPickModeRef.current;
            setMapPickMode(null);
            const placeLabel = await reverseGeocodeName(lat, lon);
            if (currentMode === 'hub') {

              applyNewHubPoint({
                id: 'hub',
                name: placeLabel,
                lat,
                lon,
                height: 75,
                sub: 'Starting point selected'
              });
            } else if (currentMode === 'dest') {

              addPlace({
                name: placeLabel,
                lat,
                lon
              });
            } else if (currentMode === 'place') {
              const targetId = placePickIdRef.current;
              setPlacePickId(null);
              if (targetId) {
                setPois(prev => prev.map(item => item.id === targetId ? {
                  ...item,
                  lat,
                  lon
                } : item));
              }
            }
          }
        }
      };
      const onPointerCancel = () => {
        isPointerDown = false;
        activePointers = Math.max(0, activePointers - 1);
      }; /* Point 5: Smooth Ease-In-Out Wheel Zoom while Auto-Rotate is running */
      const onWheel = (e: WheelEvent) => {
        if (autoRotateRef.current && viewerRef.current) {
          const C = (window as any).Cesium;
          if (C) {
            const sphere = routeSphereRef.current || freeRoamSphereRef.current || getFreeRoamSphere(viewerRef.current, C, hubRef.current);
            if (orbitRangeRef.current === null) {
              orbitRangeRef.current = C.Cartesian3.distance(viewerRef.current.camera.positionWC, sphere.center);
            }
            const baseTarget = orbitAnimTargetRangeRef.current ?? orbitRangeRef.current ?? 1500;
            const factor = e.deltaY > 0 ? 1.24 : 0.8;
            triggerSmoothOrbitZoom(baseTarget * factor, 650);
          }
        }
      };
      const canvas = viewer.canvas;
      canvas.addEventListener('pointerdown', onPointerDown, {
        passive: true
      });
      canvas.addEventListener('pointermove', onPointerMove, {
        passive: true
      });
      canvas.addEventListener('pointerup', onPointerUp, {
        passive: true
      });
      canvas.addEventListener('pointercancel', onPointerCancel, {
        passive: true
      });
      canvas.addEventListener('wheel', onWheel, {
        passive: true
      });
      removeCanvasListeners = () => {
        try {
          canvas.removeEventListener('pointerdown', onPointerDown);
          canvas.removeEventListener('pointermove', onPointerMove);
          canvas.removeEventListener('pointerup', onPointerUp);
          canvas.removeEventListener('pointercancel', onPointerCancel);
          canvas.removeEventListener('wheel', onWheel);
        } catch {/* ignore */}
      };
      playGlobeIntro(Cesium);
      setStatus('ready');
    }).catch((err: Error) => {
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
      destSearchRequestRef.current?.abort();
      recordingSessionRef.current?.dispose();
      if (recordAnimRef.current) cancelAnimationFrame(recordAnimRef.current);
      if (recordingIntroRef.current) clearTimeout(recordingIntroRef.current);
      recordCanvasRef.current = null;
      layersRef.current = null;
      if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
      trailAnimRef.current = null;
      const viewer = viewerRef.current;
      if (viewer) {
        try {
          viewer.scene.postRender.removeEventListener((viewer as any).__onPostRender);
        } catch {/* ignore */}
        viewer.destroy();
      }
      viewerRef.current = null;
      routeEntitiesRef.current = [];
      trailEntityRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Create one viewer; event callbacks read current values through refs.
  }, []); /* Toggle the local district labels. */
  useEffect(() => {
    const layers = layersRef.current;
    if (!layers || status !== 'ready') return;
    layers.district.forEach(entity => {
      entity.show = showDistricts;
    });
    layers.labels.show = showEsriLabels;

  }, [status, showDistricts, showEsriLabels]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (status !== 'ready' || !viewer) return;
    viewer.__bsdHighlightEntities?.forEach((entity: any) => {
      entity.show = showBsd;
    });
  }, [status, showBsd]);
  useEffect(() => {
    mapSkinRef.current = mapSkin;
    const layers = skinLayersRef.current;
    if (!layers) return;
    Object.entries(layers).forEach(([skin, layer]) => {
      layer.show = skin === mapSkin;
    });
  }, [mapSkin]);
  useEffect(() => {
    placeOverridesRef.current = placeOverrides;
  }, [placeOverrides]);
  useEffect(() => {
    routeInfoRef.current = routeInfo;
  }, [routeInfo]); /* Save daftar places tiap kali berubah (biar ga ilang pas refresh) */
  useEffect(() => {
    if (!poisReady) return;
    try {
      localStorage.setItem(POIS_KEY, JSON.stringify(pois));
    } catch {/* quota penuh: daftar tetap jalan untuk sesi ini */}
  }, [pois, poisReady]); /* Data tol lokal (public/data/tol.geojson) — toggle show/hide, tanpa request Overpass */
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (status !== 'ready' || !viewer || !C) return;
    if (tollCollectionRef.current) return; /* sudah dimuat; visibility diatur effect terpisah */
    let cancelled = false;
    loadTollGeoJson().then(lines => {
      if (cancelled || viewer.isDestroyed()) return;
      const collection = new C.PolylineCollection();
      const material = C.Material.fromType('PolylineGlow', {
        glowPower: 0.25,
        color: C.Color.fromCssColorString('#1188c7').withAlpha(0.9)
      });
      for (const line of lines) {
        const flat: number[] = [];
        line.coords.forEach(([lon, lat]) => flat.push(lon, lat, 3.5));
        collection.add({
          positions: C.Cartesian3.fromDegreesArrayHeights(flat),
          width: 4,
          material
        });
      }
      viewer.scene.primitives.add(collection);
      collection.show = tollVisibilityRef.current.roads;
      tollCollectionRef.current = collection; /* Toll road names: satu label per nama (bukan per segments), muncul saat dekat. */
      const labelData = buildTollLabels(lines);
      const labels = new C.LabelCollection();
      for (const item of labelData) {
        labels.add({
          position: C.Cartesian3.fromDegrees(item.lon, item.lat, 12),
          text: item.name,
          font: '500 11px Geist, sans-serif',
          fillColor: C.Color.fromCssColorString('#e8f6ff'),
          outlineColor: C.Color.fromCssColorString('#04212f'),
          outlineWidth: 3,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString('#0b2b3d').withAlpha(0.7),
          backgroundPadding: new C.Cartesian2(6, 4),
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 60000)
        });
      }
      viewer.scene.primitives.add(labels);
      labels.show = tollVisibilityRef.current.roads && tollVisibilityRef.current.labels;
      tollLabelsRef.current = labels;
      setTollLabelCount(labelData.length);
      setTollCount(lines.length);
      setTollReady(true);
      setTollError('');
    }).catch(err => {
      if (cancelled) return;
      setTollError(err instanceof Error ? err.message : 'Failed to load local toll road data.');
    });
    return () => {
      cancelled = true;
    };
  }, [status]);
  useEffect(() => {
    if (tollCollectionRef.current) tollCollectionRef.current.show = showTolls;
    if (tollLabelsRef.current) tollLabelsRef.current.show = showTolls && showTollLabels;
  }, [showTolls, showTollLabels]); /* Load railway lines and stations from local GeoJSON. */
  const railwayEntitiesRef = useRef<any[]>([]);
  const [railwayStatus, setRailwayStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  const [railwayError, setRailwayError] = useState('');
  const [railwayCount, setRailwayCount] = useState(0);
  useEffect(() => {
    const viewer = viewerRef.current;
    const C = (window as any).Cesium;
    if (status !== 'ready' || !viewer || !C || !showRailways) return;
    const request = new AbortController();
    let cancelled = false;
    setRailwayStatus('loading');
    setRailwayError('');
    loadRailwayGeoJson(undefined, request.signal).then(data => {
      if (cancelled || viewer.isDestroyed()) return;
      if (!data) {
        setRailwayStatus('missing');
        return;
      }
      const {
        lines: railLines,
        stations
      } = data;
      const createdRail: any[] = []; /* Render Railways */
      for (const line of railLines) {
        const flat: number[] = [];
        line.forEach(([lon, lat]) => flat.push(lon, lat, 4.0));
        const entity = viewer.entities.add({
          name: 'Railway',
          show: true,
          polyline: {
            positions: C.Cartesian3.fromDegreesArrayHeights(flat),
            width: 5.5,
            material: new C.PolylineOutlineMaterialProperty({
              color: C.Color.fromCssColorString('#f1f5f9'),
              outlineColor: C.Color.fromCssColorString('#374151'),
              outlineWidth: 2,
            }),
            clampToGround: false
          }
        });
        createdRail.push(entity);
      } /* Render Train Stations with Label */
      const seenStationKeys = new Set<string>();
      for (const st of stations) {
        const stKey = `${st.name}-${st.lat.toFixed(3)}-${st.lon.toFixed(3)}`;
        if (seenStationKeys.has(stKey)) continue;
        seenStationKeys.add(stKey);
        const stEntity = viewer.entities.add({
          name: st.name,
          show: true,
          position: C.Cartesian3.fromDegrees(st.lon, st.lat, 12),
          point: {
            pixelSize: 8,
            color: C.Color.fromCssColorString('#f8fafc'),
            outlineColor: C.Color.fromCssColorString('#374151'),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: st.name,
            font: '600 12px Geist, sans-serif',
            fillColor: C.Color.fromCssColorString('#f8fafc'),
            outlineColor: C.Color.fromCssColorString('#090d16'),
            outlineWidth: 3,
            style: C.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: C.VerticalOrigin.BOTTOM,
            pixelOffset: new C.Cartesian2(0, -10),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new C.DistanceDisplayCondition(0, 45000)
          }
        });
        createdRail.push(stEntity);
      }
      railwayEntitiesRef.current = createdRail;
      setRailwayCount(railLines.length + seenStationKeys.size);
      setRailwayStatus('ready');
    }).catch((error: unknown) => {
      if (cancelled || viewer.isDestroyed()) return;
      setRailwayError(error instanceof Error ? error.message : 'Failed to load local railway data.');
      setRailwayStatus('error');
    });
    return () => {
      cancelled = true;
      request.abort();
      if (!viewer.isDestroyed()) railwayEntitiesRef.current.forEach(entity => viewer.entities.remove(entity));
      railwayEntitiesRef.current = [];
    };
  }, [status, showRailways]); /* 3-Second Trim Path animation with Orange Glow & Leading Marker */
  const runTrimPathRoute = (Cesium: any, coords: [number, number][]) => {
    const viewer = viewerRef.current;
    if (!viewer || coords.length < 2) return;
    if (routeEntitiesRef.current.length) {
      routeEntitiesRef.current.forEach(e => viewer.entities.remove(e));
      routeEntitiesRef.current = [];
    }
    if (trailEntityRef.current) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
    const cumulative = buildCumulative(coords);
    const totalDist = cumulative[cumulative.length - 1] || 1;
    const durationMs = 3000;
    let activePositions: any[] = [Cesium.Cartesian3.fromDegrees(coords[0][0], coords[0][1], ROUTE_HEIGHT_M)];
    let headPosition = Cesium.Cartesian3.fromDegrees(coords[0][0], coords[0][1], ROUTE_HEIGHT_M + 2.5);
    const glowRoute = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => activePositions, false),
        width: 8,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.45,
          taperPower: 0.85,
          color: Cesium.Color.fromCssColorString('#ff5500')
        }),
        clampToGround: false
      }
    });
    const coreRoute = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => activePositions, false),
        width: 3,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#ffb347')),
        clampToGround: false
      }
    });
    const tracerHead = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => headPosition, false),
      point: {
        pixelSize: 13,
        color: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#ff5500'),
        outlineWidth: 4,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    routeEntitiesRef.current = [glowRoute, coreRoute];
    trailEntityRef.current = tracerHead;
    let startedAt = 0;
    const step = (now: number) => {
      if (!startedAt) startedAt = now;
      const t = Math.min((now - startedAt) / durationMs, 1);
      const eased = easeInOutCubic(t);
      const targetDist = totalDist * eased;
      let lo = 0;
      let hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumulative[mid] < targetDist) lo = mid + 1;else hi = mid;
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
        const fullFlat: number[] = [];
        coords.forEach(([cLon, cLat]) => fullFlat.push(cLon, cLat, ROUTE_HEIGHT_M));
        activePositions = Cesium.Cartesian3.fromDegreesArrayHeights(fullFlat);
        headPosition = Cesium.Cartesian3.fromDegrees(coords[coords.length - 1][0], coords[coords.length - 1][1], ROUTE_HEIGHT_M + 2.5);
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
    camera.setView({
      destination: oldPosition,
      orientation: {
        direction: oldDirection,
        up: oldUp
      }
    });
    camera.flyTo({
      destination,
      orientation: {
        direction,
        up
      },
      duration,
      complete,
      easingFunction: C.EasingFunction.QUADRATIC_IN_OUT
    });
  };
  const selectDestination = async (poi: Poi) => {
    const Cesium = (window as any).Cesium;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    if (window.innerWidth < 1000) setSidebarOpen(false);
    introGenerationRef.current++;
    setActivePoi(poi.id);
    activePoiRef.current = poi.id;
    orbitRangeRef.current = null;
    orbitAnimTargetRangeRef.current = null;
    freeRoamSphereRef.current = null;
    setRouteInfo(null);
    routeRequestRef.current?.abort();
    const request = new AbortController();
    routeRequestRef.current = request;
    const timeout = setTimeout(() => request.abort(), 10000);
    if (routeEntitiesRef.current.length) {
      routeEntitiesRef.current.forEach(e => viewer.entities.remove(e));
      routeEntitiesRef.current = [];
    }
    if (trailEntityRef.current) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
    let coords: [number, number][] = [];
    let distanceKm = 0;
    let durationMin = 0;
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${hubRef.current.lon},${hubRef.current.lat};${poi.lon},${poi.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url, {
        signal: request.signal
      });
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const data = await res.json();
      const geom = data?.routes?.[0]?.geometry?.coordinates as [number, number][];
      if (!geom?.length) throw new Error('Empty route');
      distanceKm = data.routes[0].distance / 1000;
      durationMin = data.routes[0].duration / 60;
      coords = geom;
    } catch {
      coords = [[hubRef.current.lon, hubRef.current.lat], [poi.lon, poi.lat]];
      distanceKm = haversineKm([hubRef.current.lon, hubRef.current.lat], [poi.lon, poi.lat]) * 1.25;
      durationMin = distanceKm / 35 * 60;
    }
    clearTimeout(timeout);
    if (window.innerWidth < 1000) await new Promise(resolve => setTimeout(resolve, 320));
    if (routeRequestRef.current !== request || viewer.isDestroyed()) return;
    setRouteInfo({
      distanceKm,
      durationMin
    }); /* Update custom POI estimated time/distance badge */
    setPois(prev => prev.map(item => item.id === poi.id ? {
      ...item,
      estTime: `${Math.max(1, Math.round(durationMin))} min`,
      estDist: `${distanceKm.toFixed(1)} km`
    } : item));
    const positions = [...coords, [hubRef.current.lon, hubRef.current.lat], [poi.lon, poi.lat]].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 75));
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    sphere.radius = Math.max(sphere.radius, 250);
    routeSphereRef.current = sphere;
    if (!autoRotateRef.current) {
      flyToRouteSphere(sphere);
    } else {
      /* If already auto-rotating, smoothly adjust orbit range to fit the new route! */
      const canvas = viewer.canvas;
      const halfFov = viewer.camera.frustum.fovy / 2;
      const idealRange = Math.max(1200, sphere.radius / Math.sin(halfFov) * 1.35);
      if (canvas) triggerSmoothOrbitZoom(idealRange, 1400);
    }
    runTrimPathRoute(Cesium, coords);
  };
  const setFreeRoam = () => {
    introGenerationRef.current++;
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      viewer.camera.cancelFlight();
    }
    if (routeEntitiesRef.current.length && viewer) {
      routeEntitiesRef.current.forEach(e => viewer.entities.remove(e));
      routeEntitiesRef.current = [];
    }
    if (trailEntityRef.current && viewer) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
    routeRequestRef.current?.abort();
    routeRequestRef.current = null;
    routeSphereRef.current = null;
    freeRoamSphereRef.current = null;
    orbitRangeRef.current = null;
    orbitAnimTargetRangeRef.current = null;
    activePoiRef.current = null;
    setActivePoi(null);
    setRouteInfo(null);
    setMapPickMode(null);
  };
  const resetToHub = () => {
    introGenerationRef.current++;
    const Cesium = (window as any).Cesium;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    if (routeEntitiesRef.current.length) {
      routeEntitiesRef.current.forEach(e => viewer.entities.remove(e));
      routeEntitiesRef.current = [];
    }
    if (trailEntityRef.current) viewer.entities.remove(trailEntityRef.current);
    if (trailAnimRef.current) cancelAnimationFrame(trailAnimRef.current);
    routeRequestRef.current?.abort();
    routeRequestRef.current = null;
    routeSphereRef.current = null;
    freeRoamSphereRef.current = null;
    orbitRangeRef.current = null;
    orbitAnimTargetRangeRef.current = null;
    activePoiRef.current = null;
    setActivePoi(null);
    setRouteInfo(null);
    if (!autoRotateRef.current) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat - 0.016, 1150.0),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-32),
          roll: 0
        },
        duration: 2.5
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
    orbitAnimTargetRangeRef.current = null;
    activePoiRef.current = null;
    setActivePoi(null);
    setRouteInfo(null);
    autoRotateRef.current = false;
    setAutoRotate(false);
    viewer.camera.cancelFlight();
    viewer.__playGlobeIntro(C);
  };
  const flyToMacroOverview = () => {
    if (autoRotateRef.current) {
      /* Smoothly zoom out to Macro Overview while continuing auto-rotate! */
      triggerSmoothOrbitZoom(14500, 2000);
      return;
    }
    const Cesium = (window as any).Cesium;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat - 0.045, 14500.0),
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-40.0),
        roll: 0.0
      },
      duration: 2.8,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT
    });
  }; /* Point 5: Auto-Rotate loop with Cubic Ease-In-Out Zoom Out/In & Smooth Spin-Up */
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
          freeRoamSphereRef.current = sphere; /* Smooth Ease-In-Out Range interpolation (for pull-back intro & wheel/button zoom) */
          if (orbitAnimStartRangeRef.current !== null && orbitAnimTargetRangeRef.current !== null) {
            const elapsed = now - orbitAnimStartTimeRef.current;
            const duration = Math.max(100, orbitAnimDurationMsRef.current);
            const t = Math.min(1, elapsed / duration);
            const eased = easeInOutCubic(t);
            orbitRangeRef.current = orbitAnimStartRangeRef.current + (orbitAnimTargetRangeRef.current - orbitAnimStartRangeRef.current) * eased;
            if (t >= 1) {
              orbitAnimStartRangeRef.current = null;
            }
          } /* Smooth angular velocity spin-up (ease-in-out over first 1.5s) */
          const spinElapsed = Math.min(1, (now - orbitSpinUpStartRef.current) / 1500);
          const spinFactor = easeInOutCubic(spinElapsed);
          orbitHeadingRef.current += 0.16 * rotateSpeedRef.current * spinFactor * dt; /* Dynamic pitch that gently looks more top-down when zoomed far out */
          const activeRange = orbitRangeRef.current ?? 1800;
          const zoomRatio = Math.min(1, Math.max(0, (activeRange - 1200) / 15000));
          const dynamicPitchDeg = -36 - zoomRatio * 12;
          const camera = viewer.camera;
          const previousPosition = camera.positionWC.clone();
          const previousDirection = camera.directionWC.clone();
          const previousUp = camera.upWC.clone();
          positionRouteCamera(viewer, Cesium, sphere, orbitHeadingRef.current, orbitRangeRef.current, dynamicPitchDeg);
          const blend = 1 - Math.exp(-7.5 * dt);
          const destination = Cesium.Cartesian3.lerp(previousPosition, camera.positionWC, blend, new Cesium.Cartesian3());
          const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.lerp(previousDirection, camera.directionWC, blend, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          const blendedUp = Cesium.Cartesian3.lerp(previousUp, camera.upWC, blend, new Cesium.Cartesian3());
          const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(direction, blendedUp, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
          camera.setView({
            destination,
            orientation: {
              direction,
              up
            }
          });
        }
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }; /* Video recording handler */
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
    } catch {/* ignore */}
    if (viewer.isDestroyed()) return;
    viewer.resize();
    const cesiumCanvas = viewer.canvas;
    const recCanvas = document.createElement('canvas');
    recCanvas.width = cesiumCanvas.width;
    recCanvas.height = cesiumCanvas.height;
    recordCanvasRef.current = recCanvas;
    setRecordError(null);
    const drawRecordFrame = () => {
      if (!recordCanvasRef.current || viewer.isDestroyed()) return;
      const curRecCanvas = recordCanvasRef.current;
      const curCesiumCanvas = viewer.canvas;
      const ctx = curRecCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(curCesiumCanvas, 0, 0, curRecCanvas.width, curRecCanvas.height);
      ctx.save();
      ctx.scale(curRecCanvas.width / curCesiumCanvas.clientWidth, curRecCanvas.height / curCesiumCanvas.clientHeight);
      if (showTooltipsRef.current) {
        const camHeight = viewer.camera.positionCartographic.height;
        if (camHeight <= 75000) {
          const curPois = poisRef.current;
          const allLocs = [...curPois.filter(p => p.id !== activePoiRef.current), hubRef.current, ...curPois.filter(p => p.id === activePoiRef.current)].filter(loc => !placeOverridesRef.current[loc.id]?.hidden);
          allLocs.forEach(loc => {
            const cartesian = Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, loc.height || 60);
            const pos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
            if (pos && pos.x >= -100 && pos.x <= curRecCanvas.width + 100 && pos.y >= -100 && pos.y <= curRecCanvas.height + 100) {
              const isHub = loc.id === 'hub';
              const isActive = activePoiRef.current === loc.id;
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(pos.x, pos.y);
              ctx.lineTo(pos.x, pos.y - 36);
              ctx.lineWidth = 2;
              ctx.strokeStyle = isActive ? '#ff5500' : isHub ? '#ff9900' : 'rgba(255,255,255,0.95)';
              ctx.shadowColor = 'rgba(0,0,0,0.5)';
              ctx.shadowBlur = 4;
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, isActive ? 6 : isHub ? 5 : 4, 0, Math.PI * 2);
              ctx.fillStyle = isActive ? '#ff5500' : isHub ? '#ff9900' : '#ffffff';
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.strokeStyle = '#0f172a';
              ctx.stroke();
              let name = placeName(loc.id, loc.name, placeOverridesRef.current);
              ctx.font = '500 12px Geist, sans-serif';
              if (ctx.measureText(name).width > 200) {
                while (name.length > 1 && ctx.measureText(name + '...').width > 200) name = name.slice(0, -1);
                name += '...';
              } /* Sub-baris: label custom user, kalau tidak ada pakai estimasi waktu & jarak */
              const info = routeInfoRef.current;
              const customSub = placeOverridesRef.current[loc.id]?.label?.trim();
              let sub = '';
              if (customSub) sub = customSub;else if (isHub) sub = 'Starting Point (0 km)';else if (isActive && info) sub = `~${Math.round(info.durationMin)} min · ${info.distanceKm.toFixed(1)} km`;else if ((loc as Poi).estTime && (loc as Poi).estDist) sub = `~${(loc as Poi).estTime} · ${(loc as Poi).estDist}`;
              ctx.font = '400 10px Geist, sans-serif';
              if (sub && ctx.measureText(sub).width > 200) {
                while (sub.length > 1 && ctx.measureText(sub + '...').width > 200) sub = sub.slice(0, -1);
                sub += '...';
              }
              ctx.font = '500 12px Geist, sans-serif';
              const textWidth = ctx.measureText(name).width;
              ctx.font = '400 10px Geist, sans-serif';
              const subWidth = sub ? ctx.measureText(sub).width : 0;
              const pillW = Math.max(textWidth, subWidth) + 24;
              const pillH = sub ? 40 : 26;
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
              ctx.font = '500 12px Geist, sans-serif';
              ctx.fillText(name, pos.x, sub ? pillY + 14 : pillY + pillH / 2);
              if (sub) {
                ctx.font = '400 10px Geist, sans-serif';
                ctx.globalAlpha = 0.82;
                ctx.fillText(sub, pos.x, pillY + 29);
                ctx.globalAlpha = 1;
              }
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
      ctx.fillText(`Imagery: ${MAP_SKINS.find(skin => skin.id === mapSkinRef.current)?.label ?? 'Esri World Imagery'} | Routing: OSRM / OpenStreetMap`, 8, curRecCanvas.height - 8);
      ctx.restore();
      recordAnimRef.current = requestAnimationFrame(drawRecordFrame);
    };
    try {
      drawRecordFrame();
      recordingSessionRef.current = startMp4Recording(recCanvas, {
        onTick: setRecordingSeconds,
        onError: err => {
          finishRecording();
          setRecordError(err.message);
        },
        onComplete: blob => {
          finishRecording();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `BSD_City_Cinematic_${Date.now()}.mp4`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        }
      });
      setIsRecording(true);
      setRecordingSeconds(0);
      if (recordWithEarthIntro && !autoRotateRef.current) {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat, 6500000.0),
          orientation: {
            heading: 0.0,
            pitch: Cesium.Math.toRadians(-90.0),
            roll: 0.0
          }
        });
        recordingIntroRef.current = setTimeout(() => {
          if (viewer.isDestroyed() || !recordingSessionRef.current || autoRotateRef.current) return;
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat, 2500.0),
            orientation: {
              heading: Cesium.Math.toRadians(0.0),
              pitch: Cesium.Math.toRadians(-90.0),
              roll: 0.0
            },
            duration: 3.2,
            easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
            complete: () => {
              if (viewer.isDestroyed() || !recordingSessionRef.current || autoRotateRef.current) return;
              if (routeSphereRef.current) {
                flyToRouteSphere(routeSphereRef.current, 1.6, viewer.__onIntroArrived);
                return;
              }
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(hubRef.current.lon, hubRef.current.lat - 0.012, 1050.0),
                orientation: {
                  heading: Cesium.Math.toRadians(0.0),
                  pitch: Cesium.Math.toRadians(-38.0),
                  roll: 0.0
                },
                duration: 1.6,
                easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
                complete: viewer.__onIntroArrived
              });
            }
          });
        }, 600);
      }
    } catch (err) {
      finishRecording();
      setRecordError(err instanceof Error ? err.message : 'Failed to start MP4 recording.');
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
  const stopRecording = () => {
    recordingSessionRef.current?.stop();
  };
  const persistPreferences = (point: StartPoint, arrival: boolean, skin: MapSkin = mapSkinRef.current) => {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
        hub: point,
        autoRotateOnArrival: arrival,
        skin
      }));
      return true;
    } catch {
      setHubMessage('Point updated, but browser storage is restricted.');
      return false;
    }
  }; /* Point 1: Apply new Starting Point (Hub 0 km) from Omnibox or Map Pick */
  function applyNewHubPoint(point: StartPoint) {
    hubRef.current = point;
    setHub(point);
    setHubResults([]);
    setHubQuery('');
    setHubEditorOpen(false);
    autoRotateRef.current = false;
    setAutoRotate(false);
    viewerRef.current?.camera.cancelFlight();
    resetToHub();
    if (persistPreferences(point, autoArrivalRef.current)) {
      setHubMessage(`Starting point set to: ${point.name}`);
    }
  }
  const handleHubOmniboxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = hubQuery.trim();
    if (!raw || hubSearchBusy) return; /* 1. Direct coordinate paste check (instant) */
    const parsedCoords = parseSmartCoordinates(raw);
    if (parsedCoords) {
      setHubSearchBusy(true);
      setHubMessage('Detecting coordinates...');
      const placeName = await reverseGeocodeName(parsedCoords.lat, parsedCoords.lon);
      setHubSearchBusy(false);
      const point = parseStartPoint(placeName, String(parsedCoords.lat), String(parsedCoords.lon));
      applyNewHubPoint(point);
      return;
    } /* 2. Otherwise search place by name */
    const cacheKey = raw.toLowerCase();
    if (searchCacheRef.current.has(cacheKey)) {
      const cached = searchCacheRef.current.get(cacheKey)!;
      setHubResults(cached);
      if (cached.length === 1) applyNewHubPoint(cached[0]);
      return;
    }
    searchRequestRef.current?.abort();
    const request = new AbortController();
    searchRequestRef.current = request;
    setHubSearchBusy(true);
    setHubResults([]);
    setHubMessage('Searching for places...');
    try {
      const points = await searchPlacesOmnibox(raw, hubRef.current.lat, hubRef.current.lon, request.signal);
      if (searchRequestRef.current !== request) return;
      searchCacheRef.current.set(cacheKey, points);
      setHubResults(points);
      setHubMessage(points.length ? 'Choose a result below to set the starting point:' : 'No results. Try another name or paste latitude, longitude.');
    } catch (err: any) {
      if (searchRequestRef.current === request && err?.name !== 'AbortError') {
        setHubMessage('Place search failed. Try pasting latitude, longitude.');
      }
    } finally {
      if (searchRequestRef.current === request) setHubSearchBusy(false);
    }
  }; /* Point 2: Apply Custom Destination (Titik B) from Omnibox or Map Pick */
  function addPlace(target: {
    name: string;
    lat: number;
    lon: number;
  }) {
    const distKm = haversineKm([hubRef.current.lon, hubRef.current.lat], [target.lon, target.lat]) * 1.25;
    const estMin = Math.max(1, Math.round(distKm / 35 * 60));
    const newPoi: Poi = {

      id: `custom-${Date.now()}`,
      name: target.name,
      lat: target.lat,
      lon: target.lon,
      height: 62,
      estTime: `${estMin} min`,
      estDist: `${distKm.toFixed(1)} km`,
      category: 'custom'
    };
    setPois(prev => [newPoi, ...prev]);
    setDestResults([]);
    setDestQuery('');
    setDestSearchOpen(false);
    setDestMessage('');

  }
  const handleDestOmniboxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = destQuery.trim();
    if (!raw || destSearchBusy) return; /* 1. Direct coordinate paste check */
    const parsedCoords = parseSmartCoordinates(raw);
    if (parsedCoords) {
      setDestSearchBusy(true);
      setDestMessage('Detecting place coordinates...');
      const placeName = await reverseGeocodeName(parsedCoords.lat, parsedCoords.lon);
      setDestSearchBusy(false);
      addPlace({
        name: placeName,
        lat: parsedCoords.lat,
        lon: parsedCoords.lon
      });
      return;
    } /* 2. Otherwise search place by name */
    destSearchRequestRef.current?.abort();
    const request = new AbortController();
    destSearchRequestRef.current = request;
    setDestSearchBusy(true);
    setDestResults([]);
    setDestMessage('Searching for places...');
    try {
      const points = await searchPlacesOmnibox(raw, hubRef.current.lat, hubRef.current.lon, request.signal);
      if (destSearchRequestRef.current !== request) return;
      setDestResults(points);
      setDestMessage(points.length ? 'Choose a result to add to Pinned Location:' : 'Place not found. Try another name or paste latitude, longitude.');
    } catch (err: any) {
      if (destSearchRequestRef.current === request && err?.name !== 'AbortError') {
        setDestMessage('Search failed. Try pasting latitude, longitude.');
      }
    } finally {
      if (destSearchRequestRef.current === request) setDestSearchBusy(false);
    }
  };
  const nameOf = (id: string, fallback: string) => placeName(id, fallback, placeOverrides); /** Satu pintu untuk mengubah override: state + localStorage (ref disinkronkan lewat effect). */
  const mutateOverrides = (mutator: (prev: PlaceOverrides) => PlaceOverrides) => {
    const next = mutator(placeOverrides);
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(next));
    } catch {/* quota penuh: override tetap berlaku untuk sesi ini */}
    setPlaceOverrides(next);
  };
  const updateOverride = (id: string, patch: PlaceOverride) => {
    mutateOverrides(prev => mergeOverride(prev, id, patch));
  };
  const openPlaceEditor = (id: string, name: string, label: string, lat: number, lon: number) => {
    setHubEditorOpen(false);
    setDestSearchOpen(false);
    setEditingPlaceId(prev => prev === id ? null : id);
    setEditNameDraft(name);
    setEditLabelDraft(label);
    setEditLatDraft(String(lat));
    setEditLonDraft(String(lon));
    setPlaceSearchQuery('');
    setPlaceSearchResults([]);
  }; /** Search places lewat omnibox (Esri/Photon/Nominatim) untuk memindah lokasi pin. */
  const runPlaceSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = placeSearchQuery.trim();
    if (!query || placeSearchBusy) return;
    setPlaceSearchBusy(true);
    try {
      const results = await searchPlacesOmnibox(query, hub.lat, hub.lon);
      setPlaceSearchResults(results.slice(0, 5));
    } catch {
      setPlaceSearchResults([]);
    } finally {
      setPlaceSearchBusy(false);
    }
  }; /** Pindahkan pin kehasil search (berlaku untuk Titik A maupun destinasi). */
  const movePlace = (id: string, target: {
    name: string;
    lat: number;
    lon: number;
  }) => {
    if (id === 'hub') {
      applyNewHubPoint({
        ...DEFAULT_START_POINT,
        name: target.name,
        lat: target.lat,
        lon: target.lon
      });
    } else {
      if (activePoi === id) setFreeRoam();
      setPois(prev => prev.map(item => item.id === id ? {
        ...item,
        lat: target.lat,
        lon: target.lon
      } : item));
    }
    setPlaceSearchResults([]);
    setPlaceSearchQuery('');
    setEditingPlaceId(null);
  };
  const commitPlaceEdit = (id: string, fallbackName: string, fallbackLabel: string, origin: {
    lat: number;
    lon: number;
  }) => {
    const cleanName = editNameDraft.trim().slice(0, 60);
    const cleanLabel = editLabelDraft.trim().slice(0, 40);
    updateOverride(id, {
      name: cleanName === fallbackName.trim() ? '' : cleanName,
      label: cleanLabel === fallbackLabel.trim() ? '' : cleanLabel
    });
    const lat = Number(editLatDraft);
    const lon = Number(editLonDraft);
    const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    const moved = valid && id !== 'hub' && (Math.abs(lat - origin.lat) > 1e-7 || Math.abs(lon - origin.lon) > 1e-7);
    if (moved) {
      if (activePoi === id) setFreeRoam();
      setPois(prev => prev.map(item => item.id === id ? {
        ...item,
        lat,
        lon
      } : item));
    }
    setEditingPlaceId(null);
  };
  const startPlacePick = (id: string) => {
    setPlacePickId(id);
    setEditingPlaceId(null);
    setMapPickMode('place');
  };
  const deletePlace = (id: string) => {
    if (activePoi === id) setFreeRoam();
    setPois(prev => prev.filter(item => item.id !== id));
    mutateOverrides(prev => removeOverride(prev, id));
    if (editingPlaceId === id) setEditingPlaceId(null);
  };
  const handleLogoPick = async (id: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const logo = await fileToLogoDataUrl(file);
    if (logo) updateOverride(id, {
      logo,
      ratio: placeOverrides[id]?.ratio ?? '3:2'
    });
  }; /** Save seluruh setup (hub, skin, nama/label/logo, daftar places) jadi file JSON. */
  const downloadSetup = () => {
    try {
      const bundle = buildSetupBundle({
        hub,
        autoRotateOnArrival,
        skin: mapSkin,
        places: placeOverrides,
        pois
      });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `maptiles-setup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSetupMessage(`Exported: ${pois.length} places.`);
    } catch {
      setSetupMessage('Failed to export settings.');
    }
  }; /** Pulihkan setup dari file JSON hasil ekspor. */
  const importSetup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const bundle = readSetupBundle(JSON.parse(await file.text()));
      if (!bundle) {
        setSetupMessage('Unrecognized settings JSON.');
        return;
      }
      const preferences = readPreferences(JSON.stringify({
        hub: bundle.hub,
        autoRotateOnArrival: bundle.autoRotateOnArrival,
        skin: bundle.skin
      }));
      const overrides = readPlaceOverrides(JSON.stringify(bundle.places ?? {}));
      hubRef.current = preferences.hub;
      autoArrivalRef.current = preferences.autoRotateOnArrival;
      mapSkinRef.current = preferences.skin;
      placeOverridesRef.current = overrides;
      setHub(preferences.hub);
      setAutoRotateOnArrival(preferences.autoRotateOnArrival);
      setMapSkin(preferences.skin);
      setPlaceOverrides(overrides);
      setPois(bundle.pois);
      setEditingPlaceId(null);
      setPlaceSearchResults([]);
      setSetupMessage(`Loaded: ${bundle.pois.length} places.`);
      try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
          hub: preferences.hub,
          autoRotateOnArrival: preferences.autoRotateOnArrival,
          skin: preferences.skin
        }));
        localStorage.setItem(PLACES_KEY, JSON.stringify(overrides));
        localStorage.setItem(POIS_KEY, JSON.stringify(bundle.pois));
      } catch {/* localStorage penuh */}
    } catch {
      setSetupMessage('Invalid JSON file.');
    }
  };
  const dropOnHub = (draggedId: string | null) => {
    if (!draggedId || draggedId === 'hub') return;
    const poi = pois.find(item => item.id === draggedId);
    if (!poi) return;
    applyNewHubPoint({
      ...DEFAULT_START_POINT,
      name: nameOf(poi.id, poi.name),
      lon: poi.lon,
      lat: poi.lat,
      height: poi.height
    });
  };
  const hubLabel = nameOf('hub', hub.name);
  const hubOverride = placeOverrides.hub || {};
  const renderPlaceEditor = (id: string, fallbackName: string, fallbackLabel: string, origin: {
    lat: number;
    lon: number;
  }) => <div className="mt-1 mb-2 space-y-2 rounded-xl border border-orange-400/60 bg-white/75 p-2.5 text-[11px] text-slate-800">
<form onSubmit={event => {
      event.preventDefault();

      commitPlaceEdit(id, fallbackName, fallbackLabel, origin);
    }} className="space-y-1.5">
<div className="flex gap-1.5">
<input aria-label={`Place name ${fallbackName}`} value={editNameDraft} onChange={event => setEditNameDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') setEditingPlaceId(null);
        }} autoFocus placeholder={fallbackName} className="min-w-0 flex-1 rounded-lg border border-slate-400/40 bg-white/90 px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500" />
<button type="submit" className="rounded-lg bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white transition">            Save          </button>
</div>
<input aria-label="Subtitle below the pin name" value={editLabelDraft} onChange={event => setEditLabelDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Escape') setEditingPlaceId(null);
      }} placeholder={fallbackLabel || 'Pin subtitle (optional)'} className="w-full rounded-lg border border-slate-400/40 bg-white/90 px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500" />        {id === 'hub' ? <button type="button" onClick={() => {
        setEditingPlaceId(null);
        setMapPickMode('hub');
      }} className="w-full rounded-lg border border-slate-400/50 bg-white/85 px-2 py-1 text-left hover:bg-white">            🎯 Pick a new location on the map          </button> : <div className="flex items-center gap-1">
<input aria-label="Latitude" inputMode="decimal" value={editLatDraft} onChange={event => setEditLatDraft(event.target.value)} placeholder="lat" className="w-0 flex-1 rounded-lg border border-slate-400/40 bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500" />
<input aria-label="Longitude" inputMode="decimal" value={editLonDraft} onChange={event => setEditLonDraft(event.target.value)} placeholder="lon" className="w-0 flex-1 rounded-lg border border-slate-400/40 bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500" />
<button type="button" aria-label="Pick a new location on the map" title="Pick a new location on the map" onClick={() => startPlacePick(id)} className="shrink-0 rounded-lg border border-slate-400/50 bg-white/85 px-2 py-1 hover:bg-white">              🎯            </button>
</div>}      </form>      {/* Pindah lokasi lewat pencarian nama places */}      <form onSubmit={runPlaceSearch} className="flex gap-1.5">
<input aria-label="Search for a new location for this place" value={placeSearchQuery} onChange={event => setPlaceSearchQuery(event.target.value)} placeholder="Search for a new location..." className="min-w-0 flex-1 rounded-lg border border-slate-400/40 bg-white/90 px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500" />
<button type="submit" disabled={placeSearchBusy || !placeSearchQuery.trim()} className="rounded-lg bg-orange-600 hover:bg-orange-700 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40 transition">          {placeSearchBusy ? '…' : 'Search'}        </button>
</form>      {placeSearchResults.length > 0 && <div className="max-h-28 space-y-1 overflow-y-auto cesium-glass-scroll">          {placeSearchResults.map((pt, idx) => (

      <button key={`${pt.lon}-${pt.lat}-${idx}`} type="button" onClick={() => movePlace(id, pt)} className="block w-full truncate rounded-lg bg-white/85 px-2 py-1 text-left text-[11px] text-slate-800 hover:bg-orange-500 hover:text-white transition">              📍 {pt.name}            </button>))}        </div>}      <div className="flex flex-wrap items-center gap-1.5">
<label className="cursor-pointer rounded-lg border border-slate-400/50 bg-white/85 px-2 py-1 font-medium hover:bg-white">          Logo          <input type="file" accept="image/*" className="hidden" onChange={event => void handleLogoPick(id, event)} />
</label>        {placeOverrides[id]?.logo ? <>            {LOGO_RATIOS.map(ratio => {
          const activeRatio = placeOverrides[id]?.ratio ?? '3:2';
          return <button key={ratio.id} type="button" aria-pressed={activeRatio === ratio.id} title={`Use logo for pin ${ratio.label}`} onClick={() => updateOverride(id, {
            ratio: ratio.id
          })} className={`rounded-lg border px-2 py-1 transition ${activeRatio === ratio.id ? 'border-orange-500 bg-orange-600 text-white' : 'border-slate-400/50 bg-white/85 text-slate-700 hover:bg-white'}`}>                  {ratio.label}                </button>;
        })}            <button type="button" onClick={() => updateOverride(id, {
          logo: undefined
        })} className="ml-auto rounded-lg px-1 py-1 text-rose-600 underline">              Remove logo            </button>
</> : <span className="text-[10.5px] text-slate-700">Tanpa logo = pin teks biasa</span>}      </div>
</div>;
  const renderPlaceRow = (poi: Poi) => {
    const isActive = activePoi === poi.id;
    const override = placeOverrides[poi.id] || {};
    const isHidden = override.hidden === true;
    const label = nameOf(poi.id, poi.name);
    const defaultLabel = poi.estTime && poi.estDist ? `~${poi.estTime} · ${poi.estDist}` : '';
    const estimate = isActive && routeInfo ? `~${Math.round(routeInfo.durationMin)} min` : hub.lat === DEFAULT_START_POINT.lat && hub.lon === DEFAULT_START_POINT.lon ? `~${poi.estTime}` : '';
    return <div key={poi.id}>
<div draggable onDragStart={event => {
        event.dataTransfer.setData('text/plain', poi.id);
        event.dataTransfer.effectAllowed = 'move';
        setDragPlaceId(poi.id);
      }} onDragEnd={() => setDragPlaceId(null)} onClick={() => {
        if (isActive) setFreeRoam();else void selectDestination(poi);
      }} title="Click to route; drag to Point A to use as the starting point" className={`flex items-center gap-1.5 rounded-xl px-2 py-2 cursor-pointer text-[12.5px] font-normal border transition-all duration-200 ${isActive ? 'bg-gradient-to-r from-[#ff5500] to-[#ff7700] border-[#ffa044] text-white shadow-[0_4px_22px_rgba(255,85,0,0.45)] font-medium scale-[1.02]' : 'bg-white/55 border-white/70 text-slate-800 hover:bg-white/80 hover:border-white shadow-sm'} ${isHidden ? 'opacity-50' : ''} ${dragPlaceId === poi.id ? 'opacity-40' : ''}`}>
<button type="button" aria-label={isHidden ? `Show ${label}` : `Hide ${label}`} aria-pressed={!isHidden} title={isHidden ? 'Show on the map' : 'Hide from the map'} onClick={event => {
          event.stopPropagation();
          updateOverride(poi.id, {
            hidden: !isHidden
          });
        }} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] transition ${isHidden ? 'bg-slate-900/10 text-slate-600' : isActive ? 'bg-white/25 text-white hover:bg-white/40' : 'bg-white/80 text-slate-700 hover:bg-white'}`}>            {isHidden ? <EyeIcon off /> : <EyeIcon />}          </button>
<span className="truncate font-normal flex-1">            {override.logo ? '🖼️ ' : ''}            {label}          </span>
<span className={`shrink-0 text-[11px] ${isActive ? 'text-white/90 font-medium' : 'text-slate-600'}`}>            {estimate}          </span>
<button type="button" aria-label={`Edit ${label}`} title="Edit name / subtitle / location / logo" onClick={event => {
          event.stopPropagation();
          openPlaceEditor(poi.id, label, defaultLabel, poi.lat, poi.lon);
        }} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] transition ${isActive ? 'bg-white/25 text-white hover:bg-white/40' : 'bg-white/80 text-slate-700 hover:bg-white'}`}>            ✎          </button>
<button type="button" aria-label={`Delete ${label}`} title="Delete this place" onClick={event => {
          event.stopPropagation();
          deletePlace(poi.id);
        }} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] transition ${isActive ? 'bg-white/25 text-white hover:bg-rose-600' : 'bg-rose-100 text-rose-600 hover:bg-rose-600 hover:text-white'}`}>
<TrashIcon />
</button>
</div>        {editingPlaceId === poi.id && renderPlaceEditor(poi.id, poi.name, defaultLabel, {
        lat: poi.lat,
        lon: poi.lon
      })}      </div>;
  };
  const pinSub = (loc: {
    id: string;
    sub?: string;
  } & Partial<Poi>): string => {
    const custom = placeOverrides[loc.id]?.label?.trim();
    if (custom) return custom;
    if (loc.id === 'hub') return 'Starting Point (0 km)';
    if (activePoi === loc.id && routeInfo) return `~${Math.round(routeInfo.durationMin)} min · ${routeInfo.distanceKm.toFixed(1)} km`;
    if ((loc as Poi).estTime && (loc as Poi).estDist) return `~${(loc as Poi).estTime} · ${(loc as Poi).estDist}`;
    return '';
  };
  return <div className={`cesium-showcase ${darkGlass ? 'theme-dark' : ''} ${mapPickMode ? 'pick-cursor' : ''}`}>
<style dangerouslySetInnerHTML={{
      __html: CSS
    }} />
<div ref={containerRef} className="map" />      {/* Active Free-Roam Map Pick Banner */}      {mapPickMode && <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-orange-400/70 bg-slate-950/90 px-5 py-2.5 text-xs font-medium text-white shadow-2xl backdrop-blur-2xl">
<span className="h-2.5 w-2.5 rounded-full bg-orange-500 animate-ping" />
<span>            Free roam mode: <strong>Click anywhere on the map</strong> to select{' '}            {mapPickMode === 'hub' ? 'Starting Point (0 km)' : mapPickMode === 'dest' ? 'a new place' : `new location ${pois.find(p => p.id === placePickId)?.name ?? 'places'}`}          </span>
<button type="button" onClick={() => setMapPickMode(null)} className="rounded-full bg-white/15 hover:bg-white/25 px-2.5 py-0.5 text-[11px] font-semibold transition">            Cancel          </button>
</div>}      {/* Pole pins overlay */}      <div className={`pins transition-opacity duration-300 ${showTooltips ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>        {[hub, ...pois].filter(loc => !placeOverrides[loc.id]?.hidden).map(loc => {
        const override = placeOverrides[loc.id] || {};
        const label = nameOf(loc.id, loc.name);
        return <div key={loc.id} ref={el => {
          pinRefs.current[loc.id] = el;
        }} className={`pole ${loc.id === 'hub' ? 'hub' : ''} ${activePoi === loc.id ? 'active' : ''}`} onClick={() => {
          if (loc.id === 'hub') {
            if (activePoi !== null) setFreeRoam();else resetToHub();
          } else {
            if (activePoi === loc.id) setFreeRoam();else selectDestination(loc as Poi);
          }
        }}>                {override.logo ? <div className={`pole-logo ${override.ratio === '4:3' ? 'ratio-4-3' : 'ratio-3-2'}`}>                    {/* eslint-disable-next-line @next/next/no-img-element -- Pin logos are local data URLs. */}
<img src={override.logo} alt={label} />
</div> : <div className="pole-label">
<span>{label}</span>
<span className="pole-sub">{pinSub(loc)}</span>
</div>}                <div className="pole-line" />
<div className="pole-dot" />
</div>;
      })}      </div>      {recordError && <div role="alert" className="absolute bottom-5 right-4 z-40 max-w-sm rounded-xl bg-red-950/95 p-4 text-xs text-white">          {recordError}          <button type="button" className="ml-3 underline" onClick={() => setRecordError(null)}>            Close          </button>
</div>}      {/* Floating Presentation Recording HUD */}      {isRecording && <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-red-500/50 bg-slate-950/85 px-5 py-2 shadow-2xl backdrop-blur-2xl ring-2 ring-red-500/30 text-white">
<div className="flex items-center gap-2">
<span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
<span className="text-[11px] font-bold tracking-widest uppercase text-red-400">              REC            </span>
<span className="font-mono text-xs font-semibold text-white/90">              {formatTime(recordingSeconds)} / {formatTime(RECORDING_SECONDS)}            </span>
</div>
<div className="h-3.5 w-px bg-white/20" />
<span className="text-[11px] text-white/70 hidden sm:inline">            Clean Presentation Mode          </span>
<button onClick={stopRecording} className="flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 px-3 py-1 text-xs font-bold text-white shadow-lg transition active:scale-95">
<span>⏹️</span>
<span>Stop and save MP4</span>
</button>
</div>}      {/* Record Setup Modal */}      {showRecordModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
<div className="w-full max-w-sm rounded-2xl border border-white/80 bg-white/95 p-5 shadow-2xl backdrop-blur-2xl text-slate-800">
<div className="flex items-center gap-2 mb-2 font-bold text-base text-slate-900">
<span className="flex h-3 w-3 rounded-full bg-red-600 animate-pulse" />
<span>Record cinematic video (MP4)</span>
</div>
<p className="text-xs text-slate-600 leading-relaxed mb-4">              MP4 recording stops and saves automatically after 60 seconds. You can stop earlier. Target frame rate is 60 FPS, depending on your device. Routes, pins, and map attribution are included; controls are hidden.            </p>
<div className="space-y-2.5 mb-5 text-xs font-medium text-slate-700">
<label className="flex items-center gap-2 cursor-pointer select-none">
<input type="checkbox" checked={recordWithEarthIntro} onChange={e => setRecordWithEarthIntro(e.target.checked)} className="rounded accent-[#ff5500] w-4 h-4 cursor-pointer" />
<span>Start from space (skipped while auto-rotate is active)</span>
</label>
</div>
<div className="flex gap-2 justify-end">
<button onClick={() => setShowRecordModal(false)} className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 transition">                Cancel              </button>
<button onClick={startRecording} className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-red-500/25 transition active:scale-95">
<span>⏺️</span>
<span>Start recording</span>
</button>
</div>
</div>
</div>}      {/* Collapsible Left Sidebar */}      <div className={`absolute top-5 left-4 bottom-5 z-20 transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-[295px] translate-x-0' : 'w-[295px] -translate-x-[312px]'}`}>
<button onClick={() => {
        setSidebarOpen(!sidebarOpen);
      }} className="absolute -right-7 top-4 z-30 flex h-7 w-7 items-center justify-center rounded-r-2xl border-y border-r border-white/70 bg-white/60 text-xs font-medium text-slate-800 shadow-xl backdrop-blur-2xl transition hover:bg-white/85" title={sidebarOpen ? 'Hide panel' : 'Show panel'}>          {sidebarOpen ? '‹' : '›'}        </button>
<aside className="navigation-panel h-full w-full flex flex-col rounded-2xl border border-white/70 bg-white/40 text-slate-800 shadow-[0_16px_40px_0_rgba(0,0,0,0.18)] backdrop-blur-2xl ring-1 ring-white/60 overflow-hidden">
<div className="flex-1 overflow-y-auto p-4 cesium-glass-scroll">            {settingsOpen ? <section className="settings-panel" aria-label="Surrounding area settings">
<div className="flex items-center justify-between border-b border-slate-500/20 pb-3 text-[11px] font-medium uppercase tracking-wider">
<span>Surrounding settings</span>
<button type="button" aria-label="Back to Surrounding Area" onClick={() => setSettingsOpen(false)} className="rounded-lg px-2 py-1 text-base">                    ×                  </button>
</div>
<div className="mt-2">
<button type="button" onClick={() => setSettingsOpen(false)} className="mb-3 text-xs font-medium text-orange-600">                    ← Back to Surrounding Area                  </button>
<div className="mb-4">
<div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">                      Map skin                    </div>
<div className="grid grid-cols-2 gap-1.5">                      {MAP_SKINS.map(skin => <button key={skin.id} type="button" aria-pressed={mapSkin === skin.id} title={skin.hint} onClick={() => {
                    mapSkinRef.current = skin.id;
                    setMapSkin(skin.id);
                    persistPreferences(hub, autoArrivalRef.current, skin.id);
                  }} className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${mapSkin === skin.id ? 'border-orange-500 bg-orange-600 text-white shadow-sm' : 'border-slate-400/40 bg-white/60 text-slate-700 hover:bg-white'}`}>                          {skin.label}                        </button>)}                    </div>
<p className="mt-1.5 text-[10.5px] opacity-70">                      {MAP_SKINS.find(skin => skin.id === mapSkin)?.hint}                    </p>
</div>                  {[{
                label: 'BSD markers / boundary',
                value: showBsd,
                toggle: () => setShowBsd(!showBsd)
              }, {
                label: 'Railways and stations',
                value: showRailways,
                toggle: () => setShowRailways(!showRailways)
              }, {
                label: 'Toll roads',
                value: showTolls,
                toggle: () => setShowTolls(!showTolls)
              }, {
                label: 'Toll road names',
                value: showTollLabels,
                toggle: () => setShowTollLabels(!showTollLabels)
              }, {
                label: 'District names (local data)',
                value: showDistricts,
                toggle: () => setShowDistricts(!showDistricts)
              }, {
                label: 'Esri labels / information',
                value: showEsriLabels,
                toggle: () => setShowEsriLabels(!showEsriLabels)
              }, {
                label: 'Dark glassmorphism',
                value: darkGlass,
                toggle: () => setDarkGlass(!darkGlass)
              }].map(setting => <button key={setting.label} type="button" role="switch" aria-checked={setting.value} className="layer-switch" onClick={setting.toggle}>
<span>{setting.label}</span>
<span aria-hidden="true" className={`switch-track ${setting.value ? 'on' : ''}`}>
<span />
</span>
</button>)}                  <p className="mt-3 text-[11px] opacity-70">                    {showEsriLabels ? 'Informative: Esri place names and boundaries.' : 'Clean: satellite imagery without Esri labels.'}                  </p>
<div className="mt-3 text-xs">
<div className="mt-3 rounded-lg border border-orange-400/40 bg-white/50 px-2.5 py-2 text-[11px]">
<div className="flex items-center justify-between gap-2">
<span className="font-medium">Toll roads (local data)</span>                        {showTolls && !tollReady && !tollError && <span role="status" className="text-[10px] opacity-75">loading...</span>}                        {tollReady && <span className="text-[10px] opacity-75">                            {tollCount} segments · {tollLabelCount} labels                          </span>}                      </div>                      {tollError ? <p role="alert" className="mt-1 text-[10px] text-red-600">{tollError}</p> : <p className="mt-1 text-[10px] opacity-70">                          {showTolls ? 'Visible on the map. Turn off Toll roads to hide.' : 'Enable Toll roads above to show this layer.'}                        </p>}                    </div>
<div className="mt-3 rounded-lg border border-yellow-400/40 px-2.5 py-2">
<p className="font-medium">Railways and stations (local data)</p>
{!showRailways && <p className="mt-1 text-[10px] opacity-70">Enable Railways and stations to load your local JSON.</p>}
{showRailways && railwayStatus === 'loading' && <p role="status">Loading local railway data...</p>}
{showRailways && railwayStatus === 'missing' && <p role="status">Railway JSON is not available yet. Add it at public/data/railway.geojson.</p>}
{showRailways && railwayStatus === 'ready' && <p role="status">{railwayCount} railway segments and stations loaded.</p>}
{showRailways && railwayStatus === 'error' && <p role="alert" className="text-red-600">{railwayError} Toggle this layer off and on to retry.</p>}
</div></div>
<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="mt-3 block text-[10px] underline opacity-70">                    © OpenStreetMap contributors / ODbL                  </a>                  {/* Save Setting (hub, skin, nama/label/logo, daftar places) */}                  <div className="mt-3 border-t border-slate-500/20 pt-3 text-xs">
<div className="mb-1.5 flex items-center justify-between">
<span className="text-[10px] font-medium uppercase tracking-wider text-slate-800">                        Save Setting                      </span>
<span className="text-[10px] opacity-70">{pois.length} places</span>
</div>
<div className="flex gap-1.5">
<button type="button" onClick={downloadSetup} className="flex-1 rounded-lg border border-slate-400/50 bg-white/85 px-2 py-1.5 text-[11px] font-medium hover:bg-white">                        Export JSON                      </button>
<label className="flex-1 cursor-pointer rounded-lg border border-slate-400/50 bg-white/85 px-2 py-1.5 text-center text-[11px] font-medium hover:bg-white">                        Import JSON                        <input type="file" accept="application/json,.json" className="hidden" onChange={event => void importSetup(event)} />
</label>
</div>
<p className="mt-1.5 text-[10px] leading-snug opacity-70">                      Settings are saved automatically in this browser. Export JSON to transfer them to another browser or restore them after clearing browser data.                    </p>                    {setupMessage && <p role="status" className="mt-1 text-[10px] font-medium text-emerald-700">                        {setupMessage}                      </p>}                  </div>
</div>
</section> : <>
<div className="flex items-center justify-between pb-3 border-b border-slate-900/10 mb-3.5">
<h1 className="text-xs font-medium uppercase tracking-wider text-slate-800">                    Surrounding Area                  </h1>
<button type="button" aria-label="Open layer settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)} className="rounded-lg px-2 py-1 text-base" title="Layer settings">                    ⚙                  </button>
</div>                {/* POIN 1: STARTING POINT (HUB 0 KM) — KLIK LANGSUNG BUKA 1 SEARCH OMNIBOX + FREE ROAM */}                <div className="flex items-center justify-between mt-1 mb-1.5">
<h3 className="text-[10px] uppercase tracking-wider font-medium text-slate-800">                    Starting Point (Point A)                  </h3>
<div className="flex items-center gap-2">                    {activePoi !== null && <span className="text-[10px] text-orange-600 font-medium">Active route</span>}                    <button type="button" onClick={resetToHub} className="text-[10px] text-slate-800 hover:text-orange-600 underline" title="Focus the camera on the starting point">                      Focus                    </button>
</div>
</div>
<div onDragOver={event => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }} onDrop={event => {
              event.preventDefault();
              dropOnHub(dragPlaceId || event.dataTransfer.getData('text/plain'));
              setDragPlaceId(null);
            }} className={`flex items-center justify-between rounded-xl px-3 py-2.5 mb-2 cursor-pointer text-[12.5px] border transition-all duration-200 ${hubEditorOpen || editingPlaceId === 'hub' ? 'bg-orange-600 text-white border-orange-500 shadow-md font-medium' : activePoi !== null ? 'bg-gradient-to-r from-[#ff5500] to-[#ff7700] border-[#ffa044] text-white shadow-[0_4px_22px_rgba(255,85,0,0.45)] font-medium' : 'bg-white/55 border-white/70 text-slate-800 hover:bg-white/80 hover:border-white shadow-sm'} ${dragPlaceId && dragPlaceId !== 'hub' ? 'ring-2 ring-orange-400 ring-offset-1' : ''} ${hubOverride.hidden ? 'opacity-50' : ''}`} onClick={() => {
              setHubEditorOpen(prev => !prev);
              setDestSearchOpen(false);
              setEditingPlaceId(null);
            }} title="Click to change the starting point; drop a place here to use it as the starting point">
<button type="button" aria-label={hubOverride.hidden ? 'Show starting point' : 'Hide starting point'} aria-pressed={!hubOverride.hidden} title={hubOverride.hidden ? 'Show on the map' : 'Hide from the map'} onClick={event => {
                event.stopPropagation();
                updateOverride('hub', {
                  hidden: !hubOverride.hidden
                });
              }} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] transition ${hubEditorOpen || activePoi !== null ? 'bg-white/20 text-white hover:bg-white/35' : 'bg-white/80 text-slate-700 hover:bg-white'}`}>                    {hubOverride.hidden ? <EyeIcon off /> : <EyeIcon />}                  </button>
<div className="flex items-center gap-1.5 truncate flex-1">
<span>{hubOverride.logo ? '🖼️' : '📍'}</span>
<span className="truncate">{hubLabel}</span>
</div>
<div className="flex items-center gap-1 shrink-0">
<span className={`text-[10px] px-1.5 py-0.5 rounded ${hubEditorOpen || activePoi !== null ? 'bg-white/20 text-white' : 'bg-slate-900/10 text-slate-700'}`}>                      0 km                    </span>
<button type="button" aria-label="Edit starting point" title="Edit name / subtitle / location / logo" onClick={event => {
                  event.stopPropagation();
                  openPlaceEditor('hub', hubLabel, 'Starting Point (0 km)', hub.lat, hub.lon);
                }} className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] transition ${hubEditorOpen || activePoi !== null ? 'bg-white/20 text-white hover:bg-white/35' : 'bg-white/80 text-slate-700 hover:bg-white'}`}>                      ✎                    </button>                    {activePoi !== null && <button type="button" title="Enter free roam (clear route)" aria-label="Free roam / cancel route" onClick={e => {
                  e.stopPropagation();
                  setFreeRoam();
                }} className="flex h-5 w-5 items-center justify-center rounded-md bg-red-500/20 hover:bg-red-500 text-red-600 hover:text-white transition text-xs font-semibold">                        ✕                      </button>}                  </div>
</div>                {editingPlaceId === 'hub' && renderPlaceEditor('hub', hub.name, 'Starting Point (0 km)', {
              lat: hub.lat,
              lon: hub.lon
            })}                {/* Drawer 1-Input Omnibox untuk Hub (0 km) */}                {hubEditorOpen && <div className="mb-3 space-y-2 rounded-xl border border-white/60 bg-white/55 p-2.5 text-xs text-slate-800 shadow-inner">
<form onSubmit={handleHubOmniboxSubmit} className="flex gap-1.5">
<input aria-label="Search for a starting point or paste coordinates" value={hubQuery} onChange={e => setHubQuery(e.target.value)} placeholder="Search places / paste lat, lon..." className="min-w-0 flex-1 rounded-lg border border-slate-400/40 bg-white/80 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500" />
<button type="submit" disabled={hubSearchBusy || !hubQuery.trim()} className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 transition">                        {hubSearchBusy ? '...' : 'Set'}                      </button>
</form>
<div className="flex gap-1.5">
<button type="button" onClick={() => {
                  setMapPickMode(mapPickMode === 'hub' ? null : 'hub');
                }} className={`flex-1 flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${mapPickMode === 'hub' ? 'bg-orange-600 border-orange-500 text-white' : 'bg-white/70 border-slate-300/70 text-slate-700 hover:bg-white'}`}>
<span>🎯</span>
<span>                          {mapPickMode === 'hub' ? 'Click on the map now...' : 'Pick on the map (free roam)'}                        </span>
</button>
</div>                    {hubResults.length > 0 && <div className="max-h-36 overflow-y-auto space-y-1 pt-1 cesium-glass-scroll">                        {hubResults.map((pt, idx) => <button key={`${pt.lon}-${pt.lat}-${idx}`} type="button" onClick={() => applyNewHubPoint(pt)} className="block w-full rounded-lg bg-white/75 hover:bg-orange-500 hover:text-white px-2.5 py-1.5 text-left text-[11px] text-slate-800 transition truncate">                            📍 {pt.name}                          </button>)}                      </div>}                    {hubMessage && <p role="status" className="text-[10.5px] text-slate-600 leading-snug">                        {hubMessage}                      </p>}                  </div>}                <label className="mb-2.5 flex cursor-pointer items-start gap-2 text-[11px] text-slate-800">
<input type="checkbox" checked={autoRotateOnArrival} onChange={event => {
                const checked = event.target.checked;
                autoArrivalRef.current = checked;
                setAutoRotateOnArrival(checked);
                persistPreferences(hub, checked);
              }} className="mt-0.5 accent-orange-600" />                  Auto-rotate after the intro finishes                </label>                {/* POIN 2: PENCARIAN & PILIH PETA UNTUK TITIK B (DESTINASI CUSTOM) */}                <div className="flex items-center justify-between mt-3 mb-1.5">
<h3 className="text-[10px] uppercase tracking-wider font-medium text-slate-800">                    Destination (Point B)                  </h3>
<button type="button" aria-label={destSearchOpen ? 'Close place search' : 'Add place'} aria-expanded={destSearchOpen} title={destSearchOpen ? 'Close place search' : 'Add place'} onClick={() => {
                setDestSearchOpen(prev => !prev);
                setHubEditorOpen(false);
              }} className={`flex h-5 w-5 items-center justify-center rounded-md text-sm font-semibold transition ${destSearchOpen ? 'bg-orange-600 text-white' : 'bg-orange-100 text-orange-600 hover:bg-orange-600 hover:text-white'}`}>                    {destSearchOpen ? '×' : '+'}                  </button>
</div>                {destSearchOpen && <div className="mb-3 space-y-2 rounded-xl border border-orange-400/50 bg-white/60 p-2.5 text-xs text-slate-800 shadow-inner">
<form onSubmit={handleDestOmniboxSubmit} className="flex gap-1.5">
<input aria-label="Search for a place or paste coordinates" value={destQuery} onChange={e => setDestQuery(e.target.value)} placeholder="Search places / paste lat, lon..." className="min-w-0 flex-1 rounded-lg border border-slate-400/40 bg-white/85 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500" />
<button type="submit" disabled={destSearchBusy || !destQuery.trim()} className="rounded-lg bg-orange-600 hover:bg-orange-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 transition">                        {destSearchBusy ? '...' : 'Add'}                      </button>
</form>
<button type="button" onClick={() => {
                setMapPickMode(mapPickMode === 'dest' ? null : 'dest');
              }} className={`w-full flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${mapPickMode === 'dest' ? 'bg-orange-600 border-orange-500 text-white' : 'bg-white/75 border-slate-300/70 text-slate-700 hover:bg-white'}`}>
<span>🎯</span>
<span>                        {mapPickMode === 'dest' ? 'Click a place on the map...' : 'Pick a place on the map'}                      </span>
</button>                    {destResults.length > 0 && <div className="max-h-36 overflow-y-auto space-y-1 pt-1 cesium-glass-scroll">                        {destResults.map((pt, idx) => <button key={`${pt.lon}-${pt.lat}-${idx}`} type="button" onClick={() => addPlace({
                  name: pt.name,
                  lat: pt.lat,
                  lon: pt.lon
                })} className="block w-full rounded-lg bg-white/80 hover:bg-orange-500 hover:text-white px-2.5 py-1.5 text-left text-[11px] text-slate-800 transition truncate">                            🏁 {pt.name}                          </button>)}                      </div>}                    {destMessage && <p className="text-[10.5px] text-slate-600 leading-snug">{destMessage}</p>}                  </div>}                {/* Pinned locations */}                <h3 className="mt-2.5 mb-1.5 text-[10px] uppercase tracking-wider font-medium text-slate-800">                  Pinned Location                </h3>
<div className="space-y-1.5">                  {pois.map(renderPlaceRow)}                </div>
</>}          </div>          {/* Bottom Toolbar: 5 Tool Icons */}          <div className="relative border-t border-slate-900/10 bg-white/50 p-2 backdrop-blur-md">            {/* POIN 5: Auto-Rotate Speed & Smooth Ease-In-Out Zoom Controls Popover */}            {showRotateSlider && <div className="absolute bottom-[60px] left-2 right-2 z-30 rounded-2xl border border-white/80 bg-white/95 p-3 shadow-xl backdrop-blur-2xl text-slate-800">
<div className="flex items-center justify-between text-[11px] font-medium mb-1">
<span>Rotation speed and orbit zoom</span>
<div className="flex items-center gap-1.5">
<span className="text-[#ff5500] font-mono">{rotateSpeed.toFixed(1)}x</span>
<button onClick={() => setShowRotateSlider(false)} className="text-slate-400 hover:text-slate-700 text-xs px-1">                      ✕                    </button>
</div>
</div>
<input type="range" min="0.2" max="3.0" step="0.1" value={rotateSpeed} onChange={e => setRotateSpeed(parseFloat(e.target.value))} className="w-full accent-[#ff5500] h-1.5 bg-slate-200 rounded-lg cursor-pointer" />
<div className="flex justify-between text-[9px] text-slate-400 mt-1 font-semibold">
<span>Slow (0.2x)</span>
<span>Normal (1.0x)</span>
<span>Fast (3.0x)</span>
</div>                {/* Tombol Smooth Ease-In-Out Zoom Saat Orbit */}                <div className="mt-2.5 pt-2 border-t border-slate-200/80 flex items-center justify-between gap-1.5">
<button type="button" onClick={() => {
                const cur = orbitAnimTargetRangeRef.current ?? orbitRangeRef.current ?? 2000;
                triggerSmoothOrbitZoom(cur * 0.65, 950);
              }} className="flex-1 rounded-lg bg-slate-100 hover:bg-orange-500 hover:text-white py-1 text-[10.5px] font-medium text-slate-700 transition" title="Smooth zoom in">                    🔍+ Zoom In                  </button>
<button type="button" onClick={() => {
                const cur = orbitAnimTargetRangeRef.current ?? orbitRangeRef.current ?? 2000;
                triggerSmoothOrbitZoom(cur * 1.55, 1100);
              }} className="flex-1 rounded-lg bg-slate-100 hover:bg-orange-500 hover:text-white py-1 text-[10.5px] font-medium text-slate-700 transition" title="Smooth zoom out">                    🔍− Zoom Out                  </button>
<button type="button" onClick={() => triggerSmoothOrbitZoom(9500, 1600)} className="rounded-lg bg-slate-100 hover:bg-orange-500 hover:text-white px-2 py-1 text-[10.5px] font-medium text-slate-700 transition" title="Zoom out to view the surrounding area">                    Wide                  </button>
</div>
</div>}            {/* 5 Icons Grid */}            <div className="grid grid-cols-5 gap-1.5">              {/* 1. Mata Coret: Hide/Show Tooltip */}              <button onClick={() => setShowTooltips(!showTooltips)} className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all active:scale-95 ${!showTooltips ? 'bg-rose-50 border-rose-300 text-rose-600 shadow-sm' : 'bg-white/60 border-white/80 text-slate-700 hover:bg-white hover:text-black shadow-sm'}`} title={showTooltips ? 'Hide pins and tooltips' : 'Show pins and tooltips'}>                {!showTooltips ? <svg className="w-4 h-4 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
<path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
<line x1="2" y1="2" x2="22" y2="22" />
</svg> : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
<circle cx="12" cy="12" r="3" />
</svg>}              </button>              {/* 2. Auto Rotate (with smooth Ease-In-Out Zoom Out pull-back) */}              <button onClick={() => {
              const next = !autoRotate;
              if (next && viewerRef.current?.__startCinematicOrbit) {
                viewerRef.current.__startCinematicOrbit();
              } else {
                autoRotateRef.current = false;
                setAutoRotate(false);
                orbitRangeRef.current = null;
                orbitAnimTargetRangeRef.current = null;
                freeRoamSphereRef.current = null;
              }
            }} className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all active:scale-95 ${autoRotate ? 'bg-[#ff5500]/15 border-[#ff5500]/50 text-[#ff5500] shadow-sm' : 'bg-white/60 border-white/80 text-slate-700 hover:bg-white hover:text-black shadow-sm'}`} title="Auto-rotate camera (smooth zoom-out and 360-degree orbit)">
<svg className={`w-4 h-4 ${autoRotate ? 'animate-spin' : ''}`} style={autoRotate ? {
                animationDuration: `${Math.max(1, 4 / rotateSpeed)}s`
              } : {}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
</svg>
</button>              {/* 3. Bird Eye (Icon Burung) */}              <button onClick={flyToMacroOverview} className="flex flex-col items-center justify-center p-2 rounded-xl border border-white/80 bg-white/60 text-slate-700 hover:bg-white hover:text-black shadow-sm transition-all active:scale-95" title="Bird’s-eye overview">
<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
<path d="M16 7h.01" />
<path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 18Z" />
<path d="m20 7 2 .5-2 .5" />
<path d="M10 18v3" />
<path d="M14 17.75V21" />
<path d="M7 18a6 6 0 0 0 3.84-10.61" />
</svg>
</button>              {/* 4. Zoom Earth (Icon Bumi) */}              <button onClick={replayIntro} className="flex flex-col items-center justify-center p-2 rounded-xl border border-white/80 bg-white/60 text-slate-700 hover:bg-white hover:text-black shadow-sm transition-all active:scale-95" title="Zoom to Earth from space">
<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
<circle cx="12" cy="12" r="10" />
<line x1="2" y1="12" x2="22" y2="12" />
<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
</svg>
</button>              {/* 5. Record MP4 */}              <button onClick={() => {
              if (isRecording) stopRecording();else setShowRecordModal(true);
            }} className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all active:scale-95 ${isRecording ? 'bg-red-50 border-red-400 text-red-600 shadow-sm animate-pulse' : 'bg-white/60 border-white/80 text-slate-700 hover:bg-white hover:text-black shadow-sm'}`} title="Record MP4 video (presentation mode)">                {isRecording ? <span className="relative flex h-3.5 w-3.5 items-center justify-center">
<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
<span className="relative inline-flex rounded-sm h-3 w-3 bg-red-600"></span>
</span> : <svg className="w-4 h-4 text-red-500 fill-red-500" viewBox="0 0 24 24">
<circle cx="12" cy="12" r="7" />
</svg>}              </button>
</div>
</div>
</aside>
</div>      {/* Loading overlay */}      {status === 'loading' && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md">
<div className="rounded-2xl border border-white/20 bg-slate-950/70 p-6 text-center shadow-[0_16px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl ring-1 ring-white/10">
<div className="text-sm font-bold text-white">Loading Cesium 3D Globe...</div>
<div className="mt-1.5 text-xs text-white/60">              Preparing the globe and map controls            </div>
</div>
</div>}      {/* Error overlay */}      {status === 'error' && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
<div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-slate-950/85 p-6 shadow-2xl backdrop-blur-2xl ring-1 ring-white/10">
<h2 className="mb-2 text-sm font-bold text-red-300">Failed to load the Cesium view</h2>
<p className="mb-4 text-xs leading-relaxed text-white/60">{error}</p>
<div className="flex justify-end gap-2">
<Link href="/" className="rounded-xl px-4 py-2 text-xs font-semibold text-white/70 hover:text-white border border-white/10 hover:bg-white/10 transition">                Back              </Link>
</div>
</div>
</div>}    </div>;
}
