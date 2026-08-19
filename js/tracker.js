/**
 * Smart GPS, Altitude & Pedometer Tracking Engine with Wake Lock
 */

class SmartTracker {
  constructor() {
    this.isTracking = false;
    this.isPaused = false;
    
    // Tracking State
    this.points = [];
    this.totalDistance = 0; // meters
    this.totalSteps = 0;
    this.lastPosition = null;
    this.currentPosition = null;
    this.startTime = null;
    this.pausedDuration = 0;
    this.pauseStartTime = null;
    
    // Altitude tracking
    this.minAltitude = null;
    this.maxAltitude = null;
    this.elevationGain = 0;
    this.lastAltitude = null;

    // POIs and Segments
    this.pois = [];
    this.photos = [];
    this.selectedPOI = null;

    // Wake Lock
    this.wakeLockSentinel = null;

    // Watchers & Timers
    this.geoWatchId = null;
    this.timerInterval = null;
    this.syncTimer = null;
    
    // Pedometer Motion Algorithm Variables
    this.lastStepTime = 0;
    this.motionAvailable = false;
    this.gravityFilter = { x: 0, y: 0, z: 0 };
    this.stepThreshold = 1.35; // Gs magnitude
    this.lastStepMagnitude = 0;
    this.isPeakAbove = false;
    this.stepListeners = [];
    this.positionListeners = [];
    this.statListeners = [];

    // Screen visibility change listener for Wake Lock
    document.addEventListener('visibilitychange', async () => {
      if (this.wakeLockSentinel !== null && document.visibilityState === 'visible' && this.isTracking && !this.isPaused) {
        await this.requestWakeLock();
      }
    });
  }

  // --- Event Listeners Registration ---
  onPositionUpdate(callback) { this.positionListeners.push(callback); }
  onStepUpdate(callback) { this.stepListeners.push(callback); }
  onStatsUpdate(callback) { this.statListeners.push(callback); }

  emitPosition(pos) { this.positionListeners.forEach(cb => cb(pos)); }
  emitStep(step) { this.stepListeners.forEach(cb => cb(step)); }
  emitStats() {
    const stats = this.getCurrentStats();
    this.statListeners.forEach(cb => cb(stats));
  }

  // --- Wake Lock Management ---
  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          console.log('Screen Wake Lock was released');
        });
        console.log('Screen Wake Lock active - screen will not sleep');
        return true;
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
        return false;
      }
    }
    return false;
  }

  async releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
        this.wakeLockSentinel = null;
      } catch (e) {
        console.warn(e);
      }
    }
  }

  // --- Motion / Pedometer Setup ---
  async setupPedometer() {
    // iOS 13+ permission request
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const permissionState = await DeviceMotionEvent.requestPermission();
        if (permissionState === 'granted') {
          this.bindMotionEvents();
          return true;
        }
      } catch (e) {
        console.warn('DeviceMotionEvent permission error:', e);
      }
    } else if (window.DeviceMotionEvent) {
      this.bindMotionEvents();
      return true;
    }
    return false;
  }

  bindMotionEvents() {
    window.addEventListener('devicemotion', (event) => {
      if (!this.isTracking || this.isPaused) return;

      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc) return;

      this.motionAvailable = true;
      const x = acc.x || 0;
      const y = acc.y || 0;
      const z = acc.z || 0;

      // Low-pass filter to separate gravity
      const alpha = 0.8;
      this.gravityFilter.x = alpha * this.gravityFilter.x + (1 - alpha) * x;
      this.gravityFilter.y = alpha * this.gravityFilter.y + (1 - alpha) * y;
      this.gravityFilter.z = alpha * this.gravityFilter.z + (1 - alpha) * z;

      // Linear acceleration (high-pass)
      const lx = x - this.gravityFilter.x;
      const ly = y - this.gravityFilter.y;
      const lz = z - this.gravityFilter.z;

      // Magnitude of dynamic acceleration in m/s^2 / 9.8 => Gs
      const mag = Math.sqrt(lx * lx + ly * ly + lz * lz) / 9.80665;
      const now = Date.now();

      // Peak detection with min 280ms threshold for human walking gait
      if (mag > 0.22 && !this.isPeakAbove && (now - this.lastStepTime > 280)) {
        this.isPeakAbove = true;
        this.totalSteps++;
        this.lastStepTime = now;
        this.emitStep(this.totalSteps);
        this.emitStats();
      } else if (mag < 0.12) {
        this.isPeakAbove = false;
      }
    }, { passive: true });
  }

  addManualStep(count = 1) {
    this.totalSteps += count;
    this.emitStep(this.totalSteps);
    this.emitStats();
  }

  // --- Tracking Lifecycle ---
  async startTracking(initialData = null) {
    if (this.isTracking) return;

    this.isTracking = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.pausedDuration = 0;

    if (initialData) {
      this.points = initialData.points || [];
      this.pois = initialData.pois || [];
      this.photos = initialData.photos || [];
      this.totalDistance = initialData.project.total_distance || 0;
      this.totalSteps = initialData.project.total_steps || 0;
    } else {
      this.points = [];
      this.pois = [];
      this.photos = [];
      this.totalDistance = 0;
      this.totalSteps = 0;
      this.minAltitude = null;
      this.maxAltitude = null;
      this.elevationGain = 0;
    }

    await this.requestWakeLock();
    await this.setupPedometer();
    this.startGeoWatch();

    // Timer Interval for Elapsed Time and Stats UI
    this.timerInterval = setInterval(() => {
      if (this.isTracking && !this.isPaused) {
        this.emitStats();
      }
    }, 1000);
  }

  pauseTracking() {
    if (!this.isTracking || this.isPaused) return;
    this.isPaused = true;
    this.pauseStartTime = Date.now();
    this.releaseWakeLock();
    this.emitStats();
  }

  resumeTracking() {
    if (!this.isTracking || !this.isPaused) return;
    this.isPaused = false;
    if (this.pauseStartTime) {
      this.pausedDuration += (Date.now() - this.pauseStartTime);
      this.pauseStartTime = null;
    }
    this.requestWakeLock();
    this.emitStats();
  }

  stopTracking() {
    this.isTracking = false;
    this.isPaused = false;
    if (this.geoWatchId !== null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.releaseWakeLock();
    return this.getCurrentStats();
  }

  // --- Geolocation Engine ---
  startGeoWatch() {
    if (!('geolocation' in navigator)) {
      alert('이 브라우저는 위치 정보(GPS)를 지원하지 않습니다.');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    };

    this.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => this.handleGeoSuccess(pos),
      (err) => this.handleGeoError(err),
      options
    );
  }

  handleGeoSuccess(position) {
    if (!this.isTracking || this.isPaused) return;

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const altitude = position.coords.altitude !== null ? Math.round(position.coords.altitude * 10) / 10 : 0;
    const speed = position.coords.speed !== null && position.coords.speed > 0 ? (position.coords.speed * 3.6) : 0; // km/h
    const accuracy = position.coords.accuracy;

    const currentPt = {
      latitude: lat,
      longitude: lng,
      altitude: altitude,
      speed: Math.round(speed * 10) / 10,
      stepCount: this.totalSteps,
      accuracy: accuracy,
      timestamp: Date.now()
    };

    if (this.lastPosition) {
      const d = this.calculateDistance(
        this.lastPosition.latitude,
        this.lastPosition.longitude,
        lat,
        lng
      );

      // Filter GPS jitter (ignore if moved less than 1.2m or accuracy is extremely poor)
      if (d >= 1.0) {
        this.totalDistance += d;

        // Altitude gain calculation
        if (altitude !== 0 && this.lastAltitude !== null) {
          const altDiff = altitude - this.lastAltitude;
          if (altDiff > 0.5) {
            this.elevationGain += altDiff;
          }
        }
      }
    }

    // Min/Max Altitude
    if (altitude !== 0) {
      if (this.minAltitude === null || altitude < this.minAltitude) this.minAltitude = altitude;
      if (this.maxAltitude === null || altitude > this.maxAltitude) this.maxAltitude = altitude;
      this.lastAltitude = altitude;
    }

    this.lastPosition = currentPt;
    this.currentPosition = currentPt;
    this.points.push(currentPt);

    this.emitPosition(currentPt);
    this.emitStats();
  }

  handleGeoError(err) {
    console.warn(`Geolocation Error (${err.code}): ${err.message}`);
  }

  // --- Haversine Distance (meters) ---
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // --- POI and Section Management ---
  addPOI(name, customPos = null) {
    const pos = customPos || this.currentPosition;
    if (!pos) return null;

    const poi = {
      id: Date.now(),
      name: name || `지점 #${this.pois.length + 1}`,
      latitude: pos.latitude,
      longitude: pos.longitude,
      altitude: pos.altitude || 0,
      stepCountAtPOI: this.totalSteps,
      distanceAtPOI: this.totalDistance,
      createdAt: new Date().toISOString()
    };

    this.pois.push(poi);
    this.selectedPOI = poi;
    this.emitStats();
    return poi;
  }

  selectPOI(poi) {
    this.selectedPOI = poi;
    this.emitStats();
  }

  // --- Photo Recording ---
  addPhotoRecord({ photoBase64, caption }) {
    const pos = this.currentPosition || { latitude: 0, longitude: 0, altitude: 0 };
    const photo = {
      id: Date.now(),
      latitude: pos.latitude,
      longitude: pos.longitude,
      altitude: pos.altitude || 0,
      photoBase64,
      caption: caption || '',
      stepCount: this.totalSteps,
      distanceAtPhoto: this.totalDistance,
      createdAt: new Date().toISOString()
    };
    this.photos.push(photo);
    this.emitStats();
    return photo;
  }

  // --- Statistics Calculation ---
  getCurrentStats() {
    const now = Date.now();
    let elapsedSeconds = 0;
    if (this.startTime) {
      let currentPause = 0;
      if (this.isPaused && this.pauseStartTime) {
        currentPause = now - this.pauseStartTime;
      }
      elapsedSeconds = Math.max(0, Math.floor((now - this.startTime - this.pausedDuration - currentPause) / 1000));
    }

    // Average Stride (cm) = (Total Distance (m) / Total Steps) * 100
    let avgStride = 0;
    if (this.totalSteps > 0 && this.totalDistance > 0) {
      avgStride = (this.totalDistance / this.totalSteps) * 100;
    }

    // Speed (current vs average)
    const currentSpeed = this.currentPosition ? (this.currentPosition.speed || 0) : 0;
    const avgSpeed = elapsedSeconds > 0 ? ((this.totalDistance / elapsedSeconds) * 3.6) : 0;

    // Segment Stats (From Start -> Current)
    const totalSegment = {
      title: '출발지 ~ 현재 위치',
      distanceMeters: this.totalDistance,
      distanceKm: (this.totalDistance / 1000).toFixed(2),
      steps: this.totalSteps,
      avgStrideCm: avgStride.toFixed(1)
    };

    // Segment Stats (From Selected POI -> Current)
    let poiSegment = null;
    if (this.selectedPOI) {
      const segDist = Math.max(0, this.totalDistance - (this.selectedPOI.distanceAtPOI || 0));
      const segSteps = Math.max(0, this.totalSteps - (this.selectedPOI.stepCountAtPOI || 0));
      const segStride = (segSteps > 0 && segDist > 0) ? ((segDist / segSteps) * 100).toFixed(1) : '0.0';

      poiSegment = {
        title: `[${this.selectedPOI.name}] ~ 현재 위치`,
        poiName: this.selectedPOI.name,
        distanceMeters: segDist,
        distanceKm: (segDist / 1000).toFixed(2),
        steps: segSteps,
        avgStrideCm: segStride
      };
    }

    return {
      isTracking: this.isTracking,
      isPaused: this.isPaused,
      durationSec: elapsedSeconds,
      durationFormatted: this.formatTime(elapsedSeconds),
      totalDistance: Math.round(this.totalDistance * 10) / 10,
      totalDistanceKm: (this.totalDistance / 1000).toFixed(2),
      totalSteps: this.totalSteps,
      avgStride: Math.round(avgStride * 10) / 10,
      avgStrideFormatted: avgStride > 0 ? avgStride.toFixed(1) : '0.0',
      currentSpeed: currentSpeed.toFixed(1),
      avgSpeed: avgSpeed.toFixed(1),
      currentAltitude: this.currentPosition ? (this.currentPosition.altitude || 0) : 0,
      minAltitude: this.minAltitude || 0,
      maxAltitude: this.maxAltitude || 0,
      elevationGain: Math.round(this.elevationGain * 10) / 10,
      currentPosition: this.currentPosition,
      pointCount: this.points.length,
      poiCount: this.pois.length,
      photoCount: this.photos.length,
      totalSegment,
      poiSegment
    };
  }

  formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

window.smartTracker = new SmartTracker();
