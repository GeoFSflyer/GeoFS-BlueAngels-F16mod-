// ==UserScript==
// @name         GeoFS Flight Recorder
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      1.1.5
// @description  Record and replay GeoFS flights with lightweight gear state playback.
// @match        https://www.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- Utils ---------- */
  const now = () => performance.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, f) => a + (b - a) * f;
  const smoothstep = (f) => f * f * (3 - 2 * f);
  const lerpAngleDeg = (a, b, f) => {
    const d = ((b - a + 540) % 360) - 180;
    return a + d * f;
  };
  const angleDeltaDeg = (a, b) => ((b - a + 540) % 360) - 180;
  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const finiteOr = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const sanitizeCallsign = (value) => {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
  };
  const isWheelLikeName = (name) => {
    const s = String(name || '').toLowerCase();
    return s.includes('wheel') || s.includes('bogie') || s.includes('truck') || s.includes('tire') || s.includes('tyre');
  };

  function metersPerDeg(latDeg) {
    return {
      mLat: 111132,
      mLon: 111320 * Math.cos(latDeg * Math.PI / 180)
    };
  }

  function interpLLA(a, b, f, out) {
    out[0] = lerp(a[0], b[0], f);
    const dLon = ((b[1] - a[1] + 540) % 360) - 180;
    out[1] = a[1] + dLon * f;
    out[2] = lerp(a[2], b[2], f);
    return out;
  }

  /* ---------- Config ---------- */
  const VERSION = '1.1.5';
  const LS_KEY = 'FlightRecorder100';
  const LS_CALLSIGN_KEY = 'FlightRecorder100Callsign';
  const MAX_DT_CAP = 120;
  const MAX_STEPS = 10;
  const MAX_RECORD_STEPS_PER_FRAME = 800;
  const EPS = 1e-6;
  const BLOCK_SIZE = 3000;
  const WARMUP_MS = 2500;
  const WARMUP_STEP_MS = 100;
  const DISCOVERY_STEP_MS = 250;
  const FULL_SCAN_ON_ANIM_CHANGE_MS = 2500;
  const TOKENS = [
    'gear', 'door', 'flap', 'slat', 'aileron', 'elevator', 'rudder',
    'brake', 'airbrake', 'canopy', 'hook', 'piston', 'leg', 'suspension',
    'wheel', 'bogie', 'truck', 'hatch', 'bay', 'oleo', 'shock', 'ladder', 'ladderdoor'
  ];
  const STRICT_GEAR_NODE_HINTS = [
    'leftgear', 'rightgear', 'frontgear', 'nosegear', 'maingear',
    'geardoor', 'gear_door',
    'leftgeardoor', 'rightgeardoor', 'frontgeardoor', 'nosegeardoor',
    'gearactuator', 'actuator',
    'gearstrut', 'strut', 'oleo'
  ];
  const LIVERY_ID_OFFSET = 10000;

  let defaultSampleMs = 16; // 60 Hz
  let easingOn = false;
  let ultraStrength = 35; // 0..100
  let recordCallsign = '';
  let showCallsign = true;
  let playbackSliderDragging = false;
  let lastSliderSeekTs = 0;

  /* ---------- State machines ---------- */
  let recordState = 'IDLE'; // IDLE | RECORDING
  let playState = 'IDLE';   // IDLE | PLAYING

  /* ---------- Runtime ---------- */
  let tracks = [];
  let currentRec = null; // draft, hidden from list until stop
  let lastMainT = now();
  let nextTrackNumber = 1;

  let guiWin = null;
  const gui = {};
  const FR_PANEL_ID = 'flight-recorder-panel';
  const FR_BUTTON_ID = 'flight-recorder-button';

  /* ---------- Track helpers ---------- */
  function makeTrackBase(ac, sampleMs, callsign = '') {
    const orderId = nextTrackNumber++;
    const id = `T${String(orderId).padStart(4, '0')}`;
    const createdAt = Date.now();
    const lat0 = ac.llaLocation[0];
    const lon0 = ac.llaLocation[1];
    const m = metersPerDeg(lat0);
    const modelUrl = ac?.object3d?.model?._model?._resource?.url;
    return {
      orderId,
      id,
      name: `${ac.aircraftRecord?.name || 'Unknown'} ${id}`,
      callsign: sanitizeCallsign(callsign),
      description: '',
      createdAt,
      aircraftId: String(ac?.id ?? ac?.aircraftRecord?.id ?? ''),
      modelUrl,
      sampleMs,
      base: { lat0, lon0, mLat: m.mLat, mLon: m.mLon },
      lla: [],
      htr: [],
      xy: [],
      gearEvents: [],
      liveryEvents: []
    };
  }

  function initTrackRuntime(tr) {
    tr._ghost = null;
    tr._ghostLabel = null;
    tr._nodeNames = Array.isArray(tr._nodeNames) ? tr._nodeNames : [];
    tr._nodeNameSet = new Set(tr._nodeNames);
    tr._nodeCache = { ready: false, all: [], gear: [], wheels: [], doors: [], ladder: [] };
    tr._precision = null;
    tr._pool = {
      lla: [0, 0, 0],
      htr: [0, 0, 0],
      tmpA: [0, 0, 0],
      tmpB: [0, 0, 0],
      tmpC: [0, 0, 0]
    };
    tr._play = {
      playing: false,
      paused: true,
      idx: 0,
      startT: now(),
      lastT: now()
    };
    tr._lastGearUp = null;
    tr._rec = {
      recording: false,
      sampleCount: tr.lla.length,
      targetSamples: tr.lla.length,
      startT: 0,
      lastGearUp: null,
      lastLiverySig: null
    };
    tr._livery = {
      applying: false,
      lastSig: null,
      appliedSig: null,
      resetSig: null,
      applyRunId: 0,
      activeApplyRunId: 0,
      startApplyTimer: null,
      pendingId: null,
      pendingSnapshot: null,
      pendingSig: null,
      vaCache: Object.create(null),
      debug: {
        seq: 0,
        lastLine: '',
        lastApplyLine: '',
        lastTextureLine: '',
        lastRequestLine: '',
        history: []
      }
    };
  }

  function toDebugSafe(v) {
    return String(v == null ? '' : v).replace(/[|\n\r]/g, '_');
  }

  function buildProject() {
    return {
      version: VERSION,
      tracks: tracks.map((t) => ({
        orderId: t.orderId,
        id: t.id,
        name: t.name,
        callsign: sanitizeCallsign(t.callsign || ''),
        description: t.description || '',
        createdAt: t.createdAt,
        aircraftId: t.aircraftId,
        modelUrl: t.modelUrl,
        sampleMs: t.sampleMs,
        base: t.base,
        lla: t.lla,
        htr: t.htr,
        xy: t.xy,
        gearEvents: t.gearEvents || [],
        liveryEvents: t.liveryEvents || []
      }))
    };
  }

  function updatePlayState() {
    playState = tracks.some((t) => t._play?.playing) ? 'PLAYING' : 'IDLE';
  }

  function formatTrackDate(ts) {
    const d = new Date(Number(ts) || Date.now());
    try {
      return d.toLocaleString();
    } catch {
      return d.toISOString();
    }
  }

  function normalizeTrackMeta(tr, fallbackOrder) {
    const parsed = Number.parseInt(String(tr?.orderId ?? tr?.id ?? ''), 10);
    const orderId = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackOrder;
    tr.orderId = orderId;
    tr.id = String(tr.id || `T${String(orderId).padStart(4, '0')}`);
    tr.callsign = sanitizeCallsign(tr.callsign || '');
    tr.createdAt = Number(tr.createdAt) || Date.now();
    tr.aircraftId = String(tr.aircraftId || '');
    return tr;
  }

  function refreshNextTrackNumber() {
    let maxId = 0;
    for (const t of tracks) {
      const n = Number.parseInt(String(t?.orderId ?? 0), 10);
      if (Number.isFinite(n) && n > maxId) maxId = n;
    }
    nextTrackNumber = maxId + 1;
  }

  /* ---------- Node/matrix helpers ---------- */
  function getNode(model, name) {
    if (!model || !name) return null;
    const wanted = String(name);
    const wantedLow = wanted.toLowerCase();
    try {
      const a = model.getNode(wanted);
      if (a) return a;
      const b = model.getNode(wantedLow);
      if (b) return b;
      const c = model.getNode(wanted.toUpperCase());
      if (c) return c;
    } catch {
      // continue to runtime scan
    }

    try {
      const arr = model._runtime?.nodes || model._nodes;
      if (Array.isArray(arr)) {
        for (const n of arr) {
          const nn = String(n?.name || n?._name || n?.id || '');
          if (!nn) continue;
          if (nn === wanted || nn.toLowerCase() === wantedLow) return n;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  function isLadderName(name) {
    const low = String(name || '').toLowerCase();
    return low.includes('ladder');
  }

  function shouldTrackToken(name) {
    const low = String(name || '').toLowerCase();
    return TOKENS.some((t) => low.includes(t));
  }

  function readAnimState(ac) {
    const av = ac?.animationValues || geofs?.animation?.values || {};
    const pick = (...keys) => {
      for (const k of keys) {
        if (av && av[k] != null && Number.isFinite(Number(av[k]))) return Number(av[k]);
      }
      return null;
    };
    return {
      gear: pick('gear', 'landingGear', 'gearPosition', 'landing_gear'),
      flaps: pick('flaps', 'flapsValue', 'flapsPosition', 'flaps_value'),
      spoilers: pick('spoilers', 'spoiler', 'spoilersPosition'),
      airbrake: pick('airbrake', 'airBrake', 'airbrakes')
    };
  }

  function detectNodeNames(ac) {
    const parts = ac?.definition?.parts || [];
    const allNames = [];
    for (const p of parts) {
      if (p?.name) allNames.push(String(p.name));
      if (p?.node && p.node !== p.name) allNames.push(String(p.node));
    }

    const tokenNames = [];
    const warmNames = [];
    const seen = new Set();

    for (const name of allNames) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (isLadderName(name)) continue;
      if (shouldTrackToken(name)) tokenNames.push(name);
      else warmNames.push(name);
    }

    return { tokenNames, warmNames };
  }

  function collectModelNodeNames(model) {
    const out = new Set();
    if (!model) return [];

    const tryAdd = (name) => {
      if (!name) return;
      out.add(String(name));
    };

    try {
      const byName = model._nodesByName || model._runtime?.nodesByName;
      if (byName && typeof byName === 'object') {
        for (const k of Object.keys(byName)) tryAdd(k);
      }
    } catch { }

    try {
      const arr = model._runtime?.nodes || model._nodes;
      if (Array.isArray(arr)) {
        for (const n of arr) {
          tryAdd(n?.name);
          tryAdd(n?._name);
          tryAdd(n?.id);
        }
      }
    } catch { }

    return [...out];
  }

  function buildNodeCache(track) {
    if (!track?._ghost?._model?.ready) return false;
    if (track._nodeCache?.ready) return true;

    const model = track._ghost._model;
    const parts = geofs?.aircraft?.instance?.definition?.parts || [];
    const all = [];
    const gear = [];
    const wheels = [];
    const doors = [];
    const ladder = [];
    const seen = new Set();

    const pushNode = (node, nameHint = '') => {
      if (!node) return;
      const key = String(node?.name || node?._name || node?.id || nameHint || '').toLowerCase();
      if (key && seen.has(key)) return;
      if (key) seen.add(key);

      all.push(node);

      const low = String(nameHint || node?.name || node?._name || node?.id || '').toLowerCase();
      if (low.includes('ladder') || low.includes('stairs') || low.includes('boarding')) ladder.push(node);
      if (low.includes('door') || low.includes('hatch') || low.includes('bay')) doors.push(node);
      if (low.includes('wheel') || low.includes('bogie') || low.includes('truck') || low.includes('tire') || low.includes('tyre')) wheels.push(node);
      if (low.includes('gear') || low.includes('strut') || low.includes('oleo') || low.includes('shock')) gear.push(node);
    };

    for (const p of parts) {
      const nm = String(p?.name || p?.node || '');
      if (!nm) continue;
      const node = getNode(model, nm);
      pushNode(node, nm);
    }

    const runtimeNames = collectModelNodeNames(model);
    for (const nm of runtimeNames) {
      if (!nm) continue;
      const node = getNode(model, nm);
      pushNode(node, nm);
    }

    track._nodeCache = { ready: true, all, gear, wheels, doors, ladder };

    return true;
  }

  function setCategoryVisible(track, cat, visible) {
    if (!buildNodeCache(track)) return;
    const arr = track._nodeCache?.[cat] || [];
    for (const n of arr) {
      try { n.show = !!visible; } catch { }
    }
  }

  function hideLadderNodes(track) {
    if (!track?._ghost?._model?.ready) return;
    setCategoryVisible(track, 'ladder', false);
  }

  function applyGearState(track, isUp) {
    if (!buildNodeCache(track)) return;
    if (isUp) {
      setCategoryVisible(track, 'doors', false);
      setCategoryVisible(track, 'wheels', false);
      setCategoryVisible(track, 'gear', false);
    } else {
      setCategoryVisible(track, 'doors', true);
      setCategoryVisible(track, 'gear', true);
      setCategoryVisible(track, 'wheels', true);
    }
    // Keep this last so ladder never reappears after any gear visibility changes.
    hideLadderNodes(track);
  }

  function readGearUp(ac) {
    const av = ac?.animationValues || geofs?.animation?.values;
    if (!av) return false;
    const raw = (
      av.gear ??
      av.landingGear ??
      av.gearPosition ??
      av.landing_gear
    );
    const g = Number(raw);
    return Number.isFinite(g) ? g > 0.5 : false;
  }

  function gearUpAtIndex(track, idx) {
    const ev = track?.gearEvents || [];
    let up = false;
    for (let i = 0; i < ev.length; i++) {
      if ((ev[i]?.t ?? -1) > idx) break;
      up = !!ev[i]?.up;
    }
    return up;
  }

  function cloneLiveryId(value) {
    if (value == null) return null;
    if (typeof value === 'object') {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return null;
      }
    }
    return value;
  }

  function liverySig(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
      const url = String(value.url || '').trim();
      const idx = Number(value.idx);
      return `va:${url}|${Number.isFinite(idx) ? idx : -1}`;
    }
    const n = Number(value);
    return Number.isFinite(n) ? `id:${n}` : '';
  }

  function readCurrentLiveryId(ac) {
    return cloneLiveryId(ac?.liveryId ?? null);
  }

  function readTextureUrl(tex) {
    const candidates = [
      tex?._source?._url,
      tex?._url,
      tex?.url,
      tex?._image?._url,
      tex?._image?.src,
      tex?.source?.url
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return '';
  }

  function readCurrentLiverySnapshot(ac) {
    const textures = ac?.object3d?.model?._model?._rendererResources?.textures;
    if (!Array.isArray(textures) || !textures.length) return null;
    const out = [];
    for (let i = 0; i < textures.length; i++) {
      const url = readTextureUrl(textures[i]);
      if (!url) continue;
      out.push({ index: i, url });
    }
    return out.length ? { textures: out } : null;
  }

  function liveryAtIndex(track, idx) {
    const ev = track?.liveryEvents || [];
    let current = null;
    for (let i = 0; i < ev.length; i++) {
      if ((ev[i]?.t ?? -1) > idx) break;
      current = cloneLiveryId(ev[i]?.id ?? null);
    }
    return current;
  }

  function liverySnapshotAtIndex(track, idx) {
    const ev = track?.liveryEvents || [];
    let current = null;
    for (let i = 0; i < ev.length; i++) {
      if ((ev[i]?.t ?? -1) > idx) break;
      const snap = ev[i]?.snapshot;
      current = snap ? JSON.parse(JSON.stringify(snap)) : null;
    }
    return current;
  }

  function getLiverySelectorAircraftEntry(track) {
    const ls = window.LiverySelector;
    const acId = String(track?.aircraftId || '');
    return ls?.liveryobj?.aircrafts?.[acId] || null;
  }

  function makeUniqueGhostModelUrl(track) {
    const base = String(track?.modelUrl || '');
    if (!base) return base;
    const sep = base.includes('?') ? '&' : '?';
    const token = encodeURIComponent(`${track?.id || 'ghost'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    return `${base}${sep}frghost=${token}`;
  }

  async function getVALivery(track, liveryRef) {
    const url = String(liveryRef?.url || '').trim();
    const idx = Number(liveryRef?.idx);
    if (!url || !Number.isFinite(idx) || idx < 0) return null;

    const cache = track?._livery?.vaCache || Object.create(null);
    if (!cache[url]) {
      cache[url] = fetch(url).then((r) => r.json()).catch(() => null);
      if (track?._livery) track._livery.vaCache = cache;
    }
    const airline = await cache[url];
    const acId = String(track?.aircraftId || '');
    const ac = airline?.aircrafts?.[acId];
    const livery = ac?.liveries?.[idx];
    if (!livery) return null;
    return { livery, source: airline };
  }

  function changeGhostModelTexture(track, textureUrl, index, applyRunId = 0) {
    const ghost = track?._ghost;
    const model = ghost?._model;
    if (!ghost || !model || !textureUrl || !Number.isFinite(Number(index))) return;

    const rendererTex = model?._rendererResources?.textures?.[index];
    const width = Number(rendererTex?._width) || 0;
    const height = Number(rendererTex?._height) || 0;

    // Use per-instance texture path (same strategy as LiverySelector multiplayer)
    // so we don't mutate shared model textures used by the player's own aircraft.
    const applyTextureData = (dataUrl) => {
      if (applyRunId && Number(track?._livery?.activeApplyRunId || 0) !== Number(applyRunId)) {
        return false;
      }

      let didApply = false;
      let used = '';
      const failed = [];
      const hasGhostChange = typeof ghost?.changeTexture === 'function';
      const hasModelChange = typeof model?.changeTexture === 'function';
      const protoChange = geofs?.api?.Model?.prototype?.changeTexture;
      const hasProtoChange = typeof protoChange === 'function';
      const hasApiChange = typeof geofs?.api?.changeModelTexture === 'function';

      const tryApply = (label, fn) => {
        if (didApply) return;
        if (applyRunId && Number(track?._livery?.activeApplyRunId || 0) !== Number(applyRunId)) return;
        try {
          fn();
          didApply = true;
          used = label;
        } catch {
          failed.push(label);
        }
      };

      if (hasGhostChange) {
        tryApply('ghost_obj', () => ghost.changeTexture(dataUrl, { index }));
        tryApply('ghost_num', () => ghost.changeTexture(dataUrl, index));
      }
      if (hasModelChange) {
        tryApply('model_obj', () => model.changeTexture(dataUrl, { index }));
        tryApply('model_num', () => model.changeTexture(dataUrl, index));
      }
      if (hasProtoChange) {
        tryApply('proto_num', () => protoChange.call(ghost, dataUrl, index, ghost));
        tryApply('proto_obj', () => protoChange.call(ghost, dataUrl, { index }, ghost));
      }
      if (hasApiChange) {
        tryApply('api_num', () => geofs.api.changeModelTexture(model, dataUrl, index));
        tryApply('api_obj', () => geofs.api.changeModelTexture(model, dataUrl, { index }));
      }

      return didApply;
    };

    Cesium.Resource.fetchImage({ url: textureUrl })
      .then((img) => {
        if (applyRunId && Number(track?._livery?.activeApplyRunId || 0) !== Number(applyRunId)) return;
        const canvas = document.createElement('canvas');
        canvas.width = width || img.width || 1024;
        canvas.height = height || img.height || 1024;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        applyTextureData(dataUrl);
      })
      .catch(() => {
        console.warn(`Failed to load livery texture from ${textureUrl}`);
      });
  }

  function applyGhostMaterial(model, mat) {
    if (!model || !mat?.name) return;
    const key = Object.keys(mat).find((k) => k !== 'name');
    const v = mat?.[key];
    if (!key || !Array.isArray(v) || v.length < 3) return;
    try {
      model.getMaterial(mat.name).setValue(key, new Cesium.Cartesian4(v[0], v[1], v[2], 1.0));
    } catch {
      // ignore material failures
    }
  }

  async function generateMosaicTexture(baseUrl, tiles, textures) {
    try {
      if (!baseUrl || !Array.isArray(tiles) || !tiles.length || !Array.isArray(textures)) return null;
      const baseImage = await Cesium.Resource.fetchImage({ url: baseUrl });
      if (!baseImage) return null;

      const canvas = document.createElement('canvas');
      canvas.width = Number(baseImage.width) || 1024;
      canvas.height = Number(baseImage.height) || 1024;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

      for (const tile of tiles) {
        const src = textures?.[tile?.textureIndex];
        if (!src || typeof src !== 'string') continue;
        const img = await Cesium.Resource.fetchImage({ url: src });
        if (!img) continue;
        ctx.drawImage(
          img,
          Number(tile?.sx) || 0,
          Number(tile?.sy) || 0,
          Number(tile?.sw) || img.width,
          Number(tile?.sh) || img.height,
          Number(tile?.dx) || 0,
          Number(tile?.dy) || 0,
          Number(tile?.dw) || img.width,
          Number(tile?.dh) || img.height
        );
      }

      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  function applyTrackLiverySnapshot(track, snapshot, applyRunId = 0) {
    const items = Array.isArray(snapshot?.textures) ? snapshot.textures : [];
    let ops = 0;
    for (const item of items) {
      const idx = Number(item?.index);
      const url = String(item?.url || '');
      if (!Number.isFinite(idx) || !url) continue;
      changeGhostModelTexture(track, url, idx, applyRunId);
      ops++;
    }
    return ops;
  }

  async function applyTrackLivery(track, liveryId, snapshot) {
    const reqSig = liverySig(liveryId);
    const runId = track?._livery
      ? (track._livery.applyRunId = Number(track._livery.applyRunId || 0) + 1)
      : 0;
    if (track?._livery) track._livery.activeApplyRunId = runId;

    if (!track?._ghost?._model?.ready) {
      return false;
    }

    const entry = getLiverySelectorAircraftEntry(track);
    if (!entry) {
      return false;
    }

    let livery = null;
    if (typeof liveryId === 'object' && liveryId) {
      const va = await getVALivery(track, liveryId);
      livery = va?.livery || null;
    } else {
      const idNum = Number(liveryId);
      if (!Number.isFinite(idNum)) {
        return false;
      }
      const idx = idNum >= LIVERY_ID_OFFSET ? idNum - LIVERY_ID_OFFSET : idNum;
      livery = entry?.liveries?.[idx] || null;
    }
    if (!livery) {
      return false;
    }

    const indices = Array.isArray(entry.index) ? entry.index : [];
    const textures = Array.isArray(livery.texture) ? livery.texture : [];
    const mats = livery.materials || {};
    const model = track._ghost._model;

    const applyByIndex = (skipModelIndices) => {
      let ops = 0;
      const touchedModelIndices = new Set();
      for (let i = 0; i < textures.length; i++) {
        const tx = textures[i];
        if (tx && typeof tx === 'object' && tx.material != null) {
          const mat = mats?.[tx.material];
          if (mat) {
            applyGhostMaterial(model, mat);
            ops++;
          }
          continue;
        }
        if (typeof tx !== 'string' || !tx) continue;
        const modelIndex = Number(indices[i]);
        if (!Number.isFinite(modelIndex)) continue;
        if (skipModelIndices?.has(modelIndex)) continue;
        changeGhostModelTexture(track, tx, modelIndex, runId);
        ops++;
        touchedModelIndices.add(modelIndex);
      }
      return { ops, touchedModelIndices };
    };

    const indexPotential = textures.reduce((n, tx, i) => {
      if (tx && typeof tx === 'object' && tx.material != null) return n + (mats?.[tx.material] ? 1 : 0);
      if (typeof tx === 'string' && tx && Number.isFinite(Number(indices[i]))) return n + 1;
      return n;
    }, 0);

    const indexRes = applyByIndex();
    const ok = indexRes.ops > 0;
    return ok;
  }

  function requestApplyTrackLivery(track, liveryId, snapshot) {
    if (!track?._livery || track._livery.applying) return;
    const reqSig = liverySig(liveryId);
    if (reqSig && track._livery.appliedSig === reqSig) return;
    track._livery.applying = true;
    Promise.resolve(applyTrackLivery(track, liveryId, snapshot))
      .then((ok) => {
        if (!track?._livery) return;
        if (!ok) return;
        track._livery.appliedSig = reqSig || null;
        track._livery.resetSig = reqSig || null;
        if (!reqSig || track._livery.pendingSig === reqSig) {
          track._livery.pendingId = null;
          track._livery.pendingSnapshot = null;
          track._livery.pendingSig = null;
        }
      })
      .catch(() => { })
      .finally(() => {
        if (track?._livery) track._livery.applying = false;
      });
  }

  function applyTrackLiveryWhenReady(track, liv, snap, sig, attempt = 0) {
    if (!track?._play?.playing) return;
    const modelReady = !!track?._ghost?._model?.ready;
    if (modelReady) {
      requestApplyTrackLivery(track, liv, snap);
      return;
    }
    if (attempt >= 80) {
      return;
    }
    setTimeout(() => applyTrackLiveryWhenReady(track, liv, snap, sig, attempt + 1), 50);
  }

  function applyCurrentLiveryForTrack(track) {
    if (!track?._play?.playing) return false;

    const idx = clamp(Math.floor(track?._play?.idx || 0), 0, Math.max(0, (track?.lla?.length || 1) - 1));
    const liv = liveryAtIndex(track, idx);
    const snap = liverySnapshotAtIndex(track, idx);
    const sig = liverySig(liv);

    if (track._livery) {
      track._livery.appliedSig = null;
      track._livery.pendingId = liv;
      track._livery.pendingSnapshot = snap;
      track._livery.pendingSig = sig;
    }

    if (liv == null && !snap) {
      return false;
    }

    requestApplyTrackLivery(track, liv, snap);
    return true;
  }

  function resetThenApplyLiveryForTrack(track) {
    if (!track?._play?.playing) return false;

    const idx = clamp(Math.floor(track?._play?.idx || 0), 0, Math.max(0, (track?.lla?.length || 1) - 1));
    const liv = liveryAtIndex(track, idx);
    const snap = liverySnapshotAtIndex(track, idx);
    const sig = liverySig(liv);

    resetGhostForNewLivery(track);

    if (track._livery) {
      track._livery.appliedSig = null;
      track._livery.resetSig = null;
      track._livery.pendingId = liv;
      track._livery.pendingSnapshot = snap;
      track._livery.pendingSig = sig;
    }

    if (liv == null && !snap) {
      return false;
    }

    applyTrackLiveryWhenReady(track, liv, snap, sig);
    return true;
  }

  /* ---------- Recording ---------- */
  function canStartRecording() {
    return recordState === 'IDLE';
  }

  function readLivePose(ac, base) {
    const lla = [ac.llaLocation[0], ac.llaLocation[1], ac.llaLocation[2]];
    const htr = [ac.htr[0], ac.htr[1], ac.htr[2]];
    const dx = (lla[1] - base.lon0) * base.mLon;
    const dy = (lla[0] - base.lat0) * base.mLat;
    return { lla, htr, xy: [dx, dy, lla[2]] };
  }

  function interpolatePose(a, b, f) {
    if (!a) return b;
    if (!b) return a;
    return {
      lla: [
        lerp(a.lla[0], b.lla[0], f),
        a.lla[1] + angleDeltaDeg(a.lla[1], b.lla[1]) * f,
        lerp(a.lla[2], b.lla[2], f)
      ],
      htr: [
        lerpAngleDeg(a.htr[0], b.htr[0], f),
        lerpAngleDeg(a.htr[1], b.htr[1], f),
        lerpAngleDeg(a.htr[2], b.htr[2], f)
      ],
      xy: [
        lerp(a.xy[0], b.xy[0], f),
        lerp(a.xy[1], b.xy[1], f),
        lerp(a.xy[2], b.xy[2], f)
      ]
    };
  }

  function applyPrecisionVisualFilter(track, idxFloat) {
    const n = track?.lla?.length || 0;
    if (n < 2) {
      return {
        lla: track?.lla?.[0] || [0, 0, 0],
        htr: track?.htr?.[0] || [0, 0, 0]
      };
    }

    const strength01 = clamp(Number(ultraStrength) || 0, 0, 100) / 100;
    if (strength01 <= 0) {
      const i1 = clamp(Math.floor(idxFloat), 0, n - 1);
      const i2 = clamp(i1 + 1, 0, n - 1);
      const f = clamp(idxFloat - i1, 0, 1);
      const outL = track._pool.tmpA;
      interpLLA(track.lla[i1], track.lla[i2], f, outL);
      return {
        lla: [outL[0], outL[1], outL[2]],
        htr: [
          lerpAngleDeg(track.htr[i1][0], track.htr[i2][0], f),
          lerpAngleDeg(track.htr[i1][1], track.htr[i2][1], f),
          lerpAngleDeg(track.htr[i1][2], track.htr[i2][2], f)
        ]
      };
    }
    const strengthEff = strength01 * 2; // 0..2 (50% ~= old 100%)
    const key = `${n}|${Math.max(1, track.sampleMs)}|${Math.round(strengthEff * 1000)}`;

    if (!track._precision || track._precision.key !== key) {
      const halfWindowMs = lerp(80, 520, Math.min(1, strengthEff)) + Math.max(0, strengthEff - 1) * 520;
      const halfWindow = Math.max(1, Math.round(halfWindowMs / Math.max(1, track.sampleMs)));
      const sigma = Math.max(1, halfWindow * (0.65 + Math.max(0, strengthEff - 1) * 0.15));
      const blend = clamp(lerp(0.22, 0.94, Math.min(1, strengthEff)) + Math.max(0, strengthEff - 1) * 0.06, 0, 0.995);
      const jitterPosM = lerp(0.02, 0.14, Math.min(1, strengthEff)) + Math.max(0, strengthEff - 1) * 0.08;
      const jitterAngD = lerp(0.02, 0.09, Math.min(1, strengthEff)) + Math.max(0, strengthEff - 1) * 0.05;

      const smXY = new Array(n);
      const smLLA = new Array(n);
      const smHTR = new Array(n);
      const toRad = Math.PI / 180;
      const toDeg = 180 / Math.PI;

      for (let i = 0; i < n; i++) {
        const iStart = Math.max(0, i - halfWindow);
        const iEnd = Math.min(n - 1, i + halfWindow);

        let wSum = 0;
        let xSum = 0;
        let ySum = 0;
        let zSum = 0;
        let hdgCos = 0;
        let hdgSin = 0;
        let pitCos = 0;
        let pitSin = 0;
        let rolCos = 0;
        let rolSin = 0;

        for (let j = iStart; j <= iEnd; j++) {
          const d = (j - i) / sigma;
          const w = Math.exp(-0.5 * d * d);
          const xy = track.xy[j] || [0, 0, track.lla[j]?.[2] || 0];
          const htr = track.htr[j] || [0, 0, 0];

          xSum += xy[0] * w;
          ySum += xy[1] * w;
          zSum += xy[2] * w;

          const hdgR = htr[0] * toRad;
          const pitR = htr[1] * toRad;
          const rolR = htr[2] * toRad;
          hdgCos += Math.cos(hdgR) * w;
          hdgSin += Math.sin(hdgR) * w;
          pitCos += Math.cos(pitR) * w;
          pitSin += Math.sin(pitR) * w;
          rolCos += Math.cos(rolR) * w;
          rolSin += Math.sin(rolR) * w;
          wSum += w;
        }

        if (wSum <= 1e-9) {
          smXY[i] = [...(track.xy[i] || [0, 0, track.lla[i]?.[2] || 0])];
          smLLA[i] = [...(track.lla[i] || [0, 0, 0])];
          smHTR[i] = [...(track.htr[i] || [0, 0, 0])];
          continue;
        }

        const rawXY = track.xy[i] || [0, 0, track.lla[i]?.[2] || 0];
        const rawHTR = track.htr[i] || [0, 0, 0];

        const smX = xSum / wSum;
        const smY = ySum / wSum;
        const smZ = zSum / wSum;
        const smHdg = Math.atan2(hdgSin / wSum, hdgCos / wSum) * toDeg;
        const smPit = Math.atan2(pitSin / wSum, pitCos / wSum) * toDeg;
        const smRol = Math.atan2(rolSin / wSum, rolCos / wSum) * toDeg;

        let outX = lerp(rawXY[0], smX, blend);
        let outY = lerp(rawXY[1], smY, blend);
        let outZ = lerp(rawXY[2], smZ, blend);
        let outHdg = lerpAngleDeg(rawHTR[0], smHdg, blend);
        let outPit = lerpAngleDeg(rawHTR[1], smPit, blend);
        let outRol = lerpAngleDeg(rawHTR[2], smRol, blend);

        if (Math.abs(outX - rawXY[0]) < jitterPosM) outX = smX;
        if (Math.abs(outY - rawXY[1]) < jitterPosM) outY = smY;
        if (Math.abs(outZ - rawXY[2]) < jitterPosM) outZ = smZ;
        if (Math.abs(angleDeltaDeg(rawHTR[0], outHdg)) < jitterAngD) outHdg = smHdg;
        if (Math.abs(angleDeltaDeg(rawHTR[1], outPit)) < jitterAngD) outPit = smPit;
        if (Math.abs(angleDeltaDeg(rawHTR[2], outRol)) < jitterAngD) outRol = smRol;

        smXY[i] = [outX, outY, outZ];
        smLLA[i] = [
          track.base.lat0 + (outY / track.base.mLat),
          track.base.lon0 + (outX / track.base.mLon),
          outZ
        ];
        smHTR[i] = [outHdg, outPit, outRol];
      }

      track._precision = { key, lla: smLLA, htr: smHTR, xy: smXY };
    }

    const srcL = track._precision.lla;
    const srcH = track._precision.htr;
    const i1 = clamp(Math.floor(idxFloat), 0, n - 1);
    const i2 = clamp(i1 + 1, 0, n - 1);
    const f = clamp(idxFloat - i1, 0, 1);

    const outL = track._pool.tmpC;
    interpLLA(srcL[i1], srcL[i2], f, outL);

    return {
      lla: [outL[0], outL[1], outL[2]],
      htr: [
        lerpAngleDeg(srcH[i1][0], srcH[i2][0], f),
        lerpAngleDeg(srcH[i1][1], srcH[i2][1], f),
        lerpAngleDeg(srcH[i1][2], srcH[i2][2], f)
      ]
    };
  }

  function startRecordingInternal(t0) {
    const ac = geofs?.aircraft?.instance;
    if (!ac) return alert('No active aircraft.');
    const modelUrl = ac?.object3d?.model?._model?._resource?.url;
    if (!modelUrl) return alert('No model URL found.');

    const fallbackCallsign = sanitizeCallsign(geofs?.userRecord?.callsign || geofs?.callsign || '');
    const tr = makeTrackBase(ac, defaultSampleMs, recordCallsign || fallbackCallsign);
    initTrackRuntime(tr);
    tr.modelUrl = modelUrl;

    const detected = detectNodeNames(ac);
    const liveModel = ac?.object3d?.model?._model;
    const modelNames = collectModelNodeNames(liveModel);

    const combined = [...detected.tokenNames];
    const combinedWarm = [...detected.warmNames];
    for (const name of modelNames) {
      if (isLadderName(name)) continue;
      if (shouldTrackToken(name)) combined.push(name);
      else combinedWarm.push(name);
    }

    tr._nodeNames = [...new Set(combined.map((n) => String(n)))];
    tr._nodeNameSet = new Set(tr._nodeNames);
    tr._rec.warmNames = [...new Set(combinedWarm.map((n) => String(n)))];
    tr._rec.startT = t0;
    tr._rec.lastT = t0;
    tr._rec.recording = true;
    const initialLivery = readCurrentLiveryId(ac);
    const initialSnapshot = readCurrentLiverySnapshot(ac);
    tr._rec.lastLiverySig = liverySig(initialLivery);
    tr.liveryEvents.push({ t: 0, id: initialLivery, snapshot: initialSnapshot });

    currentRec = tr;
    recordState = 'RECORDING';
    updateUi();
  }

  function startRecordingAt(t0) {
    if (!(recordState === 'IDLE' && (playState === 'IDLE' || playState === 'PLAYING'))) return;
    startRecordingInternal(t0);
  }

  function stopRecording() {
    if (!currentRec || recordState !== 'RECORDING') return;
    currentRec._rec.recording = false;

    const finalized = {
      orderId: currentRec.orderId,
      id: currentRec.id,
      name: currentRec.name,
      callsign: sanitizeCallsign(currentRec.callsign || ''),
      description: currentRec.description || '',
      createdAt: currentRec.createdAt,
      aircraftId: currentRec.aircraftId,
      modelUrl: currentRec.modelUrl,
      sampleMs: currentRec.sampleMs,
      base: currentRec.base,
      lla: currentRec.lla,
      htr: currentRec.htr,
      xy: currentRec.xy,
      gearEvents: currentRec.gearEvents,
      liveryEvents: currentRec.liveryEvents,
      _nodeNames: currentRec._nodeNames
    };
    initTrackRuntime(finalized);
    tracks.push(finalized);

    currentRec = null;
    recordState = 'IDLE';
    saveToLocalStorage();
    updateUi();
  }

  function recordFixedStep(track, dt) {
    const ac = geofs?.aircraft?.instance;
    if (!ac || !track?._rec?.recording) return;

    const rec = track._rec;
    const elapsedMs = Math.max(0, now() - rec.startT);
    const targetSamples = Math.floor(elapsedMs / Math.max(1, track.sampleMs)) + 1;
    rec.targetSamples = targetSamples;

    const missing = Math.min(
      Math.max(0, targetSamples - rec.sampleCount),
      MAX_RECORD_STEPS_PER_FRAME
    );
    if (!missing) return;

    const livePose = readLivePose(ac, track.base);
    const prevPose = rec.sampleCount > 0
      ? {
        lla: track.lla[rec.sampleCount - 1],
        htr: track.htr[rec.sampleCount - 1],
        xy: track.xy[rec.sampleCount - 1]
      }
      : null;

    for (let k = 1; k <= missing; k++) {
      const f = k / missing;
      const pose = prevPose ? interpolatePose(prevPose, livePose, f) : livePose;
      track.lla.push(pose.lla);
      track.htr.push(pose.htr);
      track.xy.push(pose.xy);

      const upNow = readGearUp(ac);
      if (rec.lastGearUp == null || rec.lastGearUp !== upNow) {
        track.gearEvents.push({ t: rec.sampleCount, up: !!upNow });
        rec.lastGearUp = upNow;
      }

      rec.sampleCount++;
    }
  }

  /* ---------- Playback ---------- */
  function getTrackCallsign(track) {
    return sanitizeCallsign(track?.callsign || '');
  }

  function destroyGhostCallsignLabel(track) {
    const entity = track?._ghostLabel;
    if (!entity) return;
    try {
      const viewer = geofs?.api?.viewer;
      viewer?.entities?.remove?.(entity);
    } catch {
      // ignore cleanup failures
    }
    track._ghostLabel = null;
  }

  function ensureGhostCallsignLabel(track, lla) {
    if (!showCallsign) {
      destroyGhostCallsignLabel(track);
      return;
    }
    const callsign = getTrackCallsign(track);
    if (!callsign) {
      destroyGhostCallsignLabel(track);
      return;
    }

    const viewer = geofs?.api?.viewer;
    const entities = viewer?.entities;
    if (!entities || !window.Cesium?.Cartesian3?.fromDegrees) return;

    const lat = Number(lla?.[0]);
    const lon = Number(lla?.[1]);
    const alt = Number(lla?.[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt)) return;

    const pos = window.Cesium.Cartesian3.fromDegrees(lon, lat, alt + 4);
    if (!track._ghostLabel) {
      try {
        track._ghostLabel = entities.add({
          position: pos,
          label: {
            text: callsign,
            fillColor: window.Cesium.Color.WHITE,
            outlineColor: window.Cesium.Color.BLACK,
            outlineWidth: 3,
            style: window.Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: false,
            backgroundColor: new window.Cesium.Color(0, 0, 0, 0.35),
            horizontalOrigin: window.Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: window.Cesium.VerticalOrigin.TOP,
            pixelOffset: new window.Cesium.Cartesian2(0, -8),
            scale: 0.55,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        });
      } catch {
        track._ghostLabel = null;
      }
    } else {
      try {
        track._ghostLabel.position = pos;
        if (track._ghostLabel.label) track._ghostLabel.label.text = callsign;
      } catch {
        // ignore runtime failures
      }
    }
  }

  function spawnGhost(track) {
    if (!track?.lla?.length || !track?.htr?.length) return null;
    try {
      const ghostModelUrl = makeUniqueGhostModelUrl(track);
      const ghost = new geofs.api.Model(null, {
        url: ghostModelUrl,
        location: track.lla[0],
        rotation: track.htr[0]
      });
      track._ghost = ghost;
      track._ghostModelUrl = ghostModelUrl;
      return ghost;
    } catch {
      return null;
    }
  }

  function resetGhostForNewLivery(track) {
    if (!track) return;
    if (track._ghost) {
      try { track._ghost.destroy(); } catch { }
    }
    track._ghost = null;
    track._nodeCache = { ready: false, all: [], gear: [], wheels: [], doors: [], ladder: [] };
    track._lastGearUp = null;
    spawnGhost(track);
  }

  function setGhostPose(track, lla, htr) {
    const g = track._ghost;
    if (!g?.setPositionOrientationAndScale) return;
    const L = track._pool.lla;
    const H = track._pool.htr;
    const lla0 = track.lla?.[0] || [0, 0, 0];
    const htr0 = track.htr?.[0] || [0, 0, 0];
    L[0] = finiteOr(lla?.[0], finiteOr(lla0[0], 0));
    L[1] = finiteOr(lla?.[1], finiteOr(lla0[1], 0));
    L[2] = finiteOr(lla?.[2], finiteOr(lla0[2], 0));
    H[0] = finiteOr(htr?.[0], finiteOr(htr0[0], 0));
    H[1] = finiteOr(htr?.[1], finiteOr(htr0[1], 0));
    H[2] = finiteOr(htr?.[2], finiteOr(htr0[2], 0));
    try { g.setPositionOrientationAndScale(L, H, null); } catch { }
    ensureGhostCallsignLabel(track, L);
  }

  function poseAt(track, i1, i2, f, dt) {
    const idxFloat = i1 + clamp(f, 0, 1);
    if (playbackSliderDragging) {
      const aL = track?.lla?.[i1] || track?.lla?.[0] || [0, 0, 0];
      const bL = track?.lla?.[i2] || aL;
      const aH = track?.htr?.[i1] || track?.htr?.[0] || [0, 0, 0];
      const bH = track?.htr?.[i2] || aH;
      const ff = clamp(f, 0, 1);
      const outL = track._pool.tmpB;
      interpLLA(aL, bL, ff, outL);
      return {
        lla: [outL[0], outL[1], outL[2]],
        htr: [
          lerpAngleDeg(aH[0], bH[0], ff),
          lerpAngleDeg(aH[1], bH[1], ff),
          lerpAngleDeg(aH[2], bH[2], ff)
        ]
      };
    }
    return applyPrecisionVisualFilter(track, idxFloat);
  }

  function startPlaybackInternal(track, t0) {
    if (!track || !track.lla?.length) return;

    if (!track._ghost) spawnGhost(track);

    track._play.playing = true;
    track._play.paused = false;
    track._play.idx = 0;
    track._play.startT = t0;
    track._play.lastT = t0;
    track._precision = null;
    track._lastGearUp = null;
    if (track._livery) {
      if (track._livery.startApplyTimer) {
        clearTimeout(track._livery.startApplyTimer);
        track._livery.startApplyTimer = null;
      }
      track._livery.lastSig = null;
      track._livery.appliedSig = null;
      track._livery.resetSig = null;
      track._livery.pendingId = null;
      track._livery.pendingSnapshot = null;
      track._livery.pendingSig = null;
      track._livery.applying = false;
      const initialLivery = liveryAtIndex(track, 0);
      const initialSnapshot = liverySnapshotAtIndex(track, 0);
      const initialSig = liverySig(initialLivery);
      track._livery.lastSig = initialSig;
      track._livery.pendingId = initialLivery;
      track._livery.pendingSnapshot = initialSnapshot;
      track._livery.pendingSig = initialSig;
      if (initialLivery != null || initialSnapshot) {
        // Exact same flow as UI helper buttons:
        // 1) "Reset ghost + Apply now"
        // 2) after delay, "Apply now"
        resetThenApplyLiveryForTrack(track);
        track._livery.startApplyTimer = setTimeout(() => {
          if (!track?._play?.playing) return;
          applyCurrentLiveryForTrack(track);
        }, 2000);
      }
    }
    updatePlayState();
  }

  function startPlaybackAt(track, t0) {
    startPlaybackInternal(track, t0);
  }

  function pausePlayback(track, paused) {
    if (!track?._play?.playing) return;
    const t = now();
    if (paused) {
      if (!track._play.paused) track._play.lastT = t;
      track._play.paused = true;
    } else {
      if (track._play.paused && Number.isFinite(track._play.lastT)) {
        track._play.startT += Math.max(0, t - track._play.lastT);
      }
      track._play.paused = false;
      track._play.lastT = t;
    }
    updateUi();
  }

  function stopPlayback(track) {
    if (!track?._play) return;
    track._play.playing = false;
    track._play.paused = true;
    track._play.idx = 0;
    if (track._ghost) {
      try { track._ghost.destroy(); } catch { }
    }
    destroyGhostCallsignLabel(track);
    track._ghost = null;
    track._nodeCache = { ready: false, all: [], gear: [], wheels: [], doors: [], ladder: [] };
    track._lastGearUp = null;
    if (track._livery) {
      if (track._livery.startApplyTimer) {
        clearTimeout(track._livery.startApplyTimer);
        track._livery.startApplyTimer = null;
      }
      track._livery.lastSig = null;
      track._livery.appliedSig = null;
      track._livery.resetSig = null;
      track._livery.pendingId = null;
      track._livery.pendingSnapshot = null;
      track._livery.pendingSig = null;
      track._livery.applying = false;
    }
    updatePlayState();
  }

  function playbackFixedStep(track, dt) {
    if (!track?._play?.playing || track._play.paused) return;
    if (!track._ghost) return;
    if (!track._ghost._model?.ready) return;

    const p = track._play;
    const elapsedMs = Math.max(0, now() - p.startT);
    const idxFloat = elapsedMs / Math.max(1, track.sampleMs);
    p.idx = Math.floor(idxFloat);

    const last = track.lla.length - 1;
    const i1 = clamp(p.idx, 0, last);
    const i2 = clamp(i1 + 1, 0, last);
    let f = idxFloat - Math.floor(idxFloat);
    if (easingOn) f = smoothstep(f);

    const pose = poseAt(track, i1, i2, f, dt);
    if (!pose || !Array.isArray(pose.lla) || !Array.isArray(pose.htr)) {
      return;
    }

    setGhostPose(track, pose.lla, pose.htr);

    if (track._livery && !track._livery.applying && track._livery.pendingId != null) {
      const ps = track._livery.pendingSig || liverySig(track._livery.pendingId);
      if (!ps || track._livery.appliedSig !== ps) {
        requestApplyTrackLivery(track, track._livery.pendingId, track._livery.pendingSnapshot);
      } else {
        track._livery.pendingId = null;
        track._livery.pendingSnapshot = null;
        track._livery.pendingSig = null;
      }
    }

    const upNow = gearUpAtIndex(track, i1);
    if (track._lastGearUp == null || track._lastGearUp !== upNow) {
      applyGearState(track, upNow);
      track._lastGearUp = upNow;
      // Enforce hidden as the final step after every gear change.
      hideLadderNodes(track);
    }
    hideLadderNodes(track);

    if (i1 >= last) {
      p.paused = true;
    }
  }

  function findClosestGearSampleIndex(track, target) {
    const anim = track?.anim || [];
    let bestIdx = -1;
    let bestErr = Infinity;
    for (let i = 0; i < anim.length; i++) {
      const g = Number(anim[i]?.gear);
      if (!Number.isFinite(g)) continue;
      const err = Math.abs(g - target);
      if (err < bestErr) {
        bestErr = err;
        bestIdx = i;
      }
    }
    return { idx: bestIdx, err: bestErr };
  }

  function testGhostGearState(target) {
    const active = tracks.find((t) => t._ghost?._model?.ready && t._play?.playing);
    if (!active) {
      alert('No active ghost playback. Start a playback first.');
      return;
    }

    const up = Number(target) > 0.5;
    applyGearState(active, up);
    hideLadderNodes(active);
    gui.mtInfo.textContent = `Gear test -> state=${up ? 'UP' : 'DOWN'}`;
  }

  function buildMatrixStateAt(track, targetIdx) {
    const state = new Map();
    const idx = clamp(Math.floor(targetIdx), 0, Math.max(0, (track?.lla?.length || 1) - 1));
    for (const blk of track?.blocks || []) {
      for (const d of blk || []) {
        if ((d?.t ?? 0) > idx) return state;
        const m = d?.m || {};
        for (const [name, mat] of Object.entries(m)) state.set(name, mat);
      }
    }
    return state;
  }

  function matrixDiffScore(a16, b16) {
    if (!a16 || !b16) return Infinity;
    let s = 0;
    for (let i = 0; i < 16; i++) s += Math.abs(Number(a16[i]) - Number(b16[i]));
    return s;
  }

  function isNoiseNodeName(name) {
    const s = String(name || '').toLowerCase();
    return isWheelLikeName(s) || s.includes('fan') || s.includes('prop') || s.includes('rotor');
  }

  function isGearCandidateName(name) {
    const s = String(name || '').toLowerCase();
    return s.includes('gear') || s.includes('door') || s.includes('actuator') || s.includes('strut') || s.includes('oleo');
  }

  function isStrictGearNodeName(name) {
    const s = String(name || '').toLowerCase();
    return STRICT_GEAR_NODE_HINTS.some((h) => s.includes(h));
  }

  /* ---------- Storage ---------- */
  function saveRecorderPrefs() {
    try {
      localStorage.setItem(LS_CALLSIGN_KEY, sanitizeCallsign(recordCallsign || ''));
    } catch {
      // ignore storage failures
    }
  }

  function loadRecorderPrefs() {
    try {
      recordCallsign = sanitizeCallsign(localStorage.getItem(LS_CALLSIGN_KEY) || '');
    } catch {
      recordCallsign = '';
    }
  }

  function saveToLocalStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(buildProject()));
    } catch {
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const project = JSON.parse(raw);
      if (!project?.tracks?.length) {
        tracks = [];
        return;
      }
      tracks = project.tracks.map((t) => {
        const tr = normalizeTrackMeta({
          orderId: t.orderId,
          id: t.id,
          name: t.name,
          callsign: t.callsign || '',
          description: t.description || '',
          createdAt: t.createdAt,
          aircraftId: t.aircraftId,
          modelUrl: t.modelUrl,
          sampleMs: t.sampleMs,
          base: t.base,
          lla: t.lla || [],
          htr: t.htr || [],
          xy: t.xy || [],
          gearEvents: t.gearEvents || [],
          liveryEvents: t.liveryEvents || [],
          _nodeNames: t._nodeNames || []
        }, 1);
        initTrackRuntime(tr);
        return tr;
      });
      tracks.sort((a, b) => (a.orderId || 0) - (b.orderId || 0));
      tracks.forEach((t, i) => normalizeTrackMeta(t, i + 1));
      refreshNextTrackNumber();
      updatePlayState();
    } catch {
    }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(buildProject())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flight-recorder-${VERSION}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJSON(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const project = JSON.parse(String(rd.result || '{}'));
        const srcTracks = Array.isArray(project?.tracks) ? project.tracks : Array.isArray(project) ? project : [];
        const added = [];
        for (const t of srcTracks) {
          const tr = normalizeTrackMeta({
            orderId: t.orderId,
            id: t.id,
            name: t.name || 'Imported',
            callsign: t.callsign || '',
            description: t.description || '',
            createdAt: t.createdAt,
            aircraftId: t.aircraftId,
            modelUrl: t.modelUrl,
            sampleMs: Number(t.sampleMs) || 16,
            base: t.base,
            lla: t.lla || [],
            htr: t.htr || [],
            xy: t.xy || [],
            gearEvents: t.gearEvents || [],
            liveryEvents: t.liveryEvents || [],
            _nodeNames: t._nodeNames || []
          }, nextTrackNumber++);
          initTrackRuntime(tr);
          added.push(tr);
        }
        tracks.push(...added);
        tracks.sort((a, b) => (a.orderId || 0) - (b.orderId || 0));
        refreshNextTrackNumber();
        saveToLocalStorage();
        updateUi();
      } catch (e) {
        alert(`Import failed: ${e}`);
      }
    };
    rd.readAsText(file);
  }

  /* ---------- Actions ---------- */
  function getSelectedTracks() {
    if (!guiWin || guiWin.closed) return [];
    const boxes = [...guiWin.document.querySelectorAll('input.track-select[type="checkbox"]')];
    const out = [];
    for (const cb of boxes) {
      if (!cb.checked) continue;
      const tr = tracks.find((t) => t.id === cb.dataset.id);
      if (tr?.lla?.length) out.push(tr);
    }
    return out;
  }

  function playSelectedTracks() {
    if (recordState !== 'IDLE') return;
    const selected = getSelectedTracks();
    if (!selected.length) return alert('Select at least one track.');

    const t0 = now();
    for (const tr of selected) {
      if (!tr._play.playing) startPlaybackAt(tr, t0);
      else if (tr._play.paused) pausePlayback(tr, false);
    }
    updateUi();
  }

  function pauseSelectedTracks() {
    const selected = getSelectedTracks();
    if (!selected.length) return alert('Select at least one track.');
    for (const tr of selected) {
      if (tr._play.playing && !tr._play.paused) pausePlayback(tr, true);
    }
    updateUi();
  }

  function stopSelectedTracks() {
    const selected = getSelectedTracks();
    if (!selected.length) return alert('Select at least one track.');
    for (const tr of selected) stopPlayback(tr);
    updateUi();
  }

  function startRecordingWithSelectedPlaybacks() {
    if (recordState !== 'IDLE') return;

    stopAll();

    const selected = getSelectedTracks();
    const t0 = now();
    for (const tr of selected) startPlaybackAt(tr, t0);
    startRecordingAt(t0);
    updateUi();
  }

  function stopAll() {
    for (const tr of tracks) stopPlayback(tr);
    updatePlayState();
    updateUi();
  }

  function getPlaybackUiMode() {
    if (playState === 'IDLE') return 'IDLE';
    const hasActive = tracks.some((t) => t._play?.playing && !t._play?.paused);
    return hasActive ? 'PLAYING' : 'PAUSED';
  }

  function getSliderTracks() {
    const selected = getSelectedTracks().filter((t) => t._play?.playing);
    if (selected.length) return selected;
    return tracks.filter((t) => t._play?.playing);
  }

  function getTrackDurationMs(track) {
    const last = Math.max(0, (track?.lla?.length || 1) - 1);
    return last * Math.max(1, track?.sampleMs || 16);
  }

  function getLongestTimelineTrack(targets) {
    if (!targets?.length) return null;
    let best = targets[0];
    let bestMs = getTrackDurationMs(best);
    for (let i = 1; i < targets.length; i++) {
      const t = targets[i];
      const ms = getTrackDurationMs(t);
      if (ms > bestMs) {
        best = t;
        bestMs = ms;
      }
    }
    return best;
  }

  function seekTrackToIndex(track, targetIdx, options = {}) {
    const applyHeavy = options.applyHeavy !== false;
    if (!track?._play?.playing) return;
    const last = Math.max(0, (track.lla?.length || 1) - 1);
    const idx = clamp(Math.round(targetIdx), 0, last);
    track._play.idx = idx;

    if (!track._ghost) spawnGhost(track);
    if (track._ghost?._model?.ready) {
      const i1 = idx;
      const i2 = clamp(i1 + 1, 0, last);
      const pose = poseAt(track, i1, i2, 0, 16);
      if (pose?.lla && pose?.htr) setGhostPose(track, pose.lla, pose.htr);

      if (applyHeavy) {
        const upNow = gearUpAtIndex(track, i1);
        if (track._lastGearUp == null || track._lastGearUp !== upNow) {
          applyGearState(track, upNow);
          track._lastGearUp = upNow;
        }
        hideLadderNodes(track);
      }
    }

    if (!track._play.paused) {
      track._play.startT = now() - (idx * Math.max(1, track.sampleMs));
    } else {
      track._play.lastT = now();
    }
  }

  function seekPlaybackByRatio(ratio, options = {}) {
    const r = clamp(Number(ratio) || 0, 0, 1);
    const targets = getSliderTracks();
    if (!targets.length) return;
    const longest = getLongestTimelineTrack(targets);
    const longestDurationMs = Math.max(0, getTrackDurationMs(longest));
    const targetTimeMs = r * longestDurationMs;
    for (const tr of targets) {
      const idxFromTime = targetTimeMs / Math.max(1, tr.sampleMs || 16);
      seekTrackToIndex(tr, idxFromTime, options);
    }
    if (options.updateUi !== false) updateLiveStatus();
  }

  function updateGhostCallsignVisibility() {
    for (const tr of tracks) {
      if (!tr?._play?.playing) continue;
      if (!showCallsign) {
        destroyGhostCallsignLabel(tr);
        continue;
      }
      const idx = clamp(Math.floor(tr._play?.idx || 0), 0, Math.max(0, (tr.lla?.length || 1) - 1));
      const lla = tr.lla?.[idx] || tr.lla?.[0] || null;
      if (lla) ensureGhostCallsignLabel(tr, lla);
    }
  }

  function renameTrack(id, name) {
    const tr = tracks.find((t) => t.id === id);
    if (!tr) return;
    tr.name = name?.trim() || tr.name;
    saveToLocalStorage();
  }

  function setTrackDescription(id, description) {
    const tr = tracks.find((t) => t.id === id);
    if (!tr) return;
    tr.description = String(description || '');
    saveToLocalStorage();
  }

  function setTrackCallsign(id, callsign) {
    const tr = tracks.find((t) => t.id === id);
    if (!tr) return;
    tr.callsign = sanitizeCallsign(callsign || '');
    if (tr._play?.playing) {
      const idx = clamp(Math.floor(tr._play?.idx || 0), 0, Math.max(0, (tr.lla?.length || 1) - 1));
      const lla = tr.lla?.[idx] || tr.lla?.[0] || null;
      if (lla) ensureGhostCallsignLabel(tr, lla);
    }
    saveToLocalStorage();
  }

  function deleteTrack(id) {
    const idx = tracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    stopPlayback(tracks[idx]);
    tracks.splice(idx, 1);
    saveToLocalStorage();
    updateUi();
  }

  /* ---------- UI ---------- */
  function ensureEmbeddedPanel() {
    const host = document.querySelector('.geofs-ui-left');
    if (!host) {
      console.warn('Flight Recorder: Embedded panel not found, returning...');
      return null;
    }

    let panel = document.getElementById(FR_PANEL_ID);
    if (!panel) {
      console.warn('Flight Recorder: Embedded panel found.');
      panel = document.createElement('div');
      panel.id = FR_PANEL_ID;
      panel.className = 'geofs-list geofs-toggle-panel flight-recorder-list geofs-stopMousePropagation geofs-stopKeyupPropagation';
      panel.setAttribute('data-noblur', 'true');
      panel.setAttribute('data-onshow', '{geofs.initializePreferencesPanel()}');
      panel.setAttribute('data-onhide', '{geofs.savePreferencesPanel()}');
      host.appendChild(panel);
    }

    return panel;
  }

  function mountGuiIntoPanel() {
    const panel = ensureEmbeddedPanel();
    if (!panel) return null;

    if (gui.panelEl === panel && gui.recBtn) return panel;

    panel.innerHTML = `
      <div style="font-family: Segoe UI, sans-serif; padding:14px;">
        <h2 style="margin:0 0 12px; text-align: center;">Flight Recorder ${VERSION}</h2>

        <fieldset style="margin-bottom:10px;">
          <legend>Recording</legend>
          <div style="display:flex; justify-content:center; align-items:center;">
            <button id="recBtn" style="font-size:18px; font-weight:700; min-width:260px; padding:12px 14px; border:none; border-radius:8px; cursor:pointer; color:#fff;"></button>
          </div>
          <div style="text-align:center; color:#555; margin-top:8px;">
            <label for="rateSel">Rate</label>
            <select id="rateSel" style="margin-left:6px;">
              <option value="100">10 Hz</option>
              <option value="50">20 Hz</option>
              <option value="33">30 Hz</option>
              <option value="16" selected>60 Hz</option>
            </select>
          </div>
          <div style="text-align:center; color:#555; margin-top:8px;">
            <label for="callsignIn">Callsign</label>
            <input id="callsignIn" type="text" maxlength="24" placeholder="bijv. BA01" style="margin-left:6px; width:180px;">
          </div>
          <div id="recStatus" style="text-align:center; color:#777; margin-top:10px; font-size:14px;">REC • 0 • ${(1000 / defaultSampleMs).toFixed(1)} Hz</div>
          <div id="recHint" style="text-align:center; color:#777; margin-top:4px; min-height:18px;"></div>
        </fieldset>

        <fieldset style="margin-bottom:10px;">
          <legend>Storage</legend>
          <div style="margin-bottom:6px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center;">
            <button id="saveBtn">Save (to Browser)</button>
            <button id="loadBtn">Load (from Browser)</button>
            <button id="exportBtn">Export JSON</button>
            <button id="importBtn">Import JSON</button>
            <input type="file" id="importFile" accept="application/json" style="display:none;">
          </div>
          <small style="display:block; color:#555; text-align:center; margin-bottom:2px;">
            <b>Save/Load</b> = local browser storage on this PC.<br>
            <b>Export/Import</b> = JSON file backup/share.
          </small>
        </fieldset>

        <fieldset style="margin-bottom:10px;">
          <legend>Playback</legend>
          <div style="display:flex; justify-content:center; gap:14px; flex-wrap:wrap; align-items:center;">
            <button id="playSelBtn" title="Play selected" style="width:62px; height:62px; border-radius:50%; border:1px solid #0a7f2e; background:#16a34a; color:#fff; font-size:26px; font-weight:700; cursor:pointer;">▶</button>
            <button id="pauseSelBtn" title="Pause selected" style="width:62px; height:62px; border-radius:50%; border:1px solid #0a4f97; background:#2563eb; color:#fff; font-size:24px; font-weight:700; cursor:pointer;">❚❚</button>
            <button id="stopSelBtn" title="Stop selected" style="width:62px; height:62px; border-radius:50%; border:1px solid #991b1b; background:#dc2626; color:#fff; font-size:22px; font-weight:700; cursor:pointer;">■</button>
          </div>
          <div style="text-align:center; margin-top:10px; padding-bottom:20px;">
            <input id="playbackPos" type="range" min="0" max="1000" step="1" value="0" style="width:min(760px, 95%);">
            <div id="playbackPosInfo" style="color:#666; font-size:12px; margin-top:3px;">Playback position: 0%</div>
          </div>
          <div style="text-align:center; color:#555; margin-bottom:10px;">
            <label for="ultraStrength">Smoothing</label>
            <input id="ultraStrength" type="range" min="0" max="100" step="1" value="${ultraStrength}" style="width:220px; vertical-align:middle;">
            <span id="ultraStrengthVal">${ultraStrength}</span>
          </div>
          <div style="text-align:center; color:#555; margin-bottom:10px;">
            <label style="cursor:pointer;"><input id="showCallsignCb" type="checkbox" ${showCallsign ? 'checked' : ''}> Show Callsign</label>
          </div>
          <div style="text-align:center; color:#666; margin-bottom:8px;">Playback controls for selected tracks</div>
          <div id="tracks"></div>
        </fieldset>

        <fieldset>
          <legend>Model Test</legend>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="mtBuild">Build/Refresh Cache</button>
            <button id="mtLadderShow">Ladder Show</button>
            <button id="mtLadderHide">Ladder Hide</button>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
            <button id="mtGearIn">Test Gear IN</button>
            <button id="mtGearOut">Test Gear OUT</button>
          </div>
          <small id="mtInfo" style="display:block; margin-top:6px; color:#666;"></small>
        </fieldset>

        <div style="margin-top:10px;"><small id="info" style="color:#444;"></small></div>
      </div>
    `;

    gui.panelEl = panel;
    guiWin = {
      closed: false,
      document,
      focus: () => {
        panel.classList.add('geofs-visible');
      }
    };

    return panel;
  }

  function setPanelVisible(show) {
    const panel = mountGuiIntoPanel();
    if (!panel) return;
    panel.classList.toggle('geofs-visible', !!show);
    const leftHost = document.querySelector('.geofs-ui-left');
    if (leftHost) leftHost.classList.toggle('geofs-visible', !!show);
    try {
      if (show) geofs?.initializePreferencesPanel?.();
      else geofs?.savePreferencesPanel?.();
    } catch { }
    if (show) updateUi();
  }

  function togglePanel() {
    openGui();
  }

  function ensureBottomButton() {
    const bar = document.querySelector('.geofs-ui-bottom');
    if (!bar) return null;

    let button = document.getElementById(FR_BUTTON_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = FR_BUTTON_ID;
      button.className = 'mdl-button mdl-js-button geofs-f-standard-ui geofs-mediumScreenOnly';
      button.textContent = 'REC';

      const insertPos = geofs?.version >= 3.6 ? 4 : 3;
      if (bar.children.length > insertPos) bar.insertBefore(button, bar.children[insertPos]);
      else bar.appendChild(button);
    }

    button.title = 'Flight Recorder';
    button.setAttribute('data-toggle-panel', '.flight-recorder-list');
    button.setAttribute('data-tooltip-classname', 'mdl-tooltip--top');
    button.setAttribute('data-upgraded', ',MaterialButton');
    button.setAttribute('onclick', 'FlightRecorder.togglePanel()');
    if (!button.dataset.frClickBound) {
      button.addEventListener('click', () => {
        togglePanel();
      });
      button.dataset.frClickBound = '1';
    }

    return button;
  }

  function initEmbeddedUi() {
    window.FlightRecorder = window.FlightRecorder || {};
    window.FlightRecorder.togglePanel = togglePanel;

    const tryInit = () => {
      const panelHost = document.querySelector('.geofs-ui-left');
      const buttonHost = document.querySelector('.geofs-ui-bottom');
      if (!panelHost || !buttonHost) return false;
      ensureBottomButton();
      mountGuiIntoPanel();
      return true;
    };

    if (tryInit()) return;
    const timer = setInterval(() => {
      if (tryInit()) clearInterval(timer);
    }, 500);
  }

  function openGui() {
    const panel = mountGuiIntoPanel();
    if (!panel) return;
    try { geofs?.initializePreferencesPanel?.(); } catch { }

    gui.recBtn = guiWin.document.getElementById('recBtn');
    gui.rateSel = guiWin.document.getElementById('rateSel');
    gui.callsignIn = guiWin.document.getElementById('callsignIn');
    gui.recStatus = guiWin.document.getElementById('recStatus');
    gui.recHint = guiWin.document.getElementById('recHint');
    gui.ultraStrength = guiWin.document.getElementById('ultraStrength');
    gui.ultraStrengthVal = guiWin.document.getElementById('ultraStrengthVal');
    gui.showCallsignCb = guiWin.document.getElementById('showCallsignCb');
    gui.playSelBtn = guiWin.document.getElementById('playSelBtn');
    gui.pauseSelBtn = guiWin.document.getElementById('pauseSelBtn');
    gui.stopSelBtn = guiWin.document.getElementById('stopSelBtn');
    gui.playbackPos = guiWin.document.getElementById('playbackPos');
    gui.playbackPosInfo = guiWin.document.getElementById('playbackPosInfo');
    gui.tracksDiv = guiWin.document.getElementById('tracks');
    gui.saveBtn = guiWin.document.getElementById('saveBtn');
    gui.loadBtn = guiWin.document.getElementById('loadBtn');
    gui.exportBtn = guiWin.document.getElementById('exportBtn');
    gui.importBtn = guiWin.document.getElementById('importBtn');
    gui.importFile = guiWin.document.getElementById('importFile');
    gui.mtBuild = guiWin.document.getElementById('mtBuild');
    gui.mtLadderShow = guiWin.document.getElementById('mtLadderShow');
    gui.mtLadderHide = guiWin.document.getElementById('mtLadderHide');
    gui.mtGearIn = guiWin.document.getElementById('mtGearIn');
    gui.mtGearOut = guiWin.document.getElementById('mtGearOut');
    gui.mtInfo = guiWin.document.getElementById('mtInfo');
    gui.info = guiWin.document.getElementById('info');

    gui.recBtn.onclick = () => {
      if (recordState === 'RECORDING') stopRecording();
      else startRecordingWithSelectedPlaybacks();
      updateUi();
    };
    gui.rateSel.value = String(defaultSampleMs);
    if (gui.callsignIn) gui.callsignIn.value = recordCallsign;
    gui.rateSel.onchange = (e) => {
      defaultSampleMs = Number(e.target.value) || 16;
      updateLiveStatus();
    };
    if (gui.callsignIn) {
      gui.callsignIn.oninput = (e) => {
        const clean = sanitizeCallsign(e.target.value || '');
        recordCallsign = clean;
        if (e.target.value !== clean) e.target.value = clean;
        saveRecorderPrefs();
      };
    }
    gui.ultraStrength.value = String(ultraStrength);
    gui.ultraStrengthVal.textContent = String(ultraStrength);
    gui.ultraStrength.oninput = (e) => {
      ultraStrength = clamp(Number(e.target.value) || 0, 0, 100);
      for (const tr of tracks) {
        tr._precision = null;
      }
      gui.ultraStrengthVal.textContent = String(ultraStrength);
    };
    if (gui.showCallsignCb) {
      gui.showCallsignCb.checked = !!showCallsign;
      gui.showCallsignCb.onchange = (e) => {
        showCallsign = !!e.target.checked;
        updateGhostCallsignVisibility();
      };
    }

    if (gui.playbackPos) {
      const seekFromSlider = () => {
        const ratio = clamp((Number(gui.playbackPos.value) || 0) / 1000, 0, 1);
        seekPlaybackByRatio(ratio);
      };
      gui.playbackPos.oninput = () => {
        playbackSliderDragging = true;
        const t = now();
        if (t - lastSliderSeekTs < 33) return;
        lastSliderSeekTs = t;
        const ratio = clamp((Number(gui.playbackPos.value) || 0) / 1000, 0, 1);
        seekPlaybackByRatio(ratio, { applyHeavy: false, updateUi: false });
        updatePlaybackSliderUi();
      };
      gui.playbackPos.onchange = () => {
        lastSliderSeekTs = 0;
        seekFromSlider();
        playbackSliderDragging = false;
      };
      gui.playbackPos.onmousedown = () => { playbackSliderDragging = true; };
      gui.playbackPos.onmouseup = () => { playbackSliderDragging = false; };
    }

    gui.playSelBtn.onclick = () => playSelectedTracks();
    gui.pauseSelBtn.onclick = () => pauseSelectedTracks();
    gui.stopSelBtn.onclick = () => stopSelectedTracks();
    gui.saveBtn.onclick = () => saveToLocalStorage();
    gui.loadBtn.onclick = () => { loadFromLocalStorage(); updateUi(); };
    gui.exportBtn.onclick = () => exportJSON();
    gui.importBtn.onclick = () => gui.importFile.click();
    gui.importFile.onchange = (e) => {
      const f = e.target.files?.[0];
      if (f) importJSON(f);
      e.target.value = '';
    };

    gui.mtBuild.onclick = () => {
      const active = tracks.find((t) => t._play?.playing && t._ghost?._model?.ready);
      if (!active) {
        gui.mtInfo.textContent = 'No active ghost ready.';
        return;
      }
      buildNodeCache(active);
      hideLadderNodes(active);
      gui.mtInfo.textContent = `Cache: all=${active._nodeCache.all.length} gear=${active._nodeCache.gear.length} wheels=${active._nodeCache.wheels.length} doors=${active._nodeCache.doors.length} ladder=${active._nodeCache.ladder.length}`;
    };
    gui.mtLadderShow.onclick = () => {
      const active = tracks.find((t) => t._play?.playing && t._ghost?._model?.ready);
      if (!active) return;
      setCategoryVisible(active, 'ladder', true);
    };
    gui.mtLadderHide.onclick = () => {
      const active = tracks.find((t) => t._play?.playing && t._ghost?._model?.ready);
      if (!active) return;
      hideLadderNodes(active);
    };
    gui.mtGearIn.onclick = () => testGhostGearState(1);
    gui.mtGearOut.onclick = () => testGhostGearState(0);

    updateUi();
  }

  function renderFlightsList() {
    if (!gui.tracksDiv) return;

    const previousSelected = guiWin && !guiWin.closed
      ? new Set([...guiWin.document.querySelectorAll('input.track-select[type="checkbox"]:checked')].map((cb) => cb.dataset.id))
      : new Set();
    const hasPriorSelection = previousSelected.size > 0;

    if (!tracks.length) {
      gui.tracksDiv.innerHTML = '<p><i>No flights recorded/loaded yet.</i></p>';
      updateRecordingHint();
      return;
    }

    const orderedTracks = [...tracks].sort((a, b) => (a.orderId || 0) - (b.orderId || 0));
    gui.tracksDiv.innerHTML = orderedTracks.map((t) => {
      const seconds = Math.round((t.lla.length * t.sampleMs) / 1000);
      const rateHz = (1000 / t.sampleMs).toFixed(1);
      const gearChanges = (t.gearEvents || []).length;
      const callsign = sanitizeCallsign(t.callsign || '');
      const checked = (hasPriorSelection ? previousSelected.has(t.id) : true) ? 'checked' : '';
      const recDate = formatTrackDate(t.createdAt);
      const orderLabel = String(t.orderId || 0).padStart(4, '0');

      return `
        <div style="border:1px solid #ccc; background:#eee; padding:8px; margin-bottom:8px; border-radius:6px;">
          <div style="display:flex; justify-content:center; margin-bottom:8px;">
            <label style="font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px;">
              <input type="checkbox" class="track-select" data-id="${escapeHtml(t.id)}" ${checked} style="width:20px; height:20px; cursor:pointer;"> Use in playback
            </label>
          </div>
          <div style="display:flex; justify-content:center; margin-bottom:8px;">
            <input class="nameIn" data-id="${escapeHtml(t.id)}" value="${escapeHtml(t.name || 'Unnamed')}" style="width:min(720px, 95%); text-align:center; font-size:18px; font-weight:700; padding:6px 8px; box-sizing:border-box;">
          </div>
          <div style="display:flex; justify-content:center; margin-bottom:8px;">
            <input class="trackCallsignIn" data-id="${escapeHtml(t.id)}" maxlength="24" placeholder="Callsign" value="${escapeHtml(callsign)}" style="width:min(320px, 95%); text-align:center; font-size:14px; padding:5px 8px; box-sizing:border-box;">
          </div>
          <div style="display:flex; justify-content:center; margin-bottom:8px;">
            <div style="width:min(720px, 95%);">
              <textarea class="descIn" data-id="${escapeHtml(t.id)}" rows="3" placeholder="Description" style="width:100%; box-sizing:border-box; resize:vertical;">${escapeHtml(t.description || '')}</textarea>
            </div>
          </div>
          <div style="display:flex; justify-content:center; margin-bottom:8px;">
            <span style="color:#666; text-align:center; width:min(720px, 95%); overflow-wrap:anywhere;">• ID: #${orderLabel} • Date: ${escapeHtml(recDate)} • Duration: ${seconds}s • Rate: ${rateHz} Hz • Gear changes: ${gearChanges}<br>• Callsign: ${escapeHtml(callsign || '-')} • Model: ${escapeHtml(t.modelUrl || '-')}</span>
          </div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; justify-content:center;">
            <button class="delBtn" data-id="${escapeHtml(t.id)}">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    for (const btn of guiWin.document.querySelectorAll('.delBtn')) {
      btn.onclick = () => deleteTrack(btn.dataset.id);
    }

    for (const input of guiWin.document.querySelectorAll('.nameIn')) {
      input.oninput = () => {
        const id = input.dataset.id;
        if (!id) return;
        renameTrack(id, input.value || '');
      };
    }

    for (const input of guiWin.document.querySelectorAll('.descIn')) {
      input.oninput = () => {
        const id = input.dataset.id;
        if (!id) return;
        setTrackDescription(id, input.value || '');
      };
    }

    for (const input of guiWin.document.querySelectorAll('.trackCallsignIn')) {
      input.oninput = () => {
        const id = input.dataset.id;
        if (!id) return;
        const clean = sanitizeCallsign(input.value || '');
        if (input.value !== clean) input.value = clean;
        setTrackCallsign(id, clean);
      };
    }

    for (const cb of guiWin.document.querySelectorAll('input.track-select[type="checkbox"]')) {
      cb.onchange = () => updateRecordingHint();
    }

    updateRecordingHint();
  }

  function updateRecordingHint() {
    if (!guiWin || guiWin.closed || !gui.recHint) return;
    const selectedCount = [...guiWin.document.querySelectorAll('input.track-select[type="checkbox"]:checked')].length;
    gui.recHint.textContent = selectedCount > 0 ? 'With selected playbacks' : '';
  }

  function updatePlaybackControlsUi() {
    if (!guiWin || guiWin.closed) return;
    const mode = getPlaybackUiMode();
    const canInteract = recordState === 'IDLE';

    if (gui.playSelBtn) {
      gui.playSelBtn.style.display = (mode === 'IDLE' || mode === 'PAUSED') ? '' : 'none';
      gui.playSelBtn.disabled = !canInteract;
    }
    if (gui.pauseSelBtn) {
      gui.pauseSelBtn.style.display = (mode === 'PLAYING') ? '' : 'none';
      gui.pauseSelBtn.disabled = !canInteract;
    }
    if (gui.stopSelBtn) {
      gui.stopSelBtn.style.display = (mode === 'IDLE') ? 'none' : '';
      gui.stopSelBtn.disabled = !canInteract;
    }
  }

  function updatePlaybackSliderUi() {
    if (!guiWin || guiWin.closed || !gui.playbackPos || !gui.playbackPosInfo) return;
    const targets = getSliderTracks();
    if (!targets.length) {
      gui.playbackPos.disabled = true;
      if (!playbackSliderDragging) gui.playbackPos.value = '0';
      gui.playbackPosInfo.textContent = 'Playback position: -';
      return;
    }

    const longest = getLongestTimelineTrack(targets);
    const longestDurationMs = Math.max(0, getTrackDurationMs(longest));
    const last = Math.max(0, (longest?.lla?.length || 1) - 1);
    const idx = clamp(Math.floor(longest?._play?.idx || 0), 0, last);
    const elapsedMs = idx * Math.max(1, longest?.sampleMs || 16);
    const ratio = longestDurationMs > 0 ? elapsedMs / longestDurationMs : 0;
    gui.playbackPos.disabled = false;
    if (!playbackSliderDragging) {
      gui.playbackPos.value = String(Math.round(ratio * 1000));
    }

    const elapsedSec = elapsedMs / 1000;
    const totalSec = longestDurationMs / 1000;
    gui.playbackPosInfo.textContent = `Playback position: ${Math.round(ratio * 100)}% (${elapsedSec.toFixed(1)}s / ${totalSec.toFixed(1)}s)`;
  }

  function updateUi() {
    if (!guiWin || guiWin.closed) return;
    if (!gui.recBtn) return;

    const recActive = recordState === 'RECORDING';
    gui.recBtn.textContent = recActive ? 'STOP RECORDING' : 'START RECORDING';
    gui.recBtn.style.background = recActive ? '#0b5ed7' : '#c92a2a';

    const canRec = recordState === 'IDLE';

    if (!recActive) gui.recBtn.disabled = !canRec;
    else gui.recBtn.disabled = false;

    updatePlaybackControlsUi();
    if (gui.ultraStrength) {
      gui.ultraStrength.value = String(ultraStrength);
    }
    if (gui.ultraStrengthVal) gui.ultraStrengthVal.textContent = String(ultraStrength);
    if (gui.showCallsignCb) gui.showCallsignCb.checked = !!showCallsign;
    if (gui.rateSel) gui.rateSel.value = String(defaultSampleMs);
    if (gui.callsignIn && gui.callsignIn.value !== recordCallsign) gui.callsignIn.value = recordCallsign;

    renderFlightsList();
    updatePlaybackSliderUi();
    updateLiveStatus();
  }

  function updateLiveStatus() {
    if (!guiWin || guiWin.closed) return;
    updatePlaybackControlsUi();
    updatePlaybackSliderUi();
    const samples = currentRec?.lla?.length || 0;
    const hz = currentRec ? (1000 / currentRec.sampleMs).toFixed(1) : (1000 / defaultSampleMs).toFixed(1);
    if (gui.recStatus) gui.recStatus.textContent = `REC • ${samples} • ${hz} Hz`;

    const playingCount = tracks.filter((t) => t._play.playing && !t._play.paused).length;
    if (gui.info) gui.info.textContent = `recordState=${recordState} • playState=${playState} • tracks=${tracks.length} • playing=${playingCount}`;
  }

  /* ---------- Main RAF ---------- */
  function mainRAF() {
    requestAnimationFrame(mainRAF);
    const t = now();
    const dt = clamp(t - lastMainT, 0, MAX_DT_CAP);
    lastMainT = t;

    if (recordState === 'RECORDING' && currentRec) {
      recordFixedStep(currentRec, dt);
    }

    for (const tr of tracks) {
      if (!tr._play?.playing || tr._play.paused) continue;
      playbackFixedStep(tr, dt);
    }

    updatePlayState();
    if (guiWin && !guiWin.closed) updateLiveStatus();
  }

  /* ---------- Boot ---------- */
  loadRecorderPrefs();
  loadFromLocalStorage();
  initEmbeddedUi();
  requestAnimationFrame(mainRAF);
})();