// 3D viewer wiring for EduAR Net
const models = [
  { id: 'pc', label: 'PC', src: 'assets/models/pc.glb' },
  { id: 'hp', label: 'Laptop', src: 'assets/models/hp.glb' },
  { id: 'router', label: 'Router', src: 'assets/models/router.glb' },
  { id: 'wifi', label: 'Access Point', src: 'assets/models/wifi.glb' }
];

const viewer = document.getElementById('modelViewer');
const select = document.getElementById('model-select');
const rotateToggle = document.getElementById('rotate-toggle');
const fsBtn = document.getElementById('fullscreen');
// cameraToggle removed from UI (camera starts automatically)
const cameraToggle = document.getElementById('camera-toggle');
const cameraOverlay = document.getElementById('camera-overlay');
const cameraVideo = document.getElementById('cameraVideo');
let cameraStream = null;
let originalParent = null;
let originalNextSibling = null;
let originalHasControls = false;
// in-camera transform state
let panX = 0; // px
let panY = 0; // px
let scale = 1;
let dragging = false;
let dragStart = null;
let initialPinch = null;
let currentModelSrc = null;

function saveTransformForModel(src) {
  if (!src) return;
  try {
    const key = `eduar:transform:${src}`;
    const data = { panX, panY, scale };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) { /* ignore storage errors */ }
}

function loadTransformForModel(src) {
  if (!src) return null;
  try {
    const key = `eduar:transform:${src}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj.panX === 'number') panX = obj.panX;
    if (typeof obj.panY === 'number') panY = obj.panY;
    if (typeof obj.scale === 'number') scale = obj.scale;
    return obj;
  } catch (e) { return null; }
}

function setModel(src) {
  if (!viewer) return;
  // show spinner
  const spinner = document.getElementById('model-spinner');
  spinner && spinner.classList.remove('hidden');
  // save transform for previous model
  if (typeof currentModelSrc !== 'undefined' && currentModelSrc) saveTransformForModel(currentModelSrc);
  viewer.src = src;
  currentModelSrc = src;
  // enable auto-rotate by default when selecting a model
  viewer.setAttribute('auto-rotate', '');
}

// Initialize default model
if (select && viewer) {
  // populate select from models array (authoritative source: assets/models)
  select.innerHTML = models.map(m => `<option value="${m.src}">${m.label}</option>`).join('');
  // set default
  const first = select.value || models[0].src;
  setModel(first);

  select.addEventListener('change', (e) => {
    setModel(e.target.value);
    // after selecting a model, try to load saved transform so it appears where user left it
    loadTransformForModel(e.target.value);
    applyInCameraTransform();
  });
}

if (rotateToggle && viewer) {
  rotateToggle.addEventListener('click', () => {
    const current = viewer.hasAttribute('auto-rotate');
    if (current) viewer.removeAttribute('auto-rotate');
    else viewer.setAttribute('auto-rotate', '');
  });
}

if (fsBtn && viewer) {
  fsBtn.addEventListener('click', async () => {
    try {
      if (viewer.requestFullscreen) await viewer.requestFullscreen();
    } catch (err) {
      console.warn('Fullscreen not supported', err);
    }
  });
}

// Camera (scan) functions
async function startCamera() {
  if (!navigator.mediaDevices || !cameraVideo) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    cameraVideo.srcObject = cameraStream;
    cameraOverlay?.classList.remove('hidden');
    // move model-viewer into camera container so it appears inside the camera view
    if (viewer && cameraOverlay) {
      const cameraContainer = document.getElementById('camera-container');
      if (cameraContainer) {
        // save original position
        originalParent = viewer.parentElement;
        originalNextSibling = viewer.nextElementSibling;
        // remember if viewer had camera-controls so we can restore later
        originalHasControls = viewer.hasAttribute('camera-controls');
        cameraContainer.appendChild(viewer);
        viewer.classList.add('in-camera');
        // ensure it rotates
        viewer.setAttribute('auto-rotate', '');
        // when in camera overlay, disable interactive camera-controls for AR-like overlay
        if (viewer.hasAttribute('camera-controls')) viewer.removeAttribute('camera-controls');
        // initialize transform state from saved data if available
        loadTransformForModel(currentModelSrc || viewer.src);
        // apply baseline transform but animate entrance
        applyInCameraTransform();
        attachInteractionHandlers();
        // play entrance animation for AR overlay
        doEntranceAnimation();
      }
    }
  } catch (err) {
    console.warn('Camera access denied or not available', err);
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  cameraVideo && (cameraVideo.srcObject = null);
  cameraOverlay?.classList.add('hidden');
  // restore model-viewer to its original container
  if (viewer && originalParent) {
    // save current transform for this model before leaving camera
    saveTransformForModel(currentModelSrc || viewer.src);
    viewer.classList.remove('in-camera');
    if (originalNextSibling && originalNextSibling.parentElement === originalParent) {
      originalParent.insertBefore(viewer, originalNextSibling);
    } else {
      originalParent.appendChild(viewer);
    }
    originalParent = null;
    originalNextSibling = null;
    // keep auto-rotate on (optional)
    viewer.setAttribute('auto-rotate', '');
    // restore camera-controls if it originally had them
    if (originalHasControls) viewer.setAttribute('camera-controls', '');
    originalHasControls = false;
    detachInteractionHandlers();
  }
}

if (cameraToggle) {
  cameraToggle.addEventListener('click', () => {
    if (cameraOverlay && cameraOverlay.classList.contains('hidden')) startCamera();
    else stopCamera();
  });
}

// Keyboard navigation: left/right to switch models
window.addEventListener('keydown', (ev) => {
  if (!select) return;
  if (ev.key === 'ArrowRight') {
    select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
    select.dispatchEvent(new Event('change'));
  } else if (ev.key === 'ArrowLeft') {
    select.selectedIndex = (select.selectedIndex - 1 + select.options.length) % select.options.length;
    select.dispatchEvent(new Event('change'));
  }
});

// Pause auto-rotate when tab is hidden
document.addEventListener('visibilitychange', () => {
  if (!viewer) return;
  if (document.hidden) viewer.removeAttribute('auto-rotate');
  else viewer.setAttribute('auto-rotate', '');
});

// Small accessibility: announce loaded model
viewer?.addEventListener('load', () => {
  const label = select?.selectedOptions?.[0]?.text || 'model';
  viewer.setAttribute('alt', `3D model: ${label}`);
  // hide spinner when model ready
  const spinner = document.getElementById('model-spinner');
  spinner && spinner.classList.add('hidden');
  // center and animate entrance when a model finishes loading in-camera
  if (viewer.classList.contains('in-camera')) {
    // if we have stored transform for this model, load it (overrides center)
    loadTransformForModel(currentModelSrc || viewer.src);
    // small delay to ensure DOM updates
    setTimeout(() => doEntranceAnimation(), 60);
  }
});

// handle load errors gracefully
viewer?.addEventListener('error', (ev) => {
  console.error('Model viewer error:', ev);
  const spinner = document.getElementById('model-spinner');
  spinner && spinner.classList.add('hidden');
  // simple user feedback
  try {
    alert('Gagal memuat model 3D. Periksa file .glb di folder assets/models/ atau buka console untuk detil.');
  } catch (e) {
    // ignore if alert not available
  }
});

// Apply current pan/scale transform to viewer when in camera
function applyInCameraTransform() {
  if (!viewer) return;
  // base offset translate(-50%,-50%) then apply pan and scale
  viewer.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${scale})`;
}

// Interaction handlers: drag to pan, wheel to zoom, pinch to zoom
function attachInteractionHandlers() {
  if (!viewer) return;
  viewer.style.touchAction = 'none';

  const onPointerDown = (e) => {
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, panX, panY };
    viewer.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    panX = dragStart.panX + dx;
    panY = dragStart.panY + dy;
    applyInCameraTransform();
  };

  const onPointerUp = (e) => {
    dragging = false;
    dragStart = null;
  };

  const onWheel = (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    scale = Math.min(3, Math.max(0.3, scale + delta));
    applyInCameraTransform();
  };

  // touch pinch handlers
  let ongoingTouches = [];
  const getDistance = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const onTouchStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      initialPinch = { dist: getDistance(e.touches[0], e.touches[1]), scale };
    }
  };
  const onTouchMove = (e) => {
    if (e.touches && e.touches.length === 2 && initialPinch) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      const factor = dist / initialPinch.dist;
      scale = Math.min(3, Math.max(0.3, initialPinch.scale * factor));
      applyInCameraTransform();
    }
  };
  const onTouchEnd = (e) => { initialPinch = null; };

  viewer._ar_handlers = { onPointerDown, onPointerMove, onPointerUp, onWheel, onTouchStart, onTouchMove, onTouchEnd };

  viewer.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  viewer.addEventListener('wheel', onWheel, { passive: false });
  viewer.addEventListener('touchstart', onTouchStart, { passive: true });
  viewer.addEventListener('touchmove', onTouchMove, { passive: true });
  viewer.addEventListener('touchend', onTouchEnd, { passive: true });
}

function detachInteractionHandlers() {
  if (!viewer || !viewer._ar_handlers) return;
  const h = viewer._ar_handlers;
  viewer.removeEventListener('pointerdown', h.onPointerDown);
  window.removeEventListener('pointermove', h.onPointerMove);
  window.removeEventListener('pointerup', h.onPointerUp);
  viewer.removeEventListener('wheel', h.onWheel);
  viewer.removeEventListener('touchstart', h.onTouchStart);
  viewer.removeEventListener('touchmove', h.onTouchMove);
  viewer.removeEventListener('touchend', h.onTouchEnd);
  viewer._ar_handlers = null;
  viewer.style.touchAction = '';
}

// Entrance animation: animate from slightly above and scaled down to centered full size
function doEntranceAnimation() {
  if (!viewer || !viewer.classList.contains('in-camera')) return;
  // prepare: stop any existing transition
  viewer.style.transition = 'none';
  // start state: slightly higher and smaller and transparent
  viewer.style.opacity = '0';
  viewer.style.transform = `translate(-50%,-60%) scale(${0.8})`;
  // force reflow
  // eslint-disable-next-line no-unused-expressions
  viewer.getBoundingClientRect();
  // animate to centered state
  viewer.style.transition = 'transform 380ms cubic-bezier(.2,.9,.3,1), opacity 320ms ease';
  // set pan/scale target
  applyInCameraTransform();
  viewer.style.opacity = '1';
  // cleanup after transition
  const onEnd = () => {
    viewer.removeEventListener('transitionend', onEnd);
    // small overshoot: scale slightly larger then settle back
    const tx = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px))`;
    const overshoot = Math.min(1.12, (scale || 1) * 1.06);
    viewer.style.transition = 'transform 160ms ease';
    viewer.style.transform = `${tx} scale(${overshoot})`;
    setTimeout(() => {
      viewer.style.transition = 'transform 140ms ease';
      viewer.style.transform = `${tx} scale(${scale})`;
      setTimeout(() => { viewer.style.transition = ''; }, 170);
    }, 160);
  };
  viewer.addEventListener('transitionend', onEnd);
}

// start camera automatically on load
window.addEventListener('DOMContentLoaded', () => {
  // small delay to allow permission prompt timing
  setTimeout(() => {
    startCamera();
  }, 300);
});

// save transform on unload
window.addEventListener('beforeunload', () => {
  try { saveTransformForModel(currentModelSrc || viewer?.src); } catch (e) { }
});
