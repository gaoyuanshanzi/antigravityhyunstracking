/**
 * Interactive Single-File HTML Exporter
 * Generates an offline standalone HTML report with embedded Leaflet map, trail, photos, and stats.
 */

class ProjectExporter {
  static generateStandaloneHTML(projectData) {
    const { project, points, pois, photos } = projectData;

    const totalDistKm = (project.total_distance / 1000).toFixed(2);
    const avgStrideCm = project.avg_stride ? Number(project.avg_stride).toFixed(1) : '0.0';
    const totalSteps = project.total_steps || 0;
    const durationFmt = this.formatSeconds(project.duration_sec || 0);
    const avgSpeedKmh = project.duration_sec > 0 ? ((project.total_distance / project.duration_sec) * 3.6).toFixed(1) : '0.0';

    // Calculate altitude profile stats
    let minAlt = 9999, maxAlt = -9999;
    let validAlts = points.filter(p => p.altitude && p.altitude !== 0);
    if (validAlts.length > 0) {
      validAlts.forEach(p => {
        if (p.altitude < minAlt) minAlt = p.altitude;
        if (p.altitude > maxAlt) maxAlt = p.altitude;
      });
    } else {
      minAlt = 0;
      maxAlt = 0;
    }

    const jsonPayload = JSON.stringify({
      project,
      points,
      pois,
      photos
    }).replace(/</g, '\\u003c'); // Escape script tag injection

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
    #export-map { height: 480px; width: 100%; border-radius: 1rem; }
    .photo-pin-bubble {
      width: 44px; height: 44px; border-radius: 50%;
      border: 3px solid #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.25);
      overflow: hidden; background: #2563eb; position: relative;
    }
    .photo-pin-thumb { width: 100%; height: 100%; object-fit: cover; }
    .photo-camera-icon {
      position: absolute; bottom: -2px; right: -2px;
      font-size: 10px; background: #ffffff; border-radius: 50%; padding: 1px 2px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .start-badge, .end-badge {
      background: #16a34a; color: white; font-weight: 700; font-size: 11px;
      padding: 3px 8px; border-radius: 9999px; box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      border: 2px solid white; text-align: center;
    }
    .end-badge { background: #dc2626; }
    .poi-pin {
      background: #f59e0b; color: white; padding: 4px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .poi-label {
      background: rgba(255,255,255,0.95); font-size: 11px; font-weight: 700;
      color: #1e293b; padding: 2px 6px; border-radius: 6px; border: 1px solid #cbd5e1;
      margin-top: 2px; text-align: center; white-space: nowrap;
    }
  </style>
</head>
<body class="p-4 md:p-8 max-w-5xl mx-auto">

  <!-- Header & Title -->
  <header class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <span class="inline-block px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-bold uppercase tracking-wider mb-2">
          Tracking Project Report
        </span>
        <h1 class="text-2xl md:text-3xl font-extrabold text-slate-900">${this.escapeHtml(project.name)}</h1>
        <p class="text-sm text-slate-500 mt-1">
          기록 시각: ${new Date(project.created_at).toLocaleString()} • 완료 상태: <span class="text-emerald-600 font-semibold">${project.status || 'COMPLETED'}</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="window.print()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-sm transition">
          🖨️ PDF/인쇄
        </button>
      </div>
    </div>

    <!-- Executive Summary Metric Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-6">
      <div class="bg-blue-50/60 p-4 rounded-xl border border-blue-100">
        <span class="text-xs font-semibold text-blue-600">총 이동 거리</span>
        <div class="text-2xl font-black text-blue-900 mt-1">${totalDistKm} <span class="text-sm font-semibold">km</span></div>
        <div class="text-xs text-blue-500 mt-0.5">${project.total_distance.toLocaleString()} m</div>
      </div>

      <div class="bg-emerald-50/60 p-4 rounded-xl border border-emerald-100">
        <span class="text-xs font-semibold text-emerald-600">총 걸음 수</span>
        <div class="text-2xl font-black text-emerald-900 mt-1">${totalSteps.toLocaleString()} <span class="text-sm font-semibold">보</span></div>
        <div class="text-xs text-emerald-500 mt-0.5">평균 속도: ${avgSpeedKmh} km/h</div>
      </div>

      <div class="bg-amber-50/60 p-4 rounded-xl border border-amber-100">
        <span class="text-xs font-semibold text-amber-600">평균 보폭</span>
        <div class="text-2xl font-black text-amber-900 mt-1">${avgStrideCm} <span class="text-sm font-semibold">cm</span></div>
        <div class="text-xs text-amber-500 mt-0.5">거리 / 걸음수 환산</div>
      </div>

      <div class="bg-purple-50/60 p-4 rounded-xl border border-purple-100">
        <span class="text-xs font-semibold text-purple-600">총 소요 시간</span>
        <div class="text-2xl font-black text-purple-900 mt-1">${durationFmt}</div>
        <div class="text-xs text-purple-500 mt-0.5">고도: ${minAlt}m ~ ${maxAlt}m</div>
      </div>
    </div>
  </header>

  <!-- Interactive Map Section -->
  <section class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2">
        <span>🗺️</span> 이동 경로 및 지점 지도
      </h2>
      <span class="text-xs text-slate-400">GPS 포인트 ${points.length}개 / POI ${pois.length}개 / 사진 ${photos.length}개</span>
    </div>
    
    <div id="export-map" class="shadow-inner border border-slate-200"></div>

    <div class="flex flex-wrap gap-4 items-center justify-center text-xs text-slate-600 mt-4 pt-3 border-t border-slate-100">
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-blue-600 inline-block"></span> 이동 궤적 (Polyline)</div>
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-emerald-600 inline-block"></span> 출발 지점</div>
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-red-600 inline-block"></span> 도착 지점</div>
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-amber-500 inline-block"></span> 특정 지점 (POI)</div>
      <div class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> 촬영 사진 (클릭 시 확대)</div>
    </div>
  </section>

  <!-- POI & Segment Statistics Section -->
  ${pois.length > 0 ? `
  <section class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
    <h2 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
      <span>📍</span> 지정 지점(POI) 구간별 기록
    </h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${pois.map((poi, idx) => `
        <div class="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition">
          <div class="flex items-center justify-between mb-2">
            <span class="font-bold text-slate-800 text-base">#${idx + 1} ${this.escapeHtml(poi.name)}</span>
            <span class="text-xs text-slate-400">${new Date(poi.created_at).toLocaleTimeString()}</span>
          </div>
          <div class="text-xs text-slate-500">
            좌표: ${poi.latitude.toFixed(6)}, ${poi.longitude.toFixed(6)} | 고도: ${poi.altitude || 0}m
          </div>
        </div>
      `).join('')}
    </div>
  </section>
  ` : ''}

  <!-- Photo Log Gallery Section -->
  ${photos.length > 0 ? `
  <section class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
    <h2 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
      <span>📸</span> 현장 기록 사진 갤러리 (${photos.length}장)
    </h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      ${photos.map((photo, idx) => `
        <div class="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition">
          <div class="aspect-video w-full bg-slate-200 overflow-hidden cursor-pointer" onclick="openPhotoModal(${idx})">
            <img src="${photo.photo_base64 || photo.photoBase64}" class="w-full h-full object-cover hover:scale-105 transition duration-300" alt="photo" />
          </div>
          <div class="p-4">
            <p class="font-semibold text-slate-900 text-sm mb-2">"${this.escapeHtml(photo.caption || '메모 없음')}"</p>
            <div class="space-y-1 text-xs text-slate-500 border-t border-slate-200/60 pt-2">
              <div class="flex justify-between">
                <span>촬영 시각</span>
                <span class="font-medium text-slate-700">${new Date(photo.created_at).toLocaleTimeString()}</span>
              </div>
              <div class="flex justify-between">
                <span>누적 이동 거리</span>
                <span class="font-medium text-slate-700">${(photo.distance_at_photo || 0).toLocaleString()} m</span>
              </div>
              <div class="flex justify-between">
                <span>누적 걸음 수</span>
                <span class="font-medium text-slate-700">${(photo.step_count || 0).toLocaleString()} 보</span>
              </div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </section>
  ` : ''}

  <!-- Photo Modal View -->
  <div id="lightbox-modal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm hidden items-center justify-center p-4" onclick="closePhotoModal()">
    <div class="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onclick="event.stopPropagation()">
      <div class="p-3 border-b flex justify-between items-center">
        <h3 id="modal-title" class="font-bold text-slate-800 text-sm">사진 상세</h3>
        <button onclick="closePhotoModal()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600">✕</button>
      </div>
      <div class="p-2 bg-slate-950 flex items-center justify-center max-h-[60vh]">
        <img id="modal-img" src="" class="max-h-[58vh] max-w-full object-contain" />
      </div>
      <div class="p-4">
        <p id="modal-caption" class="text-base font-bold text-slate-800 mb-2"></p>
        <div id="modal-meta" class="text-xs text-slate-500 space-y-1"></div>
      </div>
    </div>
  </div>

  <footer class="text-center text-xs text-slate-400 py-6">
    Generated with Smart GPS & Step Tracker • Neon.tech PostgreSQL Serverless Engine
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
        html: '<div class="start-badge">출발</div>',
        iconSize: [44, 24],
        iconAnchor: [22, 24]
      });
      L.marker(latlngs[0], { icon: startIcon }).addTo(map).bindPopup('<b>🚩 출발 지점</b>');

      // End Marker
      if (latlngs.length > 1) {
        const endIcon = L.divIcon({
          className: 'end-flag-marker',
          html: '<div class="end-badge">도착</div>',
          iconSize: [44, 24],
          iconAnchor: [22, 24]
        });
        L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map).bindPopup('<b>🏁 도착 지점</b>');
      }

      // POIs
      if (data.pois) {
        data.pois.forEach(poi => {
          const poiIcon = L.divIcon({
            className: 'poi-map-marker',
            html: '<div class="poi-pin">📍</div><div class="poi-label">' + poi.name + '</div>',
            iconSize: [100, 36],
            iconAnchor: [50, 36]
          });
          L.marker([poi.latitude, poi.longitude], { icon: poiIcon })
            .addTo(map)
            .bindPopup('<b>📍 ' + poi.name + '</b><br><span style="font-size:11px;color:#64748b;">' + new Date(poi.created_at).toLocaleTimeString() + '</span>');
        });
      }

      // Photos
      if (data.photos) {
        data.photos.forEach((photo, idx) => {
          const photoIcon = L.divIcon({
            className: 'photo-map-marker',
            html: '<div class="photo-pin-bubble"><img src="' + (photo.photo_base64 || photo.photoBase64) + '" class="photo-pin-thumb" /><span class="photo-camera-icon">📷</span></div>',
            iconSize: [44, 44],
            iconAnchor: [22, 44]
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
        <div>👣 <b>누적 걸음 수:</b> \${(p.step_count || 0).toLocaleString()} 보</div>
        <div>📏 <b>누적 거리:</b> \${(p.distance_at_photo || 0).toLocaleString()} m</div>
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

  static downloadHTML(projectData) {
    const htmlString = this.generateStandaloneHTML(projectData);
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
