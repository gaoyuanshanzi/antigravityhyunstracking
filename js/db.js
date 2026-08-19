/**
 * Neon.tech Serverless PostgreSQL Database Layer
 * Direct Web-to-PostgreSQL Client with Offline Sync Queue
 */

const DB_CONFIG = {
  endpoint: 'https://ep-withered-bonus-axhavcpm.c-4.us-east-2.aws.neon.tech/sql',
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
   * Execute raw parameterized SQL on Neon Serverless HTTP endpoint
   */
  async query(sqlText, params = []) {
    try {
      const response = await fetch(DB_CONFIG.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Neon-Connection-String': DB_CONFIG.connectionString
        },
        body: JSON.stringify({
          query: sqlText,
          params: params
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DB Error [${response.status}]: ${errorText}`);
      }

      const data = await response.json();
      this.isConnected = true;
      return data.rows || [];
    } catch (error) {
      console.error('Neon Query Failed:', error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Initialize tables if they do not exist
   */
  async initSchema() {
    this.notifySyncStatus('connecting', { message: 'Neon DB 테이블 스키마 확인 중...' });

    const statements = [
      `CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'IN_PROGRESS',
        total_distance FLOAT DEFAULT 0,
        total_steps INT DEFAULT 0,
        avg_stride FLOAT DEFAULT 0,
        duration_sec INT DEFAULT 0
      );`,
      `CREATE TABLE IF NOT EXISTS tracking_points (
        id SERIAL PRIMARY KEY,
        project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        latitude FLOAT NOT NULL,
        longitude FLOAT NOT NULL,
        altitude FLOAT DEFAULT 0,
        step_count INT DEFAULT 0,
        speed FLOAT DEFAULT 0,
        recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS pois (
        id SERIAL PRIMARY KEY,
        project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        latitude FLOAT NOT NULL,
        longitude FLOAT NOT NULL,
        altitude FLOAT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY,
        project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        latitude FLOAT NOT NULL,
        longitude FLOAT NOT NULL,
        altitude FLOAT DEFAULT 0,
        photo_base64 TEXT NOT NULL,
        caption TEXT,
        step_count INT DEFAULT 0,
        distance_at_photo FLOAT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );`
    ];

    try {
      for (const sql of statements) {
        await this.query(sql);
      }
      this.isConnected = true;
      this.notifySyncStatus('synced', { message: 'DB 연결 및 테이블 초기화 완료' });
      console.log('Neon Schema initialization completed successfully.');
      return true;
    } catch (err) {
      this.notifySyncStatus('offline', { message: 'DB 연결 실패 (오프라인 모드로 동작)' });
      throw err;
    }
  }

  // --- Project CRUD ---

  async createProject(projectName) {
    const sql = `
      INSERT INTO projects (name, status, total_distance, total_steps, avg_stride, duration_sec)
      VALUES ($1, 'IN_PROGRESS', 0, 0, 0, 0)
      RETURNING *;
    `;
    const rows = await this.query(sql, [projectName]);
    return rows[0];
  }

  async getProjectsList() {
    const sql = `
      SELECT 
        p.*,
        (SELECT COUNT(*) FROM tracking_points tp WHERE tp.project_id = p.id) as point_count,
        (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id) as photo_count,
        (SELECT COUNT(*) FROM pois poi WHERE poi.project_id = p.id) as poi_count
      FROM projects p
      ORDER BY p.created_at DESC;
    `;
    return await this.query(sql);
  }

  async getProjectDetails(projectId) {
    const projectSql = `SELECT * FROM projects WHERE id = $1;`;
    const pointsSql = `SELECT * FROM tracking_points WHERE project_id = $1 ORDER BY recorded_at ASC, id ASC;`;
    const poisSql = `SELECT * FROM pois WHERE project_id = $1 ORDER BY created_at ASC;`;
    const photosSql = `SELECT * FROM photos WHERE project_id = $1 ORDER BY created_at ASC;`;

    const [projectRows, points, pois, photos] = await Promise.all([
      this.query(projectSql, [projectId]),
      this.query(pointsSql, [projectId]),
      this.query(poisSql, [projectId]),
      this.query(photosSql, [projectId])
    ]);

    if (!projectRows || projectRows.length === 0) {
      throw new Error(`Project #${projectId} not found`);
    }

    return {
      project: projectRows[0],
      points: points || [],
      pois: pois || [],
      photos: photos || []
    };
  }

  async updateProjectStats(projectId, { totalDistance, totalSteps, avgStride, durationSec, status = 'IN_PROGRESS' }) {
    const sql = `
      UPDATE projects 
      SET total_distance = $2, total_steps = $3, avg_stride = $4, duration_sec = $5, status = $6
      WHERE id = $1
      RETURNING *;
    `;
    try {
      const rows = await this.query(sql, [projectId, totalDistance, totalSteps, avgStride, durationSec, status]);
      return rows[0];
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
    const sql = `DELETE FROM projects WHERE id = $1;`;
    return await this.query(sql, [projectId]);
  }

  // --- Real-time Recording: Points ---

  async insertTrackingPoint(projectId, { latitude, longitude, altitude = 0, stepCount = 0, speed = 0 }) {
    const sql = `
      INSERT INTO tracking_points (project_id, latitude, longitude, altitude, step_count, speed, recorded_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id, recorded_at;
    `;
    try {
      const rows = await this.query(sql, [projectId, latitude, longitude, altitude, stepCount, speed]);
      this.notifySyncStatus('synced', { message: 'GPS 위치 동기화됨' });
      return rows[0];
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
    const sql = `
      INSERT INTO pois (project_id, name, latitude, longitude, altitude, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;
    try {
      const rows = await this.query(sql, [projectId, name, latitude, longitude, altitude]);
      this.notifySyncStatus('synced', { message: 'POI 핀 저장 완료' });
      return rows[0];
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
    const sql = `
      INSERT INTO photos (project_id, latitude, longitude, altitude, photo_base64, caption, step_count, distance_at_photo, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *;
    `;
    try {
      const rows = await this.query(sql, [
        projectId, latitude, longitude, altitude, photoBase64, caption, stepCount, distanceAtPhoto
      ]);
      this.notifySyncStatus('synced', { message: '사진 및 캡션 저장 완료' });
      return rows[0];
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
          await this.query(
            `INSERT INTO tracking_points (project_id, latitude, longitude, altitude, step_count, speed, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [item.projectId, item.data.latitude, item.data.longitude, item.data.altitude || 0, item.data.stepCount || 0, item.data.speed || 0, item.data.recorded_at]
          );
        } else if (item.type === 'INSERT_POI') {
          await this.query(
            `INSERT INTO pois (project_id, name, latitude, longitude, altitude, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [item.projectId, item.data.name, item.data.latitude, item.data.longitude, item.data.altitude || 0, item.data.created_at]
          );
        } else if (item.type === 'INSERT_PHOTO') {
          await this.query(
            `INSERT INTO photos (project_id, latitude, longitude, altitude, photo_base64, caption, step_count, distance_at_photo, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [item.projectId, item.data.latitude, item.data.longitude, item.data.altitude || 0, item.data.photoBase64, item.data.caption, item.data.stepCount || 0, item.data.distanceAtPhoto || 0, item.data.created_at]
          );
        } else if (item.type === 'UPDATE_PROJECT') {
          const { totalDistance, totalSteps, avgStride, durationSec, status } = item.data;
          await this.query(
            `UPDATE projects SET total_distance = $2, total_steps = $3, avg_stride = $4, duration_sec = $5, status = $6 WHERE id = $1`,
            [item.projectId, totalDistance, totalSteps, avgStride, durationSec, status]
          );
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
