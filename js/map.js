/**
 * Leaflet Map Controller with Permanent Visible Labels for POI & Photo Captions
 */

class MapManager {
  constructor(containerId = 'map') {
    this.containerId = containerId;
    this.map = null;
    this.polyline = null;
    this.currentMarker = null;
    this.accuracyCircle = null;
    this.startMarker = null;
    
    this.poiLayerGroup = null;
    this.photoLayerGroup = null;
    this.trailCoordinates = [];
    
    this.autoFollow = true;
    this.onPhotoClickCallback = null;
    this.onPOIClickCallback = null;
  }

  initMap(initialLat = 37.5665, initialLng = 126.9780, zoom = 16) {
    if (this.map) return;

    this.map = L.map(this.containerId, {
      zoomControl: false,
      attributionControl: false,
      tap: true
    }).setView([initialLat, initialLng], zoom);

    // CartoDB Positron - Premium Crisp White Mode Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      subdomains: 'abcd'
    }).addTo(this.map);

    // Attribution subtle at bottom right
    L.control.attribution({ position: 'bottomright', prefix: '© OpenStreetMap © CARTO' }).addTo(this.map);

    // Polyline Layer for Trail
    this.polyline = L.polyline([], {
      color: '#2563eb', // Vibrant Royal Blue
      weight: 5,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 1
    }).addTo(this.map);

    // Layer groups for POIs and Photos
    this.poiLayerGroup = L.layerGroup().addTo(this.map);
    this.photoLayerGroup = L.layerGroup().addTo(this.map);

    // Detect user dragging to temporarily disable auto-follow
    this.map.on('dragstart', () => {
      this.autoFollow = false;
      const followBtn = document.getElementById('btn-recenter');
      if (followBtn) followBtn.classList.remove('hidden');
    });

    window.addEventListener('resize', () => {
      if (this.map) this.map.invalidateSize();
    });
  }

  setRecenter() {
    this.autoFollow = true;
    const followBtn = document.getElementById('btn-recenter');
    if (followBtn) followBtn.classList.add('hidden');
    
    if (this.currentMarker) {
      const latlng = this.currentMarker.getLatLng();
      this.map.setView(latlng, Math.max(this.map.getZoom(), 16), { animate: true });
    }
  }

  updateCurrentPosition(lat, lng, accuracy = 0) {
    if (!this.map) this.initMap(lat, lng);

    const latlng = [lat, lng];

    // Create or move current location pulse marker
    if (!this.currentMarker) {
      const currentIcon = L.divIcon({
        className: 'current-location-marker-container',
        html: `
          <div class="current-loc-pulse"></div>
          <div class="current-loc-dot"></div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      this.currentMarker = L.marker(latlng, { icon: currentIcon, zIndexOffset: 1000 }).addTo(this.map);
      
      // Start marker
      if (!this.startMarker) {
        const startIcon = L.divIcon({
          className: 'start-flag-marker',
          html: `<div class="start-badge">🚩 출발</div>`,
          iconSize: [60, 26],
          iconAnchor: [30, 26]
        });
        this.startMarker = L.marker(latlng, { icon: startIcon }).addTo(this.map);
      }
    } else {
      this.currentMarker.setLatLng(latlng);
    }

    // Accuracy Circle
    if (accuracy > 0 && accuracy < 100) {
      if (!this.accuracyCircle) {
        this.accuracyCircle = L.circle(latlng, {
          radius: accuracy,
          color: '#3b82f6',
          fillColor: '#93c5fd',
          fillOpacity: 0.15,
          weight: 1
        }).addTo(this.map);
      } else {
        this.accuracyCircle.setLatLng(latlng);
        this.accuracyCircle.setRadius(accuracy);
      }
    }

    // Append to trail polyline
    this.trailCoordinates.push(latlng);
    this.polyline.setLatLngs(this.trailCoordinates);

    if (this.autoFollow) {
      this.map.panTo(latlng, { animate: true, duration: 0.5 });
    }
  }

  // --- Add POI Marker with Permanent Visible Label & Edit Action ---
  addPOIMarker(poi, onClick) {
    if (!this.map) return;

    const safeName = this.escapeHtml(poi.name || '지점');
    const poiIcon = L.divIcon({
      className: 'poi-map-marker-container',
      html: `
        <div class="poi-marker-wrap">
          <div class="poi-pin-icon">📍</div>
          <div class="poi-title-bubble">${safeName}</div>
        </div>
      `,
      iconSize: [140, 50],
      iconAnchor: [70, 48]
    });

    const marker = L.marker([poi.latitude, poi.longitude], { icon: poiIcon, zIndexOffset: 400 });
    marker.poiData = poi;
    
    marker.on('click', (e) => {
      if (onClick) onClick(poi);
    });

    const timeStr = poi.created_at || poi.createdAt ? new Date(poi.created_at || poi.createdAt).toLocaleTimeString() : '';
    marker.bindPopup(`
      <div class="p-2 text-slate-800 min-w-[180px]">
        <div class="flex items-center justify-between mb-1">
          <h4 class="font-extrabold text-sm text-amber-600">📍 ${safeName}</h4>
          <button onclick="window.promptEditPOI(${poi.id})" class="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
            수정
          </button>
        </div>
        <p class="text-[11px] text-slate-400 mb-2">${timeStr}</p>
        <button class="w-full py-1.5 px-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-xs shadow-sm transition" onclick="window.selectPOIFromMap(${poi.id})">
          이 지점부터 구간 통계 보기
        </button>
      </div>
    `);

    this.poiLayerGroup.addLayer(marker);
    return marker;
  }

  // --- Add Photo Marker with Permanent Visible Caption Bubble ---
  addPhotoMarker(photo, onClick) {
    if (!this.map) return;

    const safeCaption = photo.caption ? this.escapeHtml(photo.caption) : '사진';
    const photoIcon = L.divIcon({
      className: 'photo-map-marker-container',
      html: `
        <div class="photo-marker-wrap">
          <div class="photo-pin-bubble">
            <img src="${photo.photoBase64 || photo.photo_base64}" class="photo-pin-thumb" alt="thumb" />
            <span class="photo-camera-icon">📷</span>
          </div>
          <div class="photo-caption-bubble">${safeCaption}</div>
        </div>
      `,
      iconSize: [140, 70],
      iconAnchor: [70, 44]
    });

    const marker = L.marker([photo.latitude, photo.longitude], { icon: photoIcon, zIndexOffset: 500 });
    marker.photoData = photo;
    
    marker.on('click', () => {
      if (onClick) onClick(photo);
    });

    this.photoLayerGroup.addLayer(marker);
    return marker;
  }

  restoreProjectTrail(projectData, onPhotoClick, onPOIClick) {
    this.clearAll();

    const { project, points, pois, photos } = projectData;

    if (!points || points.length === 0) return;

    this.trailCoordinates = points.map(pt => [pt.latitude, pt.longitude]);
    this.polyline.setLatLngs(this.trailCoordinates);

    // Start Marker
    const firstPt = points[0];
    const startIcon = L.divIcon({
      className: 'start-flag-marker',
      html: `<div class="start-badge">🚩 출발</div>`,
      iconSize: [60, 26],
      iconAnchor: [30, 26]
    });
    this.startMarker = L.marker([firstPt.latitude, firstPt.longitude], { icon: startIcon }).addTo(this.map);

    // End Marker
    if (points.length > 1) {
      const lastPt = points[points.length - 1];
      const endIcon = L.divIcon({
        className: 'end-flag-marker',
        html: `<div class="end-badge">🏁 도착</div>`,
        iconSize: [60, 26],
        iconAnchor: [30, 26]
      });
      L.marker([lastPt.latitude, lastPt.longitude], { icon: endIcon }).addTo(this.map);
    }

    // Restore POIs with visible labels
    if (pois && pois.length > 0) {
      pois.forEach(poi => this.addPOIMarker(poi, onPOIClick));
    }

    // Restore Photos with visible captions
    if (photos && photos.length > 0) {
      photos.forEach(photo => this.addPhotoMarker(photo, onPhotoClick));
    }

    // Fit Map Bounds to Trail
    const bounds = L.latLngBounds(this.trailCoordinates);
    this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  }

  clearAll() {
    this.trailCoordinates = [];
    if (this.polyline) this.polyline.setLatLngs([]);
    if (this.poiLayerGroup) this.poiLayerGroup.clearLayers();
    if (this.photoLayerGroup) this.photoLayerGroup.clearLayers();
    if (this.currentMarker) {
      this.map.removeLayer(this.currentMarker);
      this.currentMarker = null;
    }
    if (this.accuracyCircle) {
      this.map.removeLayer(this.accuracyCircle);
      this.accuracyCircle = null;
    }
    if (this.startMarker) {
      this.map.removeLayer(this.startMarker);
      this.startMarker = null;
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
}

window.mapManager = new MapManager();
