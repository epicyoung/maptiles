# Master Graphify — Arsitektur Sistem Spindonesia Tiles (Maptiles)

Dokumen ini memetakan seluruh topologi, arsitektur *tri-engine*, alur data geospasial, serta hierarki komponen dari proyek **Maptiles (Spindonesia Tiles)** secara visual dan struktural (**Graphify**).

---

## 1. Topologi Sistem Tingkat Tinggi (Master Architecture Graph)

Aplikasi ini berbasis **Next.js 16 (App Router)** dan **React 19**, mengadopsi arsitektur **Tri-Engine Geospatial Platform** dengan tiga halaman utama yang masing-masing menjalankan engine visualisasi WebGL berbeda di atas lapisan data geospasial (*Spatial Data Layer*) bersama.

```mermaid
flowchart TD
    subgraph ClientWorkspace["Workspace & Runtime Shell"]
        RootPkg["package.json (Workspace Root)"] --> AppRouter["Next.js 16 App Router (maptile/app)"]
        AppRouter --> RouteHome["/ (Home: Master View)"]
        AppRouter --> RouteCesium["/cesium (Cesium 3D Globe)"]
        AppRouter --> RouteEsri["/esri-3d (ArcGIS 3D SceneView)"]
    end

    subgraph ComponentControllers["Core Component Controllers"]
        RouteHome --> UniversalViewer["UniversalMapViewer.tsx (Master Controller ~2,500 lines)"]
        RouteCesium --> CesiumViewer["CesiumShowcase.tsx (Globe Showcase ~1,200 lines)"]
        RouteEsri --> EsriViewer["Esri3DView.tsx (Full ArcGIS SDK ~820 lines)"]
        RouteHome -.-> Standalone3D["BsdMapShowcase.tsx (Pure Three.js Prototype)"]
    end

    subgraph TriEngines["Tri-Engine Geospatial WebGL Core"]
        UniversalViewer --> EngineHybrid["Engine 1: Hybrid MapLibre GL v6.15 + Three.js v0.186"]
        CesiumViewer --> EngineCesium["Engine 2: CesiumJS v1.115 (Photogrammetric 3D Globe)"]
        EsriViewer --> EngineEsri["Engine 3: ArcGIS Maps SDK for JS v4.30 (SceneView 3D)"]
    end

    subgraph SpatialDataLayer["Shared Spatial Data Layer (lib/ & public/data/)"]
        BsdLineTS["bsdline.ts (KMZ Parsed Coordinates)"]
        JakartaLineTS["jakartaline.ts (KML Regional Border)"]
        MapLayersTS["mapLayersData.ts (Tol, KRL, Stasiun, Kecamatan)"]
        BsdGadmTS["bsd_gadm.ts (Administrative Polygons)"]
        KmzKmlFiles["public/data/ (bsdline.kmz, jakarta.kml, bsdline.json)"]
    end

    subgraph ExternalServices["External Geospatial & Tile Providers"]
        EsriRaster["Esri ArcGIS World Imagery CDN"]
        CartoRaster["Carto Dark Matter Canvas CDN"]
        OsmRaster["OpenStreetMap Global CDN"]
        Google3DTiles["Google Maps Photorealistic 3D Tiles API"]
        EsriElevation["ArcGIS WorldElevation3D Service"]
        OsrmRouter["Project OSRM Driving Router API"]
    end

    UniversalViewer --> BsdLineTS & MapLayersTS & BsdGadmTS
    CesiumViewer --> BsdLineTS & JakartaLineTS
    EsriViewer --> BsdLineTS

    EngineHybrid --> EsriRaster & CartoRaster & OsmRaster & Google3DTiles & OsrmRouter
    EngineCesium --> EsriRaster & OsrmRouter
    EngineEsri --> EsriRaster & EsriElevation & OsrmRouter
```

---

## 2. Peta Perbandingan Tri-Engine (Tri-Engine Ecosystem Graph)

Diagram ini mengilustrasikan perbedaan arsitektur teknis, kelebihan utama, dan spesialisasi visual dari masing-masing engine:

```mermaid
flowchart LR
    subgraph Universal_Engine["1. UniversalMapViewer (Hybrid MapLibre + Three.js)"]
        UM_Type["Tipe: 2D Raster + 2.5D Tilt + 3D Mesh"]
        UM_Speed["Performa: ⚡ Instan (<100ms load time)"]
        UM_Feat["Fitur Kunci: Dual-Engine Switcher, Neon Highways, Area Drawing, Telemetry HUD"]
        UM_Use["Tujuan: Visualisasi cepat, eksplorasi jalan, dan drawing poligon dinamis"]
    end

    subgraph Cesium_Engine["2. CesiumShowcase (CesiumJS 1.115)"]
        CS_Type["Tipe: Curvature 3D Globe + Ellipsoid WGS84"]
        CS_Speed["Performa: 🚀 Smooth 60 FPS Atmosphere Flight"]
        CS_Feat["Fitur Kunci: 3-Second Trim-Path, Pole Pin Badges, Atmospheric Cloud-Break, Glassmorphism Dock"]
        CS_Use["Tujuan: Sinematik Showcase BSD City, zoom luar angkasa menembus kabut"]
    end

    subgraph Esri_Engine["3. Esri3DView (ArcGIS Maps SDK 4.30)"]
        ES_Type["Tipe: True Terrain Elevation (ArcGIS SceneView)"]
        ES_Speed["Performa: 🏔️ Akurat secara Topografis"]
        ES_Feat["Fitur Kunci: WorldElevation3D, Realtime Weather System (Hujan/Mendung/Kabut), GIS Precision"]
        ES_Use["Tujuan: Analisis elevasi kontur bumi asli dan simulasi cuaca meteorologi"]
    end
```

---

## 3. Alur Data Geospasial & Pipeline Lapisan (Spatial Pipeline Graph)

Bagian ini memetakan bagaimana data mentah dari format **KMZ / KML / GeoJSON** diproses menjadi objek grafis di atas canvas WebGL:

```mermaid
flowchart TD
    subgraph DataSources["1. Sumber Berkas Mentah (public/data/)"]
        RawKMZ["bsdline.kmz (Google Earth Polygon BSD)"]
        RawKML["jakarta.kml (Batas Administratif DKI Jakarta)"]
        RawJSON["bsdline.json (GeoJSON Boundary)"]
    end

    subgraph ParserLayer["2. Parsing & Normalisasi (lib/)"]
        Parser1["bsdline.ts: Ekstraksi Koordinat ArrayHeights [lon, lat, height]"]
        Parser2["jakartaline.ts: Array Batas Wilayah Jakarta"]
        Parser3["mapLayersData.ts: Fitur Vektor Tol (Serbaraja, JORR) & KRL"]
    end

    subgraph RenderingPipeline["3. Injeksi Lapisan WebGL (Engine Views)"]
        subgraph ML_Pipe["MapLibre Layers"]
            ML_Line["Glow Border Neon (#ffaa00)"]
            ML_Core["Inner Core Line (#fff4e0)"]
            ML_Fill["Semi-Transparent Area Fill"]
            ML_Draw["Interactive Draw Canvas (Polygon / Ruler)"]
        end
        subgraph Cesium_Pipe["Cesium Primitives"]
            CS_PolyGlow["PolylineGlowMaterialProperty"]
            CS_TrimRoute["CallbackProperty Dynamic Trim-Path"]
            CS_Clouds["BillboardCollection + NearFarScalar Mist"]
            CS_Pins["SceneTransforms.wgs84ToWindowCoordinates (DOM Pins)"]
        end
        subgraph Esri_Pipe["ArcGIS GraphicsLayer"]
            ES_Graphic["Graphic Polyline (Route & Border)"]
            ES_Weather["sceneView.environment.weather (Sunny/Rain/Fog)"]
        end
    end

    RawKMZ --> Parser1
    RawKML --> Parser2
    RawJSON --> Parser1
    Parser1 --> ML_Line & CS_PolyGlow & ES_Graphic
    Parser2 --> CS_PolyGlow
    Parser3 --> ML_Line
```

---

## 4. Alur Interaksi State & Animasi (Sequence Graph)

Diagram ini menggambarkan alur saat pengguna berinteraksi dengan fitur navigasi, pemilihan rute, dan animasi *motion-graphics*:

```mermaid
sequenceDiagram
    autonumber
    actor User as Pengguna
    participant UI as Control HUD / Sidebar
    participant Router as OSRM / Haversine Engine
    participant Engine as WebGL Engine (MapLibre / Cesium / Esri)
    participant Animator as 60 FPS Render Loop

    User->>UI: Klik Destinasi POI / Input Rute A-B
    UI->>Router: Hitung koordinat rute OSRM
    
    alt OSRM Berhasil
        Router-->>UI: Koordinat rute jalan raya asli (LineString)
    else OSRM Timeout / Gagal
        Router-->>UI: Fallback Quadratic Bezier Curve (Lengkungan halus)
    end

    UI->>Engine: Fly-To Camera (BoundingSphere / Easing QUADRATIC_IN_OUT)
    
    par Animasi Kamera & Lintasan
        Engine->>Engine: Interpolasi posisi & tilt kamera secara dinamis
    and Animasi Trim-Path & Tracer
        loop Setiap Frame selama 3 Detik
            Animator->>Engine: Tambahkan titik lintasan secara bertahap (eased)
            Animator->>Engine: Geser marker ujung rute (Tracer head beacon)
        end
    and Efek Atmosferik (di Cesium)
        Engine->>Engine: Awan memudar otomatis (<900m) lewat NearFarScalar
    end

    Engine-->>User: Tampilan framing sempurna (Point A & B terlihat jelas)
```

---

## 5. Matriks Fitur Lengkap Berdasarkan Rute

| Indikator | `/` (UniversalMapViewer) | `/cesium` (CesiumShowcase) | `/esri-3d` (Esri3DView) |
| :--- | :--- | :--- | :--- |
| **URL / Halaman** | [`maptile/app/page.tsx`](file:///C:/Users/epicyoung/Desktop/VIBECODE/Maptiles/maptile/app/page.tsx) | [`maptile/app/cesium/page.tsx`](file:///C:/Users/epicyoung/Desktop/VIBECODE/Maptiles/maptile/app/cesium/page.tsx) | [`maptile/app/esri-3d/page.tsx`](file:///C:/Users/epicyoung/Desktop/VIBECODE/Maptiles/maptile/app/esri-3d/page.tsx) |
| **Komponen Utama**| [`UniversalMapViewer.tsx`](file:///C:/Users/epicyoung/Desktop/VIBECODE/Maptiles/maptile/components/UniversalMapViewer.tsx) | [`CesiumShowcase.tsx`](file:///C:/Users/epicyoung/Desktop/VIBECODE/Maptiles/maptile/components/CesiumShowcase.tsx) | [`Esri3DView.tsx`](file:///C:/Users/epicyoung/Desktop/VIBECODE/Maptiles/maptile/components/Esri3DView.tsx) |
| **Teknologi Render**| MapLibre GL 6.15 + Three.js 0.186 | CesiumJS 1.115 (CDN) | ArcGIS JavaScript API 4.30 (CDN) |
| **Bentuk Dunia** | Proyeksi Flat / 2.5D Pitch + 3D Tiles | 3D Curved Globe (WGS84 Ellipsoid) | 3D Curved Globe + Elevation Layer |
| **Sumber Citra** | Esri, Carto Dark, OSM, Google 3D | Esri World Imagery | Esri World Imagery |
| **Sistem Awan** | 3D Glowing Tubes Boundary | Atmospheric Cloud-Break (Near/Far Mist) | ArcGIS Native Cloudy/Rain/Fog Weather |
| **Animasi Rute** | Continuous 60fps Tracer Beacon | 3-Second Trim-Path Draw + Ping Head | Progressive Polyline Draw |
| **Drawing Tool** | Polygon Area Measure & Draw | — | — |
| **Dukungan Data** | BSD Boundary, Tol, KRL, Stasiun | BSD KMZ Border, POI Pins 3D | BSD Preset POI, World Elevation |

---

## 6. Hierarki Direktori & Modul Berkas

```
Maptiles/
├── package.json                         # Workspace monorepo root
├── GRAPHIFY.md                          # Master Graphify & Dokumentasi Arsitektur
├── maptile/                             # Next.js 16 Web Application
│   ├── GRAPHIFY.md                      # Salinan dokumentasi di subfolder maptile
│   ├── next.config.ts                   # Turbopack, experiments, origins
│   ├── app/
│   │   ├── layout.tsx                   # HTML & global metadata shell
│   │   ├── globals.css                  # Tailwind CSS v4 styling
│   │   ├── page.tsx                     # Rute utama (UniversalMapViewer)
│   │   ├── cesium/
│   │   │   └── page.tsx                 # Rute showcase Cesium Globe
│   │   └── esri-3d/
│   │       └── page.tsx                 # Rute showcase ArcGIS SceneView
│   ├── components/
│   │   ├── UniversalMapViewer.tsx       # Master Controller (MapLibre + Three.js)
│   │   ├── CesiumShowcase.tsx           # Cesium 3D Globe Showcase
│   │   ├── Esri3DView.tsx               # ArcGIS Maps SDK SceneView
│   │   └── BsdMapShowcase.tsx           # Standalone pure Three.js Google 3D
│   ├── lib/
│   │   ├── bsdline.ts                   # Koordinat poligon BSDEPICYOUNG
│   │   ├── bsd_gadm.ts                  # Data spasial GADM BSD
│   │   ├── jakartaline.ts               # Koordinat batas DKI Jakarta
│   │   └── mapLayersData.ts             # Jaringan jalan tol, KRL, stasiun, kecamatan
│   └── public/
│       └── data/                        # Asset mentah KMZ, KML, dan GeoJSON
```

---

## 7. Saran Pengembangan Arsitektur Lanjutan

> [!TIP]
> Sekarang proyek Maptiles telah memiliki **3 engine visualisasi kelas dunia** yang berjalan harmonis dalam satu aplikasi Next.js 16.

Peluang optimasi selanjutnya yang dapat diterapkan:
1. **Shared Navigation Dock**: Mengintegrasikan navigasi universal agar pengguna dapat berpindah antar ketiga engine (`/`, `/cesium`, `/esri-3d`) secara instan tanpa me-reload aset dasar.
2. **Dynamic KMZ Uploader**: Menambahkan fitur *drag-and-drop* file `.kmz` / `.kml` langsung dari browser ke peta untuk divisualisasikan otomatis di ketiga engine.
3. **Environment Variable**: Memusatkan token API (Google Cloud API Key, Cesium Ion Token, ArcGIS API Key) ke `.env.local` agar terisolasi dengan aman dari *client bundle*.
