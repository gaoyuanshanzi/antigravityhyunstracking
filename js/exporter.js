/**
 * Interactive Single-File HTML Exporter
 * Generates standalone HTML report with Reverse Geocoded Address, Weather, Visible POI/Photo Badges & Avg Speed
 */

class ProjectExporter {
  // Helper to fetch approximate address from coordinates using Nominatim Reverse Geocoding
  static async fetchAddress(lat, lng) {
    if (!lat || !lng) return '위치 정보 없음';
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'ko,en;q=0.8' } });
      if (res.ok) {
        const data = await res.json();
        if (data.display_name) {
          // Format cleaner Korean address
          const addr = data.address || {};
          const country = addr.country || '';
          const city = addr.city || addr.province || addr.state || '';
          const borough = addr.borough || addr.suburb || addr.district || '';
          const road = addr.road || addr.neighbourhood || '';
          const parts = [city, borough, road].filter(Boolean);
          return parts.length > 0 ? parts.join(' ') : data.display_name.split(',').slice(0, 3).join(', ');
        }
      }
    } catch (e) {
      console.warn('Address fetch failed:', e);
    }
    return `위도 ${lat.toFixed(4)}, 경도 ${lng.toFixed(4)}`;
  }

  // Helper to fetch weather condition from Open-Meteo
  static async fetchWeather(lat, lng) {
    if (!lat || !lng) return '기상 정보 없음';
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.current) {
          const temp = data.current.temperature_2m;
          const humidity = data.current.relative_humidity_2m;
          const wind = data.current.wind_speed_10m;
          const code = data.current.weather_code;
          const desc = this.getWeatherDescription(code);
          return `${desc.icon} ${desc.text} (${temp}°C, 습도 ${humidity}%, 풍속 ${wind}km/h)`;
        }
      }
    } catch (e) {
      console.warn('Weather fetch failed:', e);
    }
    return '기상 정보 없음';
  }

  static getWeatherDescription(code) {
    if (code === 0) return { icon: '☀️', text: '맑음' };
    if (code === 1 || code === 2) return { icon: '🌤️', text: '대체로 맑음' };
    if (code === 3) return { icon: '☁️', text: '흐림' };
    if (code >= 45 && code <= 48) return { icon: '🌫️', text: '안개' };
    if (code >= 51 && code <= 67) return { icon: '🌧️', text: '비' };
    if (code >= 71 && code <= 77) return { icon: '❄️', text: '눈' };
    if (code >= 80 && code <= 82) return { icon: '🌦️', text: '소나기' };
    if (code >= 95) return { icon: '⛈️', text: '뇌우' };
    return { icon: '🌡️', text: '보통' };
  }

  static generateStandaloneHTML(projectData, extraInfo = {}) {
    const { project, points = [], pois = [], photos = [] } = projectData;

    const totalDistKm = (project.total_distance / 1000).toFixed(2);
    const avgStrideCm = project.avg_stride ? Number(project.avg_stride).toFixed(1) : '0.0';
    const totalSteps = project.total_steps || 0;
    const durationFmt = this.formatSeconds(project.duration_sec || 0);
    const avgSpeedKmh = project.duration_sec > 0 ? ((project.total_distance / project.duration_sec) * 3.6).toFixed(1) : '0.0';

    // Calculate max speed from points
    let maxSpeedKmh = 0;
    points.forEach(p => {
      if (p.speed && p.speed > maxSpeedKmh) maxSpeedKmh = p.speed;
    });

    // Altitude profile
    let minAlt = 9999, maxAlt = -9999;
    const validAlts = points.filter(p => p.altitude && p.altitude !== 0);
    if (validAlts.length > 0) {
      validAlts.forEach(p => {
        if (p.altitude < minAlt) minAlt = p.altitude;
        if (p.altitude > maxAlt) maxAlt = p.altitude;
      });
    } else {
      minAlt = 0;
      maxAlt = 0;
    }

    const address = extraInfo.address || project.address || '대한민국';
    const weather = extraInfo.weather || project.weather || '기상 정보 수집됨';

    const jsonPayload = JSON.stringify({
      project,
      points,
      pois,
      photos
    }).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${this.escapeHtml(project.name)} - 종합 이동 리포트</title>
  
  <!-- Leaflet CSS -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>

  <style>
    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
    * { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif; }
    body { background-color: #f8fafc; color: #0f172a; }
    #export-map { height: 500px; width: 100%; border-radius: 1.25rem; }
    
    /* Visible POI Label on Map */
    .poi-map-marker-container { display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .poi-marker-wrap { display: flex; flex-direction: column; align-items: center; }
    .poi-pin-icon {
      background: #f59e0b; color: #ffffff; font-size: 14px; width: 28px; height: 28px;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      border: 2px solid #ffffff; box-shadow: 0 3px 10px rgba(245, 158, 11, 0.5);
    }
    .poi-title-bubble {
      background: rgba(255, 255, 255, 0.96); color: #0f172a; font-size: 11px; font-weight: 800;
      padding: 2px 8px; border-radius: 8px; border: 1.5px solid #f59e0b;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15); margin-top: 3px;
      max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
    }

    /* Visible Photo Caption on Map */
    .photo-map-marker-container { display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .photo-marker-wrap { display: flex; flex-direction: column; align-items: center; }
    .photo-pin-bubble {
      width: 42px; height: 42px; border-radius: 50%; border: 3px solid #ffffff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); overflow: hidden; background: #2563eb; position: relative;
    }
    .photo-pin-thumb { width: 100%; height: 100%; object-fit: cover; }
    .photo-camera-icon {
      position: absolute; bottom: -2px; right: -2px; font-size: 9px;
      background: #ffffff; border-radius: 50%; padding: 1px 2px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .photo-caption-bubble {
      background: rgba(15, 23, 42, 0.88); color: #ffffff; font-size: 10px; font-weight: 700;
      padding: 2px 7px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.4);
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2); margin-top: 2px;
      max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
    }

    .start-badge, .end-badge {
      background: #16a34a; color: white; font-weight: 800; font-size: 11px;
      padding: 3px 9px; border-radius: 9999px; box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      border: 2px solid white; text-align: center; white-space: nowrap;
    }
    .end-badge { background: #dc2626; }
  </style>
</head>
<body class="p-4 md:p-8 max-w-5xl mx-auto">

  <!-- Header & Title -->
  <header class="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 mb-6">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <span class="inline-block px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-black uppercase tracking-wider mb-2">
          Tracking Project Report
        </span>
        <h1 class="text-2xl md:text-3xl font-black text-slate-900">${this.escapeHtml(project.name)}</h1>
        <p class="text-xs text-slate-400 mt-1">
          기록 시각: ${new Date(project.created_at).toLocaleString()} • 완료 상태: <span class="text-emerald-600 font-bold">${project.status || 'COMPLETED'}</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="window.print()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition">
          🖨️ PDF / 인쇄하기
        </button>
      </div>
    </div>

    <!-- Location Address & Weather Card -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5 pt-5 border-t border-slate-100">
      <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
        <div class="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-lg flex-shrink-0">
          📍
        </div>
        <div>
          <div class="text-[11px] font-bold text-slate-400">트래킹 지역 주소</div>
          <div class="text-xs md:text-sm font-extrabold text-slate-800">${this.escapeHtml(address)}</div>
        </div>
      </div>

      <div class="flex items-center gap-3 p-3 bg-amber-50/50 rounded-2xl border border-amber-100">
        <div class="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center text-lg flex-shrink-0">
          🌤️
        </div>
        <div>
          <div class="text-[11px] font-bold text-amber-600">현장 기상 / 날씨 요약</div>
          <div class="text-xs md:text-sm font-extrabold text-slate-800">${this.escapeHtml(weather)}</div>
        </div>
      </div>
    </div>

    <!-- Executive Metric Cards Grid (Including Avg Speed prominently) -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mt-6">
      
      <!-- Distance -->
      <div class="bg-blue-50/60 p-4 rounded-2xl border border-blue-100">
        <span class="text-xs font-bold text-blue-600">총 이동 거리</span>
        <div class="text-2xl font-black text-blue-900 mt-1">${totalDistKm} <span class="text-xs font-bold">km</span></div>
        <div class="text-[11px] text-blue-500 mt-0.5">${Number(project.total_distance).toLocaleString()} m</div>
      </div>

      <!-- Avg Speed (Feature 5) -->
      <div class="bg-indigo-50/60 p-4 rounded-2xl border border-indigo-100">
        <span class="text-xs font-bold text-indigo-600">평균 속도</span>
        <div class="text-2xl font-black text-indigo-900 mt-1">${avgSpeedKmh} <span class="text-xs font-bold">km/h</span></div>
        <div class="text-[11px] text-indigo-500 mt-0.5">최고: ${Number(maxSpeedKmh).toFixed(1)} km/h</div>
      </div>

      <!-- Steps -->
      <div class="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-100">
        <span class="text-xs font-bold text-emerald-600">총 걸음 수</span>
        <div class="text-2xl font-black text-emerald-900 mt-1">${totalSteps.toLocaleString()} <span class="text-xs font-bold">보</span></div>
        <div class="text-[11px] text-emerald-500 mt-0.5">만보기 센서 측정</div>
      </div>

      <!-- Avg Stride -->
      <div class="bg-amber-50/60 p-4 rounded-2xl border border-amber-100">
        <span class="text-xs font-bold text-amber-600">평균 보폭</span>
        <div class="text-2xl font-black text-amber-900 mt-1">${avgStrideCm} <span class="text-xs font-bold">cm</span></div>
        <div class="text-[11px] text-amber-500 mt-0.5">거리 / 걸음수 자동산출</div>
      </div>

      <!-- Duration & Altitude -->
      <div class="bg-purple-50/60 p-4 rounded-2xl border border-purple-100 col-span-2 md:col-span-1">
        <span class="text-xs font-bold text-purple-600">소요 시간</span>
        <div class="text-2xl font-black text-purple-900 mt-1">${durationFmt}</div>
        <div class="text-[11px] text-purple-500 mt-0.5">고도: ${minAlt}m ~ ${maxAlt}m</div>
      </div>
    </div>
  </header>

  <!-- Interactive Map Section with Visible POI & Photo Captions -->
  <section class="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 mb-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
          <span>🗺️</span> 이동 경로 및 지점 지도
        </h2>
        <p class="text-xs text-slate-400 mt-0.5">지도 상에 등록된 지점 명칭과 사진 캡션이 표출됩니다.</p>
      </div>
      <span class="text-xs text-slate-400">포인트 ${points.length}개 / POI ${pois.length}개 / 사진 ${photos.length}개</span>
    </div>
    
    <div id="export-map" class="shadow-inner border border-slate-200"></div>

    <div class="flex flex-wrap gap-4 items-center justify-center text-xs text-slate-600 mt-4 pt-3 border-t border-slate-100">
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-blue-600 inline-block"></span> 이동 궤적 (Polyline)</div>
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-emerald-600 inline-block"></span> 출발 지점</div>
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-red-600 inline-block"></span> 도착 지점</div>
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-amber-500 inline-block"></span> 특정 지점 (POI 명칭 표시)</div>
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> 촬영 사진 (캡션 표시, 클릭 시 확대)</div>
    </div>
  </section>

  <!-- POI List Section -->
  ${pois.length > 0 ? `
  <section class="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 mb-6">
    <h2 class="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
      <span>📍</span> 지정 지점(POI) 상세 기록 (${pois.length}곳)
    </h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${pois.map((poi, idx) => `
        <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
          <div class="flex items-center justify-between mb-2">
            <span class="font-extrabold text-slate-900 text-sm">#${idx + 1} 📍 ${this.escapeHtml(poi.name)}</span>
            <span class="text-xs text-slate-400">${new Date(poi.created_at).toLocaleTimeString()}</span>
          </div>
          <div class="text-xs text-slate-500 space-y-0.5">
            <div>좌표: ${poi.latitude.toFixed(6)}, ${poi.longitude.toFixed(6)}</div>
            <div>고도: ${poi.altitude || 0} m</div>
          </div>
        </div>
      `).join('')}
    </div>
  </section>
  ` : ''}

  <!-- Photo Log Gallery Section -->
  ${photos.length > 0 ? `
  <section class="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 mb-6">
    <h2 class="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
      <span>📸</span> 현장 기록 사진 갤러리 (${photos.length}장)
    </h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      ${photos.map((photo, idx) => `
        <div class="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition">
          <div class="aspect-video w-full bg-slate-900 overflow-hidden cursor-pointer flex items-center justify-center" onclick="openPhotoModal(${idx})">
            <img src="${photo.photo_base64 || photo.photoBase64}" class="w-full h-full object-cover hover:scale-105 transition duration-300" alt="photo" />
          </div>
          <div class="p-4">
            <p class="font-bold text-slate-900 text-sm mb-2">"${this.escapeHtml(photo.caption || '메모 없음')}"</p>
            <div class="space-y-1 text-xs text-slate-500 border-t border-slate-200/60 pt-2">
              <div class="flex justify-between">
                <span>촬영 시각</span>
                <span class="font-medium text-slate-700">${new Date(photo.created_at).toLocaleTimeString()}</span>
              </div>
              <div class="flex justify-between">
                <span>누적 이동 거리</span>
                <span class="font-medium text-slate-700">${Number(photo.distance_at_photo || 0).toLocaleString()} m</span>
              </div>
              <div class="flex justify-between">
                <span>누적 걸음 수</span>
                <span class="font-medium text-slate-700">${Number(photo.step_count || 0).toLocaleString()} 보</span>
              </div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </section>
  ` : ''}

  <!-- Lightbox Modal -->
  <div id="lightbox-modal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm hidden items-center justify-center p-4" onclick="closePhotoModal()">
    <div class="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onclick="event.stopPropagation()">
      <div class="p-4 border-b flex justify-between items-center">
        <h3 class="font-black text-slate-900 text-sm">사진 상세 보기</h3>
        <button onclick="closePhotoModal()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600">✕</button>
      </div>
      <div class="p-2 bg-slate-950 flex items-center justify-center max-h-[60vh]">
        <img id="modal-img" src="" class="max-h-[58vh] max-w-full object-contain rounded-xl" />
      </div>
      <div class="p-5">
        <p id="modal-caption" class="text-base font-bold text-slate-900 mb-2"></p>
        <div id="modal-meta" class="text-xs text-slate-500 space-y-1"></div>
      </div>
    </div>
  </div>

  <footer class="text-center text-xs text-slate-400 py-6">
    Smart GPS & Step Tracker • Neon.tech PostgreSQL Serverless System
  </footer>

  <!-- Leaflet JS -->
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>

  <script>
    const data = ${jsonPayload};
    const photosList = data.photos || [];

    function initExportMap() {
      if (!data.points || data.points.length === 0) {
        document.getElementById('export-map').innerHTML = '<div class="p-8 text-center text-slate-400">기록된 위치 좌표가 없습니다.</div>';
        return;
      }

      const map = L.map('export-map', { zoomControl: true, attributionControl: false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
      }).addTo(map);

      const latlngs = data.points.map(p => [p.latitude, p.longitude]);
      
      // Polyline
      L.polyline(latlngs, {
        color: '#2563eb',
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);

      // Start Marker
      const startIcon = L.divIcon({
        className: 'start-flag-marker',
        html: '<div class="start-badge">🚩 출발</div>',
        iconSize: [60, 26],
        iconAnchor: [30, 26]
      });
      L.marker(latlngs[0], { icon: startIcon }).addTo(map);

      // End Marker
      if (latlngs.length > 1) {
        const endIcon = L.divIcon({
          className: 'end-flag-marker',
          html: '<div class="end-badge">🏁 도착</div>',
          iconSize: [60, 26],
          iconAnchor: [30, 26]
        });
        L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map);
      }

      // POIs with Permanent Visible Labels
      if (data.pois) {
        data.pois.forEach(poi => {
          const poiIcon = L.divIcon({
            className: 'poi-map-marker-container',
            html: '<div class="poi-marker-wrap"><div class="poi-pin-icon">📍</div><div class="poi-title-bubble">' + (poi.name || '지점') + '</div></div>',
            iconSize: [140, 50],
            iconAnchor: [70, 48]
          });
          L.marker([poi.latitude, poi.longitude], { icon: poiIcon })
            .addTo(map)
            .bindPopup('<b>📍 ' + poi.name + '</b><br><span style="font-size:11px;color:#64748b;">' + new Date(poi.created_at).toLocaleTimeString() + '</span>');
        });
      }

      // Photos with Permanent Visible Captions
      if (data.photos) {
        data.photos.forEach((photo, idx) => {
          const captionText = photo.caption || '사진';
          const photoIcon = L.divIcon({
            className: 'photo-map-marker-container',
            html: '<div class="photo-marker-wrap"><div class="photo-pin-bubble"><img src="' + (photo.photo_base64 || photo.photoBase64) + '" class="photo-pin-thumb" /><span class="photo-camera-icon">📷</span></div><div class="photo-caption-bubble">' + captionText + '</div></div>',
            iconSize: [140, 70],
            iconAnchor: [70, 44]
          });
          const marker = L.marker([photo.latitude, photo.longitude], { icon: photoIcon }).addTo(map);
          marker.on('click', () => openPhotoModal(idx));
        });
      }

      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    function openPhotoModal(idx) {
      const p = photosList[idx];
      if (!p) return;
      document.getElementById('modal-img').src = p.photo_base64 || p.photoBase64;
      document.getElementById('modal-caption').innerText = p.caption || '메모 없음';
      document.getElementById('modal-meta').innerHTML = \`
        <div>📅 <b>촬영 시각:</b> \${new Date(p.created_at).toLocaleString()}</div>
        <div>👣 <b>누적 걸음 수:</b> \${Number(p.step_count || 0).toLocaleString()} 보</div>
        <div>📏 <b>누적 거리:</b> \${Number(p.distance_at_photo || 0).toLocaleString()} m</div>
        <div>🌐 <b>좌표:</b> \${p.latitude.toFixed(6)}, \${p.longitude.toFixed(6)}</div>
      \`;
      const modal = document.getElementById('lightbox-modal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closePhotoModal() {
      const modal = document.getElementById('lightbox-modal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    window.addEventListener('DOMContentLoaded', initExportMap);
  <\/script>
</body>
</html>`;
  }

  static async downloadHTML(projectData) {
    let repLat = 37.5665, repLng = 126.9780;
    if (projectData.points && projectData.points.length > 0) {
      repLat = projectData.points[0].latitude;
      repLng = projectData.points[0].longitude;
    }

    const [address, weather] = await Promise.all([
      this.fetchAddress(repLat, repLng),
      this.fetchWeather(repLat, repLng)
    ]);

    const htmlString = this.generateStandaloneHTML(projectData, { address, weather });
    const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const sanitizedName = (projectData.project.name || 'tracking_project')
      .replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    const filename = `${sanitizedName}_report_${new Date().toISOString().slice(0, 10)}.html`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static formatSeconds(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  static escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

window.projectExporter = ProjectExporter;
