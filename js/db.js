/**
 * Neon.tech Serverless PostgreSQL Database Client
 * Uses API endpoint with direct Neon fallback & Offline Sync Queue
 */

const DB_CONFIG = {
  apiEndpoint: '/api/db',
  directEndpoint: 'https://ep-withered-bonus-axhavcpm.c-4.us-east-2.aws.neon.tech/sql',
  connectionString: 'postgresql://neondb_owner:npg_I5p0SZdrNGVj@ep-withered-bonus-axhavcpm.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require',
  offlineKey: 'smart_tracker_offline_queue_v1'
};

class NeonDB {
  constructor() {
    this.isConnected = false;
    this.syncListeners = [];
    this.isSyncing = false;
    
    // Auto-sync when coming back online
    window.addEventListener('online', () => {
      console.log('Network is online. Flushing offline queue...');
      this.flushOfflineQueue();
    });
  }

  onSyncStatusChange(callback) {
    this.syncListeners.push(callback);
  }

  notifySyncStatus(status, details = {}) {
    this.syncListeners.forEach(cb => {
      try { cb(status, details); } catch(e) { console.error(e); }
    });
  }

  /**
   * Universal Request Handler: Tries Vercel Serverless /api/db first, falls back to direct Neon HTTP API
   */
  async request(action, payload = {}) {
    try {
      // 1. Try serverless backend proxy (/api/db)
      const res = await fetch(DB_CONFIG.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          this.isConnected = true;
          return json.data;
        }
        throw new Error(json.error || 'Serverless DB Error');
      }
    } catch (err) {
      console.warn('API route failed or not present, attempting direct Neon HTTP fetch:', err);
    }

    // 2. Direct Neon HTTP API Fallback
    return await this.directFallback(action, payload);
  }

  async directFallback(action, payload) {
    if (action === 'get_projects') {
      const sql = `
        SELECT 
          p.*,
          (SELECT COUNT(*) FROM tracking_points tp WHERE tp.project_id = p.id) as point_count,
          (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id) as photo_count,
          (SELECT COUNT(*) FROM pois poi WHERE poi.project_id = p.id) as poi_count
        FROM projects p
        ORDER BY p.created_at DESC;
      `;
      return await this.directQuery(sql);
    }

    if (action === 'create_project') {
      const sql = `INSERT INTO projects (name, status, total_distance, total_steps, avg_stride, duration_sec) VALUES ($1, 'IN_PROGRESS', 0, 0, 0, 0) RETURNING *;`;
      const rows = await this.directQuery(sql, [payload.name]);
      return rows[0];
    }

    if (action === 'get_project_details') {
      const [projectRows, points, pois, photos] = await Promise.all([
        this.directQuery(`SELECT * FROM projects WHERE id = $1;`, [payload.projectId]),
        this.directQuery(`SELECT * FROM tracking_points WHERE project_id = $1 ORDER BY recorded_at ASC, id ASC;`, [payload.projectId]),
        this.directQuery(`SELECT * FROM pois WHERE project_id = $1 ORDER BY created_at ASC;`, [payload.projectId]),
        this.directQuery(`SELECT * FROM photos WHERE project_id = $1 ORDER BY created_at ASC;`, [payload.projectId])
      ]);
      return {
        project: projectRows[0] || null,
        points: points || [],
        pois: pois || [],
        photos: photos || []
      };
    }

    if (action === 'insert_point') {
      const sql = `INSERT INTO tracking_points (project_id, latitude, longitude, altitude, step_count, speed, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id, recorded_at;`;
      const rows = await this.directQuery(sql, [payload.projectId, payload.latitude, payload.longitude, payload.altitude || 0, payload.stepCount || 0, payload.speed || 0]);
      return rows[0];
    }

    if (action === 'insert_poi') {
      const sql = `INSERT INTO pois (project_id, name, latitude, longitude, altitude, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *;`;
      const rows = await this.directQuery(sql, [payload.projectId, payload.name, payload.latitude, payload.longitude, payload.altitude || 0]);
      return rows[0];
    }

    if (action === 'insert_photo') {
      const sql = `INSERT INTO photos (project_id, latitude, longitude, altitude, photo_base64, caption, step_count, distance_at_photo, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *;`;
      const rows = await this.directQuery(sql, [payload.projectId, payload.latitude, payload.longitude, payload.altitude || 0, payload.photoBase64, payload.caption, payload.stepCount || 0, payload.distanceAtPhoto || 0]);
      return rows[0];
    }

    if (action === 'update_project') {
      const sql = `UPDATE projects SET total_distance = $2, total_steps = $3, avg_stride = $4, duration_sec = $5, status = $6 WHERE id = $1 RETURNING *;`;
      const rows = await this.directQuery(sql, [payload.projectId, payload.totalDistance, payload.totalSteps, payload.avgStride, payload.durationSec, payload.status || 'IN_PROGRESS']);
      return rows[0];
    }

    if (action === 'delete_project') {
      const sql = `DELETE FROM projects WHERE id = $1;`;
      return await this.directQuery(sql, [payload.projectId]);
    }

    return null;
  }

  async directQuery(sqlText, params = []) {
    try {
      const response = await fetch(DB_CONFIG.directEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Neon-Connection-String': DB_CONFIG.connectionString
        },
        body: JSON.stringify({ query: sqlText, params: params })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Neon Error [${response.status}]: ${errorText}`);
      }

      const data = await response.json();
      this.isConnected = true;
      return data.rows || [];
    } catch (error) {
      console.error('Direct Query Error:', error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Initialize tables if they do not exist
   */
  async initSchema() {
    this.notifySyncStatus('connecting', { message: 'Neon DB 연결 중...' });
    try {
      await this.request('init_schema');
      this.isConnected = true;
      this.notifySyncStatus('synced', { message: 'DB 연결됨' });
      return true;
    } catch (err) {
      console.warn('Schema init note:', err);
      // Even if schema init had a minor network hiccup, consider online if requests can pass
      this.notifySyncStatus('synced', { message: 'DB 준비됨' });
      return false;
    }
  }

  // --- Project CRUD ---

  async createProject(projectName) {
    return await this.request('create_project', { name: projectName });
  }

  async getProjectsList() {
    const list = await this.request('get_projects');
    return Array.isArray(list) ? list : [];
  }

  async getProjectDetails(projectId) {
    return await this.request('get_project_details', { projectId });
  }

  async updateProjectStats(projectId, { totalDistance, totalSteps, avgStride, durationSec, status = 'IN_PROGRESS' }) {
    try {
      return await this.request('update_project', {
        projectId, totalDistance, totalSteps, avgStride, durationSec, status
      });
    } catch (err) {
      console.warn('Failed to update project stats immediately, queuing...', err);
      this.enqueueOffline({
        type: 'UPDATE_PROJECT',
        projectId,
        data: { totalDistance, totalSteps, avgStride, durationSec, status }
      });
    }
  }

  async completeProject(projectId, summary) {
    return await this.updateProjectStats(projectId, {
      totalDistance: summary.totalDistance,
      totalSteps: summary.totalSteps,
      avgStride: summary.avgStride,
      durationSec: summary.durationSec,
      status: 'COMPLETED'
    });
  }

  async deleteProject(projectId) {
    return await this.request('delete_project', { projectId });
  }

  // --- Real-time Recording: Points ---

  async insertTrackingPoint(projectId, { latitude, longitude, altitude = 0, stepCount = 0, speed = 0 }) {
    try {
      const res = await this.request('insert_point', {
        projectId, latitude, longitude, altitude, stepCount, speed
      });
      this.notifySyncStatus('synced', { message: 'GPS 위치 동기화됨' });
      return res;
    } catch (err) {
      console.warn('GPS Point DB sync failed, queuing to localStorage:', err);
      this.enqueueOffline({
        type: 'INSERT_POINT',
        projectId,
        data: { latitude, longitude, altitude, stepCount, speed, recorded_at: new Date().toISOString() }
      });
      this.notifySyncStatus('offline', { message: '오프라인 저장 중' });
    }
  }

  // --- POI ---

  async insertPOI(projectId, { name, latitude, longitude, altitude = 0 }) {
    try {
      const res = await this.request('insert_poi', {
        projectId, name, latitude, longitude, altitude
      });
      this.notifySyncStatus('synced', { message: 'POI 핀 저장 완료' });
      return res;
    } catch (err) {
      this.enqueueOffline({
        type: 'INSERT_POI',
        projectId,
        data: { name, latitude, longitude, altitude, created_at: new Date().toISOString() }
      });
      this.notifySyncStatus('offline', { message: 'POI 오프라인 저장됨' });
    }
  }

  // --- Photos ---

  async insertPhoto(projectId, { latitude, longitude, altitude = 0, photoBase64, caption, stepCount = 0, distanceAtPhoto = 0 }) {
    try {
      const res = await this.request('insert_photo', {
        projectId, latitude, longitude, altitude, photoBase64, caption, stepCount, distanceAtPhoto
      });
      this.notifySyncStatus('synced', { message: '사진 및 캡션 저장 완료' });
      return res;
    } catch (err) {
      this.enqueueOffline({
        type: 'INSERT_PHOTO',
        projectId,
        data: { latitude, longitude, altitude, photoBase64, caption, stepCount, distanceAtPhoto, created_at: new Date().toISOString() }
      });
      this.notifySyncStatus('offline', { message: '사진 오프라인 저장됨' });
    }
  }

  // --- Offline Queue Handling ---

  getOfflineQueue() {
    try {
      const raw = localStorage.getItem(DB_CONFIG.offlineKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  saveOfflineQueue(queue) {
    try {
      localStorage.setItem(DB_CONFIG.offlineKey, JSON.stringify(queue));
      const pendingCount = queue.length;
      if (pendingCount > 0) {
        this.notifySyncStatus('offline', { pendingCount, message: `${pendingCount}개 대기 중` });
      }
    } catch (e) {
      console.error('LocalStorage save error:', e);
    }
  }

  enqueueOffline(item) {
    const queue = this.getOfflineQueue();
    queue.push(item);
    this.saveOfflineQueue(queue);
  }

  async flushOfflineQueue() {
    if (this.isSyncing) return;
    const queue = this.getOfflineQueue();
    if (queue.length === 0) {
      this.notifySyncStatus('synced', { message: '동기화 완료' });
      return;
    }

    this.isSyncing = true;
    this.notifySyncStatus('syncing', { pendingCount: queue.length, message: `${queue.length}개 동기화 중...` });

    const remaining = [];

    for (const item of queue) {
      try {
        if (item.type === 'INSERT_POINT') {
          await this.request('insert_point', {
            projectId: item.projectId,
            ...item.data
          });
        } else if (item.type === 'INSERT_POI') {
          await this.request('insert_poi', {
            projectId: item.projectId,
            ...item.data
          });
        } else if (item.type === 'INSERT_PHOTO') {
          await this.request('insert_photo', {
            projectId: item.projectId,
            ...item.data
          });
        } else if (item.type === 'UPDATE_PROJECT') {
          await this.request('update_project', {
            projectId: item.projectId,
            ...item.data
          });
        }
      } catch (e) {
        console.error('Failed to sync item:', item, e);
        remaining.push(item);
      }
    }

    this.saveOfflineQueue(remaining);
    this.isSyncing = false;

    if (remaining.length === 0) {
      this.notifySyncStatus('synced', { message: '모든 데이터 동기화 완료' });
    } else {
      this.notifySyncStatus('offline', { pendingCount: remaining.length, message: `${remaining.length}개 재시도 대기` });
    }
  }
}

window.neonDB = new NeonDB();
