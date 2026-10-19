// Data Geospasial untuk Jalan Tol, Rel Kereta, dan Wilayah Kecamatan di area BSD & Jabodetabek

export interface GeoPolylineFeature {
  id: string;
  name: string;
  type: 'toll' | 'railway' | 'district';
  color: string;
  glowColor: string;
  width: number;
  labelCoord: [number, number]; // [lon, lat]
  coords: [number, number][]; // [[lon, lat], ...]
}

export interface GeoStation {
  id: string;
  name: string;
  line: string;
  coord: [number, number];
}

export interface GeoDistrict {
  id: string;
  name: string;
  regency: string;
  coord: [number, number];
}

// 1. JALAN TOL UTAMA (BSD, Tangerang, Jakarta)
export const TOLL_ROADS: GeoPolylineFeature[] = [
  {
    id: 'tol-serbaraja',
    name: 'Tol Serpong - Balaraja (Serbaraja)',
    type: 'toll',
    color: '#ff9900',
    glowColor: '#ff5500',
    width: 5,
    labelCoord: [106.6380, -6.3050],
    coords: [
      [106.6710, -6.3075], // IC Rawa Buntu / Cilenggang
      [106.6620, -6.3060], // Dekat The Breeze
      [106.6520, -6.3045], // Dekat GOP
      [106.6415, -6.3040], // Simpang Susun AEON / Cisauk
      [106.6340, -6.3050], // ICE BSD Gate
      [106.6210, -6.3068], // BSD Timur / Pagedangan
      [106.6080, -6.3110], // Menuju Legok
      [106.5920, -6.3190], // Exit Legok
    ],
  },
  {
    id: 'tol-jkt-serpong',
    name: 'Tol Jakarta - Serpong',
    type: 'toll',
    color: '#00d4ff',
    glowColor: '#0099ff',
    width: 4.5,
    labelCoord: [106.7120, -6.2860],
    coords: [
      [106.7640, -6.2570], // Ulujami / Simpang Veteran
      [106.7450, -6.2690], // Bintaro Viaduct
      [106.7210, -6.2820], // Pondok Aren
      [106.6980, -6.2910], // Ciater / BSD Timur
      [106.6780, -6.2990], // Rawa Buntu
      [106.6710, -6.3075], // Cilenggang
    ],
  },
  {
    id: 'tol-kunciran-serpong',
    name: 'Tol Kunciran - Serpong (JORR 2)',
    type: 'toll',
    color: '#10b981',
    glowColor: '#059669',
    width: 4.5,
    labelCoord: [106.6770, -6.2580],
    coords: [
      [106.6815, -6.2160], // Kunciran Interchange (Tol Jkt-Tgr)
      [106.6740, -6.2380], // Pinang
      [106.6730, -6.2620], // Parigi / Pondok Aren Barat
      [106.6765, -6.2850], // Jelupang / Serpong Utara
      [106.6780, -6.2990], // Junction Serpong (Sambungan Tol Jkt-Serpong)
    ],
  },
  {
    id: 'tol-jkt-tangerang',
    name: 'Tol Jakarta - Tangerang - Merak',
    type: 'toll',
    color: '#f59e0b',
    glowColor: '#d97706',
    width: 4.5,
    labelCoord: [106.6450, -6.2210],
    coords: [
      [106.7850, -6.1920], // Tomang
      [106.7480, -6.1890], // Kebon Jeruk
      [106.7150, -6.1830], // Meruya / Karang Tengah
      [106.6815, -6.2160], // Kunciran Junction
      [106.6450, -6.2210], // Alam Sutera / Tangerang
      [106.6020, -6.2230], // Lippo Karawaci
      [106.5650, -6.2180], // Bitung
    ],
  },
  {
    id: 'tol-bandara-sedyatmo',
    name: 'Tol Prof. Dr. Ir. Sedyatmo (Akses Bandara)',
    type: 'toll',
    color: '#ec4899',
    glowColor: '#db2777',
    width: 4.5,
    labelCoord: [106.7200, -6.1180],
    coords: [
      [106.7880, -6.1360], // Pluit Interchange
      [106.7450, -6.1210], // Kapuk
      [106.7150, -6.1130], // Rawa Buaya Utara
      [106.6820, -6.1150], // Rawa Bokor
      [106.6558, -6.1256], // Terminal Bandara Soetta
    ],
  },
  {
    id: 'tol-jorr',
    name: 'Tol JORR (Lingkar Luar Jakarta)',
    type: 'toll',
    color: '#8b5cf6',
    glowColor: '#7c3aed',
    width: 4.5,
    labelCoord: [106.8150, -6.3020],
    coords: [
      [106.7640, -6.2570], // Ulujami
      [106.7780, -6.2890], // Veteran / Bintaro
      [106.7920, -6.2920], // Fatmawati
      [106.8250, -6.3040], // TB Simatupang / Ampera
      [106.8520, -6.3070], // Pasar Minggu / Lenteng Agung
      [106.8780, -6.3050], // Kampung Rambutan
      [106.8950, -6.2850], // Ceger / TMII Junction
    ],
  },
];

// 2. REL KERETA API & KRL COMMUTER LINE (Lintas Serpong / Rangkasbitung & Stasiun)
export const RAILWAY_TRACKS: GeoPolylineFeature[] = [
  {
    id: 'krl-serpong-line',
    name: 'Rel KRL Commuter Line (Tanah Abang - Rangkasbitung)',
    type: 'railway',
    color: '#06b6d4',
    glowColor: '#0891b2',
    width: 4,
    labelCoord: [106.6520, -6.3220],
    coords: [
      [106.8143, -6.1856], // Stasiun Tanah Abang
      [106.7975, -6.2075], // Stasiun Palmerah
      [106.7820, -6.2370], // Stasiun Kebayoran
      [106.7440, -6.2840], // Stasiun Pondok Ranji
      [106.7270, -6.2890], // Stasiun Jurang Mangu
      [106.7060, -6.2860], // Stasiun Sudimara
      [106.6830, -6.3015], // Stasiun Rawa Buntu
      [106.6610, -6.3200], // Stasiun Serpong
      [106.6433, -6.3248], // Stasiun Cisauk
      [106.6180, -6.3350], // Stasiun Cicayur
      [106.5750, -6.3470], // Stasiun Parung Panjang
    ],
  },
  {
    id: 'krl-bandara-line',
    name: 'Rel Kereta Bandara Soekarno-Hatta (Railink)',
    type: 'railway',
    color: '#38bdf8',
    glowColor: '#0284c7',
    width: 3.5,
    labelCoord: [106.6680, -6.1550],
    coords: [
      [106.8230, -6.2010], // BNI City / Sudirman Baru
      [106.7920, -6.1680], // Duri
      [106.7450, -6.1580], // Pesing
      [106.6980, -6.1620], // Rawa Buaya
      [106.6650, -6.1750], // Batuceper
      [106.6558, -6.1256], // Bandara Soekarno-Hatta
    ],
  },
];

export const RAILWAY_STATIONS: GeoStation[] = [
  { id: 'st-cisauk', name: 'Stasiun Cisauk (Intermoda BSD)', line: 'KRL Green Line', coord: [106.6433, -6.3248] },
  { id: 'st-serpong', name: 'Stasiun Serpong', line: 'KRL Green Line', coord: [106.6610, -6.3200] },
  { id: 'st-rawabuntu', name: 'Stasiun Rawa Buntu', line: 'KRL Green Line', coord: [106.6830, -6.3015] },
  { id: 'st-sudimara', name: 'Stasiun Sudimara', line: 'KRL Green Line', coord: [106.7060, -6.2860] },
  { id: 'st-jurangmangu', name: 'Stasiun Jurang Mangu', line: 'KRL Green Line', coord: [106.7270, -6.2890] },
  { id: 'st-pondokranji', name: 'Stasiun Pondok Ranji', line: 'KRL Green Line', coord: [106.7440, -6.2840] },
  { id: 'st-kebayoran', name: 'Stasiun Kebayoran', line: 'KRL Green Line', coord: [106.7820, -6.2370] },
  { id: 'st-palmerah', name: 'Stasiun Palmerah', line: 'KRL Green Line', coord: [106.7975, -6.2075] },
  { id: 'st-tanahabang', name: 'Stasiun Tanah Abang', line: 'KRL Green Line', coord: [106.8143, -6.1856] },
];

// 3. WILAYAH KECAMATAN SEKITAR BSD & TANGERANG
export const DISTRICTS: GeoDistrict[] = [
  { id: 'kec-pagedangan', name: 'Kecamatan Pagedangan', regency: 'Kab. Tangerang (GOP / ICE BSD)', coord: [106.6320, -6.2980] },
  { id: 'kec-cisauk', name: 'Kecamatan Cisauk', regency: 'Kab. Tangerang (Intermoda / BSD)', coord: [106.6380, -6.3320] },
  { id: 'kec-serpong', name: 'Kecamatan Serpong', regency: 'Kota Tangerang Selatan', coord: [106.6720, -6.3150] },
  { id: 'kec-serpong-utara', name: 'Kecamatan Serpong Utara', regency: 'Kota Tangerang Selatan (Alam Sutera)', coord: [106.6580, -6.2520] },
  { id: 'kec-kelapdua', name: 'Kecamatan Kelapa Dua', regency: 'Kab. Tangerang (Gading Serpong)', coord: [106.6190, -6.2550] },
  { id: 'kec-legok', name: 'Kecamatan Legok', regency: 'Kab. Tangerang (BSD Barat)', coord: [106.5920, -6.2980] },
  { id: 'kec-ciputat', name: 'Kecamatan Ciputat', regency: 'Kota Tangerang Selatan', coord: [106.7480, -6.3120] },
  { id: 'kec-pamulang', name: 'Kecamatan Pamulang', regency: 'Kota Tangerang Selatan', coord: [106.7280, -6.3450] },
];
