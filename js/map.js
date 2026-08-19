/**
 * Leaflet Map Controller for Mobile White-Mode Tracking
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
    
    this.isUserPanning = false;
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

    // Invalidate map size when window resizes or orientation changes
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
          html: `<div class="start-badge">출발</div>`,
          iconSize: [44, 24],
          iconAnchor: [22, 24]
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

  addPOIMarker(poi, onClick) {
    if (!this.map) return;

    const poiIcon = L.divIcon({
      className: 'poi-map-marker',
      html: `
        <div class="poi-pin">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        </div>
        <div class="poi-label">${poi.name}</div>
      `,
      iconSize: [120, 36],
      iconAnchor: [60, 36]
    });

    const marker = L.marker([poi.latitude, poi.longitude], { icon: poiIcon });
    
    marker.on('click', () => {
      if (onClick) onClick(poi);
    });

    marker.bindPopup(`
      <div class="p-2 text-slate-800">
        <h4 class="font-bold text-sm text-blue-600 mb-1">📍 ${poi.name}</h4>
        <p class="text-xs text-slate-500 mb-2">${new Date(poi.createdAt || poi.created_at).toLocaleTimeString()}</p>
        <button class="w-full py-1 px-2 bg-blue-50 text-blue-600 font-semibold rounded text-xs border border-blue-200" onclick="window.selectPOIFromMap(${poi.id})">
          이 지점부터 구간 통계 보기
        </button>
      </div>
    `);

    this.poiLayerGroup.addLayer(marker);
    return marker;
  }

  addPhotoMarker(photo, onClick) {
    if (!this.map) return;

    const photoIcon = L.divIcon({
      className: 'photo-map-marker',
      html: `
        <div class="photo-pin-bubble">
          <img src="${photo.photoBase64 || photo.photo_base64}" class="photo-pin-thumb" alt="thumb" />
          <span class="photo-camera-icon">📷</span>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 44]
    });

    const marker = L.marker([photo.latitude, photo.longitude], { icon: photoIcon, zIndexOffset: 500 });
    
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
      html: `<div class="start-badge">출발</div>`,
      iconSize: [44, 24],
      iconAnchor: [22, 24]
    });
    this.startMarker = L.marker([firstPt.latitude, firstPt.longitude], { icon: startIcon }).addTo(this.map);

    // End Marker
    const lastPt = points[points.length - 1];
    const endIcon = L.divIcon({
      className: 'end-flag-marker',
      html: `<div class="end-badge">도착</div>`,
      iconSize: [44, 24],
      iconAnchor: [22, 24]
    });
    L.marker([lastPt.latitude, lastPt.longitude], { icon: endIcon }).addTo(this.map);

    // Restore POIs
    if (pois && pois.length > 0) {
      pois.forEach(poi => this.addPOIMarker(poi, onPOIClick));
    }

    // Restore Photos
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
}

window.mapManager = new MapManager();
