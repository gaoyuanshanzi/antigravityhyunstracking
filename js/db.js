/**
 * Neon.tech Serverless PostgreSQL Database Client
 * Uses Vercel Serverless /api/db endpoint with LocalStorage offline fallback
 */

const getApiEndpoint = () => {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return `${window.location.origin}/api/db`;
  }
  return '/api/db';
};

const DB_CONFIG = {
  offlineKey: 'smart_tracker_offline_queue_v2',
  localProjectsKey: 'smart_tracker_local_projects_v2'
};

class NeonDB {
  constructor() {
    this.isConnected = true;
    this.syncListeners = [];
    this.isSyncing = false;
    
    // Auto-sync when coming back online
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('Network is online. Flushing offline queue...');
        this.flushOfflineQueue();
      });
    }
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
   * Main Request Method to /api/db
   */
  async request(action, payload = {}) {
    const endpoint = getApiEndpoint();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          this.isConnected = true;
          this.notifySyncStatus('synced', { message: 'DB 연결됨' });
          return json.data;
        }
        throw new Error(json.error || 'Serverless DB Error');
      } else {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
    } catch (err) {
      console.warn(`Request [${action}] failed, using local offline fallback:`, err.message);
      this.isConnected = false;
      this.notifySyncStatus('offline', { message: '오프라인 모드' });
      return this.handleOfflineFallback(action, payload);
    }
  }

  /**
   * Offline LocalStorage Fallback Handlers
   */
  handleOfflineFallback(action, payload) {
    const localProjects = this.getLocalProjects();

    if (action === 'get_projects') {
      return localProjects;
    }

    if (action === 'create_project') {
      const newProj = {
        id: Date.now(),
        name: payload.name || `트래킹_${new Date().toLocaleTimeString()}`,
        created_at: new Date().toISOString(),
        status: 'IN_PROGRESS',
        total_distance: 0,
        total_steps: 0,
        avg_stride: 0,
        duration_sec: 0,
        is_local_only: true
      };
      localProjects.unshift(newProj);
      this.saveLocalProjects(localProjects);
      
      // Enqueue for Neon sync
      this.enqueueOffline({ type: 'CREATE_PROJECT', data: newProj });
      return newProj;
    }

    if (action === 'get_project_details') {
      const found = localProjects.find(p => p.id === payload.projectId) || {
        id: payload.projectId,
        name: '오프라인 프로젝트',
        total_distance: 0,
        total_steps: 0,
        avg_stride: 0,
        duration_sec: 0
      };
      return {
        project: found,
        points: [],
        pois: [],
        photos: []
      };
    }

    if (action === 'insert_point') {
      this.enqueueOffline({ type: 'INSERT_POINT', projectId: payload.projectId, data: payload });
      return { id: Date.now(), recorded_at: new Date().toISOString() };
    }

    if (action === 'insert_poi') {
      this.enqueueOffline({ type: 'INSERT_POI', projectId: payload.projectId, data: payload });
      return { id: Date.now(), ...payload };
    }

    if (action === 'insert_photo') {
      this.enqueueOffline({ type: 'INSERT_PHOTO', projectId: payload.projectId, data: payload });
      return { id: Date.now(), ...payload };
    }

    if (action === 'update_project') {
      this.enqueueOffline({ type: 'UPDATE_PROJECT', projectId: payload.projectId, data: payload });
      return { id: payload.projectId, ...payload };
    }

    if (action === 'delete_project') {
      const filtered = localProjects.filter(p => p.id !== payload.projectId);
      this.saveLocalProjects(filtered);
      return { success: true };
    }

    return null;
  }

  getLocalProjects() {
    try {
      const raw = localStorage.getItem(DB_CONFIG.localProjectsKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  saveLocalProjects(projects) {
    try {
      localStorage.setItem(DB_CONFIG.localProjectsKey, JSON.stringify(projects));
    } catch (e) {
      console.error(e);
    }
  }

  // --- Project CRUD ---

  async initSchema() {
    try {
      await this.request('init_schema');
      return true;
    } catch (e) {
      return false;
    }
  }

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
    return await this.request('update_project', {
      projectId, totalDistance, totalSteps, avgStride, durationSec, status
    });
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

  async insertTrackingPoint(projectId, pointData) {
    return await this.request('insert_point', { projectId, ...pointData });
  }

  async insertPOI(projectId, poiData) {
    return await this.request('insert_poi', { projectId, ...poiData });
  }

  async insertPhoto(projectId, photoData) {
    return await this.request('insert_photo', { projectId, ...photoData });
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
        this.notifySyncStatus('offline', { pendingCount, message: `${pendingCount}개 대기` });
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
        if (item.type === 'CREATE_PROJECT') {
          await this.request('create_project', { name: item.data.name });
        } else if (item.type === 'INSERT_POINT') {
          await this.request('insert_point', { projectId: item.projectId, ...item.data });
        } else if (item.type === 'INSERT_POI') {
          await this.request('insert_poi', { projectId: item.projectId, ...item.data });
        } else if (item.type === 'INSERT_PHOTO') {
          await this.request('insert_photo', { projectId: item.projectId, ...item.data });
        } else if (item.type === 'UPDATE_PROJECT') {
          await this.request('update_project', { projectId: item.projectId, ...item.data });
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
    }
  }
}

window.neonDB = new NeonDB();
