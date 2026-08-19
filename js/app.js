/**
 * Main Application Orchestration Controller
 * Handles Auth, Project State, UI Events, Real-Time Sync & Media
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // App State
  let currentProject = null;
  let syncInterval = null;
  let tempPhotoBase64 = null;
  let isAuthorized = false;

  // UI Element Selectors
  const modalLogin = document.getElementById('modal-login');
  const formLogin = document.getElementById('form-login');
  const loginIdInput = document.getElementById('login-id');
  const loginPwInput = document.getElementById('login-password');
  const loginError = document.getElementById('login-error');

  const modalProject = document.getElementById('modal-project');
  const btnProjectMenu = document.getElementById('btn-project-menu');
  const btnCloseProjectModal = document.getElementById('btn-close-project-modal');
  const btnLogout = document.getElementById('btn-logout');
  const btnCreateProject = document.getElementById('btn-create-project');
  const inputNewProjectName = document.getElementById('input-new-project-name');
  const btnRefreshProjects = document.getElementById('btn-refresh-projects');
  const projectsListContainer = document.getElementById('projects-list-container');

  const hudProjectTitle = document.getElementById('hud-project-title');
  const hudDistance = document.getElementById('hud-distance');
  const hudSteps = document.getElementById('hud-steps');
  const hudStride = document.getElementById('hud-stride');
  const hudAvgSpeed = document.getElementById('hud-avg-speed');
  const hudDuration = document.getElementById('hud-duration');
  const hudSpeed = document.getElementById('hud-speed');
  const hudAltitude = document.getElementById('hud-altitude');
  const wakelockBadge = document.getElementById('wakelock-badge');
  const syncBadge = document.getElementById('sync-badge');
  const syncBadgeText = document.getElementById('sync-badge-text');

  const segmentStatsPanel = document.getElementById('segment-stats-panel');
  const segmentPoiName = document.getElementById('segment-poi-name');
  const segmentDistance = document.getElementById('segment-distance');
  const segmentSteps = document.getElementById('segment-steps');
  const segmentStride = document.getElementById('segment-stride');
  const btnCloseSegment = document.getElementById('btn-close-segment');

  const btnRecenter = document.getElementById('btn-recenter');
  const btnManualStep = document.getElementById('btn-manual-step');

  const btnActionPoi = document.getElementById('btn-action-poi');
  const btnActionPhoto = document.getElementById('btn-action-photo');
  const photoInput = document.getElementById('photo-input');
  const btnActionPause = document.getElementById('btn-action-pause');
  const pauseIcon = document.getElementById('pause-icon');
  const pauseText = document.getElementById('pause-text');
  const btnActionFinish = document.getElementById('btn-action-finish');

  // Modals: POI & Edit POI
  const modalPoiInput = document.getElementById('modal-poi-input');
  const inputPoiName = document.getElementById('input-poi-name');
  const btnClosePoiModal = document.getElementById('btn-close-poi-modal');
  const btnCancelPoi = document.getElementById('btn-cancel-poi');
  const btnSavePoi = document.getElementById('btn-save-poi');

  const modalEditPoi = document.getElementById('modal-edit-poi');
  const editPoiId = document.getElementById('edit-poi-id');
  const editPoiNameInput = document.getElementById('edit-poi-name-input');
  const btnCloseEditPoi = document.getElementById('btn-close-edit-poi');
  const btnCancelEditPoi = document.getElementById('btn-cancel-edit-poi');
  const btnSaveEditPoi = document.getElementById('btn-save-edit-poi');

  // Modals: Photo Caption & Detail
  const modalPhotoCaption = document.getElementById('modal-photo-caption');
  const previewCapturedPhoto = document.getElementById('preview-captured-photo');
  const inputPhotoCaption = document.getElementById('input-photo-caption');
  const captionMetaCoords = document.getElementById('caption-meta-coords');
  const captionMetaSteps = document.getElementById('caption-meta-steps');
  const captionMetaDistance = document.getElementById('caption-meta-distance');
  const btnCloseCaptionModal = document.getElementById('btn-close-caption-modal');
  const btnCancelPhoto = document.getElementById('btn-cancel-photo');
  const btnSavePhoto = document.getElementById('btn-save-photo');

  const modalPhotoDetail = document.getElementById('modal-photo-detail');
  const detailPhotoId = document.getElementById('detail-photo-id');
  const detailPhotoImg = document.getElementById('detail-photo-img');
  const detailPhotoCaptionInput = document.getElementById('detail-photo-caption-input');
  const btnSavePhotoCaption = document.getElementById('btn-save-photo-caption');
  const detailPhotoTime = document.getElementById('detail-photo-time');
  const detailPhotoSteps = document.getElementById('detail-photo-steps');
  const detailPhotoDistance = document.getElementById('detail-photo-distance');
  const detailPhotoCoords = document.getElementById('detail-photo-coords');
  const btnClosePhotoDetail = document.getElementById('btn-close-photo-detail');

  // Modals: Finish Confirm
  const modalFinishConfirm = document.getElementById('modal-finish-confirm');
  const finishSummaryTitle = document.getElementById('finish-summary-title');
  const finishSummaryDist = document.getElementById('finish-summary-dist');
  const finishSummarySteps = document.getElementById('finish-summary-steps');
  const finishSummaryDuration = document.getElementById('finish-summary-duration');
  const btnCancelFinish = document.getElementById('btn-cancel-finish');
  const btnConfirmFinishExport = document.getElementById('btn-confirm-finish-export');

  // Toast Helper
  function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3200);
  }

  // --- 1. Admin Authentication ---
  const AUTH_KEY = 'smart_tracker_auth_session';

  function checkExistingAuth() {
    if (sessionStorage.getItem(AUTH_KEY) === 'valid_admin') {
      isAuthorized = true;
      modalLogin.classList.remove('active');
      onLoginSuccess();
    } else {
      modalLogin.classList.add('active');
    }
  }

  formLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = loginIdInput.value.trim();
    const pw = loginPwInput.value.trim();

    if (id === 'admin' && pw === '123jesus') {
      loginError.classList.add('hidden');
      sessionStorage.setItem(AUTH_KEY, 'valid_admin');
      isAuthorized = true;
      modalLogin.classList.remove('active');
      showToast('✅ 관리자 로그인 성공');
      onLoginSuccess();
    } else {
      loginError.classList.remove('hidden');
    }
  });

  btnLogout.addEventListener('click', () => {
    if (confirm('로그아웃 하시겠습니까?')) {
      if (window.smartTracker.isTracking) {
        window.smartTracker.stopTracking();
      }
      sessionStorage.removeItem(AUTH_KEY);
      location.reload();
    }
  });

  // --- 2. DB Init & App Setup ---
  async function onLoginSuccess() {
    // Initialize Map with default view
    window.mapManager.initMap();

    // Initialize Neon DB schema
    try {
      await window.neonDB.initSchema();
      showToast('🟢 Neon PostgreSQL 연결 완료');
    } catch (err) {
      showToast('⚠️ DB 초기화 경고: ' + err.message);
    }

    // Open Project Selection Modal
    openProjectModal();
    loadProjectsList();
  }

  // Sync Status Listener
  window.neonDB.onSyncStatusChange((status, details) => {
    syncBadge.className = `sync-badge ${status}`;
    if (status === 'synced') {
      syncBadgeText.textContent = details.message || 'DB 동기화됨';
    } else if (status === 'syncing') {
      syncBadgeText.textContent = details.message || '동기화 중...';
    } else if (status === 'offline') {
      syncBadgeText.textContent = details.message || '오프라인';
    }
  });

  // --- 3. Project Management Handlers ---
  function openProjectModal() {
    modalProject.classList.add('active');
    loadProjectsList();
  }

  function closeProjectModal() {
    modalProject.classList.remove('active');
  }

  btnProjectMenu.addEventListener('click', openProjectModal);
  btnCloseProjectModal.addEventListener('click', closeProjectModal);
  btnRefreshProjects.addEventListener('click', loadProjectsList);

  const btnHudDownloadPhotos = document.getElementById('btn-hud-download-photos');
  const btnBatchDownloadPhotosModal = document.getElementById('btn-batch-download-photos-modal');
  const btnDownloadSinglePhoto = document.getElementById('btn-download-single-photo');

  // Hook up HUD batch download button
  if (btnHudDownloadPhotos) {
    btnHudDownloadPhotos.addEventListener('click', () => {
      if (currentProject) {
        window.downloadProjectPhotos(currentProject.id, currentProject.name);
      }
    });
  }

  if (btnBatchDownloadPhotosModal) {
    btnBatchDownloadPhotosModal.addEventListener('click', () => {
      if (currentProject) {
        window.downloadProjectPhotos(currentProject.id, currentProject.name);
      }
    });
  }

  async function loadProjectsList() {
    projectsListContainer.innerHTML = '<div class="text-center py-6 text-slate-400 text-xs">프로젝트 목록을 조회하는 중...</div>';
    try {
      const projects = await window.neonDB.getProjectsList();
      if (!projects || projects.length === 0) {
        projectsListContainer.innerHTML = `
          <div class="text-center py-6 px-4 bg-slate-50/80 rounded-2xl border border-dashed border-slate-200">
            <div class="w-9 h-9 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2 text-sm font-bold">📍</div>
            <div class="font-bold text-slate-700 text-xs">아직 등록된 프로젝트가 없습니다.</div>
            <div class="text-[11px] text-slate-400 mt-1">상단의 <b>[새 트래킹 시작]</b>에서 프로젝트명을 입력하고 첫 측정을 시작해보세요!</div>
          </div>
        `;
        return;
      }

      projectsListContainer.innerHTML = projects.map(p => {
        const isCurrent = currentProject && currentProject.id === p.id;
        const dateStr = new Date(p.created_at).toLocaleString();
        const distKm = (p.total_distance / 1000).toFixed(2);
        const isCompleted = p.status === 'COMPLETED';
        const photoCount = Number(p.photo_count || 0);

        return `
          <div class="p-3.5 rounded-xl border ${isCurrent ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20' : 'border-slate-200 bg-white hover:bg-slate-50'} transition flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <div class="font-extrabold text-sm text-slate-900 truncate max-w-[200px]">${window.projectExporter.escapeHtml(p.name)}</div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isCompleted ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700'}">
                ${isCompleted ? '완료됨' : '기록중'}
              </span>
            </div>

            <div class="flex items-center justify-between text-xs text-slate-500">
              <span>${distKm} km • ${p.total_steps || 0}보 • 📸 ${photoCount}장</span>
              <span class="text-[11px] text-slate-400">${dateStr}</span>
            </div>

            <div class="flex gap-2 pt-1 border-t border-slate-100 mt-1">
              <button class="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition" onclick="window.selectProjectById(${p.id})">
                ${isCompleted ? '기록 불러오기' : '이어서 기록'}
              </button>
              ${photoCount > 0 ? `
              <button class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold transition flex items-center gap-1" onclick="window.downloadProjectPhotos(${p.id}, '${window.projectExporter.escapeHtml(p.name)}')" title="사진 일괄 다운로드">
                📥 사진(${photoCount})
              </button>
              ` : ''}
              <button class="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-bold transition" onclick="window.deleteProjectById(${p.id})">
                삭제
              </button>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.warn('Project list lookup notice:', err);
      projectsListContainer.innerHTML = `
        <div class="text-center py-6 px-4 bg-slate-50/80 rounded-2xl border border-dashed border-slate-200">
          <div class="w-9 h-9 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2 text-sm font-bold">📍</div>
          <div class="font-bold text-slate-700 text-xs">아직 등록된 프로젝트가 없습니다.</div>
          <div class="text-[11px] text-slate-400 mt-1">상단의 <b>[새 트래킹 시작]</b>에서 프로젝트명을 입력하고 첫 측정을 시작해보세요!</div>
        </div>
      `;
    }
  }

  // Create New Project
  btnCreateProject.addEventListener('click', async () => {
    const name = inputNewProjectName.value.trim() || `트래킹_${new Date().toLocaleDateString()}_${new Date().toLocaleTimeString()}`;
    btnCreateProject.disabled = true;
    btnCreateProject.textContent = '생성중...';
    try {
      const created = await window.neonDB.createProject(name);
      inputNewProjectName.value = '';
      closeProjectModal();
      startProjectSession(created);
      showToast(`✨ 새 프로젝트 '${created.name}' 시작`);
    } catch (err) {
      console.warn('Project creation fallback:', err);
      // Fallback local session
      const fallbackProj = {
        id: Date.now(),
        name: name,
        status: 'IN_PROGRESS',
        total_distance: 0,
        total_steps: 0,
        avg_stride: 0,
        duration_sec: 0
      };
      inputNewProjectName.value = '';
      closeProjectModal();
      startProjectSession(fallbackProj);
      showToast(`✨ 새 프로젝트 '${name}' 시작 (로컬/동기화)`);
    } finally {
      btnCreateProject.disabled = false;
      btnCreateProject.textContent = '시작';
    }
  });

  // Select / Restore Existing Project
  window.selectProjectById = async (projectId) => {
    try {
      showToast('📥 프로젝트 데이터 복원 중...');
      const fullData = await window.neonDB.getProjectDetails(projectId);
      closeProjectModal();
      restoreProjectSession(fullData);
    } catch (err) {
      alert('프로젝트 불러오기 실패: ' + err.message);
    }
  };

  // Single Photo Download (Feature 2)
  if (btnDownloadSinglePhoto) {
    btnDownloadSinglePhoto.addEventListener('click', () => {
      if (!activePhotoForEdit) return;
      const b64 = activePhotoForEdit.photoBase64 || activePhotoForEdit.photo_base64;
      if (!b64) return;

      const safeCaption = (activePhotoForEdit.caption || 'photo')
        .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
        .slice(0, 30);
      const filename = `${safeCaption}_${Date.now()}.jpg`;

      downloadBase64File(b64, filename);
      showToast('📥 사진 파일이 다운로드되었습니다.');
    });
  }

  // Batch Download All Photos as ZIP (Feature 3)
  window.downloadProjectPhotos = async (projectId, projectName) => {
    try {
      showToast('📦 사진 파일들을 압축(ZIP)하는 중...');
      const fullData = await window.neonDB.getProjectDetails(projectId);
      const photos = fullData.photos || [];

      if (photos.length === 0) {
        alert('이 프로젝트에 저장된 사진이 없습니다.');
        return;
      }

      if (typeof JSZip === 'undefined') {
        // Fallback: sequential download
        for (let i = 0; i < photos.length; i++) {
          const p = photos[i];
          const b64 = p.photoBase64 || p.photo_base64;
          const fname = `${projectName}_${i + 1}.jpg`;
          downloadBase64File(b64, fname);
        }
        showToast(`📥 ${photos.length}장의 사진이 다운로드되었습니다.`);
        return;
      }

      const zip = new JSZip();
      const folderName = `${projectName || 'project'}_photos`.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
      const imgFolder = zip.folder(folderName);

      let captionSummary = `=== [${projectName}] 사진 캡션 및 메타데이터 목록 ===\n\n`;

      photos.forEach((photo, idx) => {
        const b64 = photo.photo_base64 || photo.photoBase64;
        if (!b64) return;

        // Strip data:image/jpeg;base64, header
        const base64Data = b64.replace(/^data:image\/[a-z]+;base64,/, '');
        const safeCaption = (photo.caption || 'photo')
          .replace(/[^a-zA-Z0-9가-힣_-]/g, '_')
          .slice(0, 25);
        const fileName = `${String(idx + 1).padStart(2, '0')}_${safeCaption}.jpg`;

        imgFolder.file(fileName, base64Data, { base64: true });

        captionSummary += `[${idx + 1}] 파일명: ${fileName}\n`;
        captionSummary += `    - 캡션/메모: ${photo.caption || '(메모 없음)'}\n`;
        captionSummary += `    - 촬영시각: ${new Date(photo.created_at || photo.createdAt).toLocaleString()}\n`;
        captionSummary += `    - 누적걸음: ${Number(photo.step_count || photo.stepCount || 0).toLocaleString()}보 | 누적거리: ${Number(photo.distance_at_photo || photo.distanceAtPhoto || 0).toLocaleString()}m\n`;
        captionSummary += `    - 위치좌표: ${photo.latitude}, ${photo.longitude}\n\n`;
      });

      imgFolder.file('00_사진_메모_요약.txt', captionSummary);

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = `${folderName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(zipUrl);

      showToast(`🎉 모든 사진(${photos.length}장) 압축 다운로드 완료!`);
    } catch (err) {
      console.error('Batch photo download error:', err);
      alert('사진 일괄 다운로드 실패: ' + err.message);
    }
  };

  function downloadBase64File(base64Str, filename) {
    const a = document.createElement('a');
    a.href = base64Str;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Delete Project Completely from Neon DB & Local Storage (Feature 1)
  window.deleteProjectById = async (projectId) => {
    if (!confirm('이 프로젝트 및 관련 GPS 좌표, POI, 사진 데이터를 Neon DB에서 완전히 삭제하시겠습니까?\n(삭제 후 Neon DB 용량이 즉시 확보됩니다.)')) return;
    try {
      showToast('🗑️ Neon DB에서 영구 삭제 중...');
      await window.neonDB.deleteProject(projectId);
      showToast('✅ 프로젝트 및 사진 데이터가 완전히 삭제되었습니다.');
      loadProjectsList();
      if (currentProject && currentProject.id === projectId) {
        currentProject = null;
        window.smartTracker.stopTracking();
        window.mapManager.clearAll();
        hudProjectTitle.textContent = '프로젝트를 선택하세요';
        if (btnHudDownloadPhotos) btnHudDownloadPhotos.classList.add('hidden');
      }
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  };

  function startProjectSession(project) {
    currentProject = project;
    hudProjectTitle.textContent = project.name;
    window.mapManager.clearAll();
    if (btnHudDownloadPhotos) btnHudDownloadPhotos.classList.add('hidden');
    
    // Start tracker
    window.smartTracker.startTracking();
    startPeriodicDBSync();
    updateUIControls();
  }

  function restoreProjectSession(fullData) {
    currentProject = fullData.project;
    hudProjectTitle.textContent = currentProject.name;

    // Show Batch download button in HUD if project has photos
    const photoCount = fullData.photos ? fullData.photos.length : 0;
    if (btnHudDownloadPhotos) {
      if (photoCount > 0) {
        btnHudDownloadPhotos.classList.remove('hidden');
        btnHudDownloadPhotos.title = `사진 전체 다운로드 (${photoCount}장)`;
      } else {
        btnHudDownloadPhotos.classList.add('hidden');
      }
    }

    // Restore map polylines, POIs, Photos
    window.mapManager.restoreProjectTrail(
      fullData,
      (photo) => openPhotoDetail(photo),
      (poi) => selectPOIForSegment(poi)
    );

    // If project was completed, just load stats and map without live GPS override
    if (currentProject.status === 'COMPLETED') {
      window.smartTracker.stopTracking();
      if (syncInterval) clearInterval(syncInterval);

      const dist = currentProject.total_distance || 0;
      const dur = currentProject.duration_sec || 0;
      const avgSpd = dur > 0 ? ((dist / dur) * 3.6).toFixed(1) : '0.0';

      hudDistance.textContent = (dist / 1000).toFixed(2);
      hudSteps.textContent = Number(currentProject.total_steps || 0).toLocaleString();
      hudStride.textContent = currentProject.avg_stride ? Number(currentProject.avg_stride).toFixed(1) : '0.0';
      if (hudAvgSpeed) hudAvgSpeed.textContent = avgSpd;
      hudDuration.textContent = window.projectExporter.formatSeconds(dur);
      showToast('📖 완료된 프로젝트 기록을 불러왔습니다.');
    } else {
      // Resume live tracking
      window.smartTracker.startTracking(fullData);
      startPeriodicDBSync();
      showToast('🏃 진행 중인 프로젝트를 이어서 시작합니다.');
    }
    updateUIControls();
  }

  // --- 4. Periodic DB Sync Engine ---
  function startPeriodicDBSync() {
    if (syncInterval) clearInterval(syncInterval);

    let lastSyncedPointIndex = 0;

    syncInterval = setInterval(async () => {
      if (!currentProject || !window.smartTracker.isTracking || window.smartTracker.isPaused) return;

      const stats = window.smartTracker.getCurrentStats();
      const points = window.smartTracker.points;

      // Sync any new points
      if (points.length > lastSyncedPointIndex) {
        const newPoints = points.slice(lastSyncedPointIndex);
        for (const pt of newPoints) {
          await window.neonDB.insertTrackingPoint(currentProject.id, {
            latitude: pt.latitude,
            longitude: pt.longitude,
            altitude: pt.altitude,
            stepCount: pt.stepCount,
            speed: pt.speed
          });
        }
        lastSyncedPointIndex = points.length;
      }

      // Update project summary in DB
      await window.neonDB.updateProjectStats(currentProject.id, {
        totalDistance: stats.totalDistance,
        totalSteps: stats.totalSteps,
        avgStride: stats.avgStride,
        durationSec: stats.durationSec,
        status: 'IN_PROGRESS'
      });

    }, 5000); // 5-second interval
  }

  // --- 5. Tracker Event Listeners & HUD Updates ---
  window.smartTracker.onPositionUpdate((pos) => {
    window.mapManager.updateCurrentPosition(pos.latitude, pos.longitude, pos.accuracy);
  });

  window.smartTracker.onStatsUpdate((stats) => {
    hudDistance.textContent = stats.totalDistanceKm;
    hudSteps.textContent = stats.totalSteps.toLocaleString();
    hudStride.textContent = stats.avgStrideFormatted;
    if (hudAvgSpeed) hudAvgSpeed.textContent = stats.avgSpeed;
    hudDuration.textContent = stats.durationFormatted;
    hudSpeed.textContent = stats.currentSpeed;
    hudAltitude.textContent = stats.currentAltitude !== 0 ? stats.currentAltitude : '--';

    // Segment Card Update if active
    if (stats.poiSegment) {
      segmentStatsPanel.classList.remove('hidden');
      segmentPoiName.textContent = `[${stats.poiSegment.poiName}] 기준`;
      segmentDistance.textContent = stats.poiSegment.distanceKm;
      segmentSteps.textContent = stats.poiSegment.steps.toLocaleString();
      segmentStride.textContent = stats.poiSegment.avgStrideCm;
    }
  });

  // Recenter Button
  btnRecenter.addEventListener('click', () => {
    window.mapManager.setRecenter();
  });

  // Manual Step Button
  btnManualStep.addEventListener('click', () => {
    window.smartTracker.addManualStep(1);
    showToast('👣 1보 추가됨');
  });

  // --- 6. POI Feature (Add & Edit) ---
  btnActionPoi.addEventListener('click', () => {
    if (!currentProject) {
      showToast('⚠️ 먼저 프로젝트를 시작하거나 선택해주세요.');
      return;
    }
    inputPoiName.value = `지점 #${window.smartTracker.pois.length + 1}`;
    modalPoiInput.classList.add('active');
  });

  function closePoiModal() {
    modalPoiInput.classList.remove('active');
  }

  btnClosePoiModal.addEventListener('click', closePoiModal);
  btnCancelPoi.addEventListener('click', closePoiModal);

  btnSavePoi.addEventListener('click', async () => {
    const name = inputPoiName.value.trim() || `지점 #${window.smartTracker.pois.length + 1}`;
    const poi = window.smartTracker.addPOI(name);
    if (!poi) {
      alert('위치 정보를 확인할 수 없습니다. GPS 수신을 기다려주세요.');
      return;
    }

    closePoiModal();
    window.mapManager.addPOIMarker(poi, (p) => selectPOIForSegment(p));
    
    // Save to Neon DB
    await window.neonDB.insertPOI(currentProject.id, {
      name: poi.name,
      latitude: poi.latitude,
      longitude: poi.longitude,
      altitude: poi.altitude
    });

    showToast(`📍 지점 '${poi.name}' 등록 완료`);
    selectPOIForSegment(poi);
  });

  // Edit Existing POI Name (Feature 1)
  window.promptEditPOI = (poiId) => {
    const poi = window.smartTracker.pois.find(p => p.id === poiId) || 
                (window.mapManager.poiLayerGroup ? Array.from(window.mapManager.poiLayerGroup.getLayers()).map(l => l.poiData).find(p => p && p.id === poiId) : null);
    if (!poi) return;
    editPoiId.value = poiId;
    editPoiNameInput.value = poi.name || '';
    modalEditPoi.classList.add('active');
  };

  function closeEditPoiModal() {
    modalEditPoi.classList.remove('active');
  }

  btnCloseEditPoi.addEventListener('click', closeEditPoiModal);
  btnCancelEditPoi.addEventListener('click', closeEditPoiModal);

  btnSaveEditPoi.addEventListener('click', async () => {
    const newName = editPoiNameInput.value.trim();
    const poiId = Number(editPoiId.value);
    if (!newName) return;

    closeEditPoiModal();
    
    // Update in local tracker
    const targetPOI = window.smartTracker.pois.find(p => p.id === poiId);
    if (targetPOI) targetPOI.name = newName;

    // Update in Neon DB
    await window.neonDB.updatePOI(poiId, newName);

    // Refresh map markers
    if (currentProject) {
      const fullData = await window.neonDB.getProjectDetails(currentProject.id);
      window.mapManager.restoreProjectTrail(
        fullData,
        (photo) => openPhotoDetail(photo),
        (poi) => selectPOIForSegment(poi)
      );
    }

    showToast(`📍 지점 명칭이 '${newName}'(으)로 수정되었습니다.`);
  });

  function selectPOIForSegment(poi) {
    window.smartTracker.selectPOI(poi);
    segmentStatsPanel.classList.remove('hidden');
    showToast(`📍 '${poi.name}' 기준 구간 통계가 활성화되었습니다.`);
  }

  window.selectPOIFromMap = (poiId) => {
    const poi = window.smartTracker.pois.find(p => p.id === poiId) || 
                (window.mapManager.poiLayerGroup ? Array.from(window.mapManager.poiLayerGroup.getLayers()).map(l => l.poiData).find(p => p && p.id === poiId) : null);
    if (poi) selectPOIForSegment(poi);
  };

  btnCloseSegment.addEventListener('click', () => {
    window.smartTracker.selectedPOI = null;
    segmentStatsPanel.classList.add('hidden');
  });

  // --- 7. Photo Capture & Caption Feature (Add & Edit) ---
  btnActionPhoto.addEventListener('click', () => {
    if (!currentProject) {
      showToast('⚠️ 먼저 프로젝트를 시작하거나 선택해주세요.');
      return;
    }
    photoInput.click();
  });

  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      compressImage(event.target.result, 1280, 0.82, (compressedBase64) => {
        tempPhotoBase64 = compressedBase64;
        previewCapturedPhoto.src = compressedBase64;
        
        const stats = window.smartTracker.getCurrentStats();
        const curPos = stats.currentPosition || { latitude: 0, longitude: 0 };
        captionMetaCoords.textContent = `${curPos.latitude.toFixed(5)}, ${curPos.longitude.toFixed(5)}`;
        captionMetaSteps.textContent = stats.totalSteps.toLocaleString();
        captionMetaDistance.textContent = stats.totalDistance.toLocaleString();

        inputPhotoCaption.value = '';
        modalPhotoCaption.classList.add('active');
      });
    };
    reader.readAsDataURL(file);
    photoInput.value = '';
  });

  function compressImage(base64Str, maxWidth, quality, callback) {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
  }

  function closeCaptionModal() {
    modalPhotoCaption.classList.remove('active');
    tempPhotoBase64 = null;
  }

  btnCloseCaptionModal.addEventListener('click', closeCaptionModal);
  btnCancelPhoto.addEventListener('click', closeCaptionModal);

  btnSavePhoto.addEventListener('click', async () => {
    if (!tempPhotoBase64) return;
    const caption = inputPhotoCaption.value.trim();

    const photo = window.smartTracker.addPhotoRecord({
      photoBase64: tempPhotoBase64,
      caption: caption
    });

    closeCaptionModal();
    window.mapManager.addPhotoMarker(photo, (p) => openPhotoDetail(p));

    // Save to Neon DB
    await window.neonDB.insertPhoto(currentProject.id, {
      latitude: photo.latitude,
      longitude: photo.longitude,
      altitude: photo.altitude,
      photoBase64: photo.photoBase64,
      caption: photo.caption,
      stepCount: photo.stepCount,
      distanceAtPhoto: photo.distanceAtPhoto
    });

    showToast('📸 사진과 캡션이 등록되었습니다.');
  });

  // Photo Detail Lightbox with Edit Caption Support (Feature 2)
  let activePhotoForEdit = null;

  function openPhotoDetail(photo) {
    activePhotoForEdit = photo;
    detailPhotoId.value = photo.id;
    detailPhotoImg.src = photo.photoBase64 || photo.photo_base64;
    detailPhotoCaptionInput.value = photo.caption || '';
    detailPhotoTime.textContent = new Date(photo.createdAt || photo.created_at).toLocaleString();
    detailPhotoSteps.textContent = `${Number(photo.stepCount || photo.step_count || 0).toLocaleString()} 보`;
    detailPhotoDistance.textContent = `${Number(photo.distanceAtPhoto || photo.distance_at_photo || 0).toLocaleString()} m`;
    detailPhotoCoords.textContent = `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`;
    modalPhotoDetail.classList.add('active');
  }

  btnSavePhotoCaption.addEventListener('click', async () => {
    if (!activePhotoForEdit) return;
    const newCaption = detailPhotoCaptionInput.value.trim();
    const photoId = activePhotoForEdit.id;

    // Update in local object
    activePhotoForEdit.caption = newCaption;

    // Save to Neon DB
    await window.neonDB.updatePhotoCaption(photoId, newCaption);
    showToast('💾 사진 캡션이 수정 저장되었습니다.');

    // Refresh map markers
    if (currentProject) {
      const fullData = await window.neonDB.getProjectDetails(currentProject.id);
      window.mapManager.restoreProjectTrail(
        fullData,
        (photo) => openPhotoDetail(photo),
        (poi) => selectPOIForSegment(poi)
      );
    }
  });

  btnClosePhotoDetail.addEventListener('click', () => {
    modalPhotoDetail.classList.remove('active');
    activePhotoForEdit = null;
  });

  // --- 8. Pause / Resume ---
  btnActionPause.addEventListener('click', () => {
    if (!currentProject) return;

    if (window.smartTracker.isPaused) {
      window.smartTracker.resumeTracking();
      pauseText.textContent = '일시정지';
      pauseIcon.setAttribute('data-lucide', 'pause');
      wakelockBadge.classList.remove('hidden');
      showToast('▶️ 트래킹 재개됨');
    } else {
      window.smartTracker.pauseTracking();
      pauseText.textContent = '재개';
      pauseIcon.setAttribute('data-lucide', 'play');
      wakelockBadge.classList.add('hidden');
      showToast('⏸️ 트래킹 일시정지');
    }
    if (window.lucide) window.lucide.createIcons();
  });

  // --- 9. Finish & Export Standalone HTML (with Address, Weather & Stats) ---
  btnActionFinish.addEventListener('click', () => {
    if (!currentProject) {
      showToast('⚠️ 활성화된 프로젝트가 없습니다.');
      return;
    }

    const stats = window.smartTracker.getCurrentStats();
    finishSummaryTitle.textContent = currentProject.name;
    finishSummaryDist.textContent = `${stats.totalDistanceKm} km (${stats.totalDistance.toLocaleString()} m)`;
    finishSummarySteps.textContent = `${stats.totalSteps.toLocaleString()} 보 (평균속도 ${stats.avgSpeed} km/h)`;
    finishSummaryDuration.textContent = stats.durationFormatted;

    modalFinishConfirm.classList.add('active');
  });

  btnCancelFinish.addEventListener('click', () => {
    modalFinishConfirm.classList.remove('active');
  });

  btnConfirmFinishExport.addEventListener('click', async () => {
    modalFinishConfirm.classList.remove('active');
    showToast('📦 데이터 집계, 지역 주소 및 날씨 조회 중...');

    const finalStats = window.smartTracker.stopTracking();
    if (syncInterval) clearInterval(syncInterval);

    // Mark completed in Neon DB
    await window.neonDB.completeProject(currentProject.id, finalStats);

    // Fetch full fresh project bundle for export
    const fullProjectData = await window.neonDB.getProjectDetails(currentProject.id);

    // Trigger Single-File HTML Download with automatic Geocoding & Weather
    await window.projectExporter.downloadHTML(fullProjectData);
    showToast('🎉 트래킹 완료! 주소와 날씨가 포함된 HTML 파일이 다운로드되었습니다.');

    updateUIControls();
  });

  function updateUIControls() {
    if (window.lucide) window.lucide.createIcons();
  }

  // Check login state on startup
  checkExistingAuth();
});
