// ==UserScript==
// @name         GeoFS Flight Recorder
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      1.1.3
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

  function catmullRom3(p0, p1, p2, p3, t, out) {
    const t2 = t * t;
    const t3 = t2 * t;
    out[0] = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
    out[1] = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    out[2] = 0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3);
    return out;
  }

  /* ---------- Config ---------- */
  const VERSION = '1.1.3';
  const LS_KEY = 'FlightRecorder100';
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
  let planeSplineOn = true;
  let ultraStrength = 35; // 0..100
  let animDebugOn = false;
  let animDebugLastLogT = 0;
  const ANIM_DEBUG_LOG_EVERY_MS = 2000;

  const animDebugStats = {
    startedAt: 0,
    frames: 0,
    lastTrack: '',
    lastIndex: 0,
    lastState: null,
    lastReport: null,
    methods: Object.create(null),
    errors: Object.create(null),
    probe: null
  };

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

  function animDbgReset() {
    animDebugStats.startedAt = now();
    animDebugStats.frames = 0;
    animDebugStats.lastTrack = '';
    animDebugStats.lastIndex = 0;
    animDebugStats.lastState = null;
    animDebugStats.lastReport = null;
    animDebugStats.methods = Object.create(null);
    animDebugStats.errors = Object.create(null);
    animDebugStats.probe = null;
    animDebugLastLogT = 0;
  }

  function animDbgCount(map, key, add = 1) {
    map[key] = (map[key] || 0) + add;
  }

  function animDbgError(where, e) {
    if (!animDebugOn) return;
    const msg = `${where}: ${String(e?.message || e || 'unknown')}`;
    animDbgCount(animDebugStats.errors, msg, 1);
  }

  /* ---------- Track helpers ---------- */
  function makeTrackBase(ac, sampleMs) {
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
      vaCache: Object.create(null)
    };
  }

  function buildProject() {
    return {
      version: VERSION,
      tracks: tracks.map((t) => ({
        orderId: t.orderId,
        id: t.id,
        name: t.name,
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
  function isGlobalLikeNodeName(name) {
    const s = String(name || '').toLowerCase();
    return s.includes('root') || s.includes('body') || s.includes('fuselage') || s.includes('aircraft') || s.includes('plane');
  }

  function shouldTrackToken(name) {
    const low = String(name || '').toLowerCase();
    return TOKENS.some((t) => low.includes(t));
  }

  function matrixFromNode(node) {
    const m = node?.matrix || node?._matrix;
    if (!m) return null;
    const out = new Array(16);
    for (let i = 0; i < 16; i++) out[i] = Number(m[i]);
    return out;
  }

  function matrixChanged(a16, b16, eps = EPS) {
    if (!a16 || !b16) return true;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(a16[i] - b16[i]) > eps) return true;
    }
    return false;
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

  function animChanged(a, b, eps = 1e-3) {
    if (!a || !b) return true;
    for (const k of ['gear', 'flaps', 'spoilers', 'airbrake']) {
      const va = a[k];
      const vb = b[k];
      if (va == null && vb == null) continue;
      if (va == null || vb == null) return true;
      if (Math.abs(Number(va) - Number(vb)) > eps) return true;
    }
    return false;
  }

  function blendAnimState(a, b, f) {
    const aa = a || {};
    const bb = b || aa;
    const out = {};
    for (const k of ['gear', 'flaps', 'spoilers', 'airbrake']) {
      const va = aa[k];
      const vb = bb[k];
      if (va == null && vb == null) continue;
      if (va == null) out[k] = vb;
      else if (vb == null) out[k] = va;
      else out[k] = lerp(va, vb, f);
    }
    return out;
  }

  function probeActiveGhost(track) {
    const g = track?._ghost;
    if (!g) return null;
    const targets = [
      ['ghost', g],
      ['ghost._model', g._model],
      ['ghost.object3d', g.object3d],
      ['ghost._entity', g._entity]
    ];
    const out = [];
    for (const [name, tgt] of targets) {
      if (!tgt) continue;
      let keys = [];
      try { keys = Object.keys(tgt).slice(0, 80); } catch { }
      out.push({
        name,
        hasSetAnimationValues: typeof tgt.setAnimationValues === 'function',
        hasSetAnimationValue: typeof tgt.setAnimationValue === 'function',
        hasSetAnimations: typeof tgt.setAnimations === 'function',
        hasApplyAnimationValues: typeof tgt.applyAnimationValues === 'function',
        hasControlsObject: !!tgt.controls,
        hasAnimationValuesObject: !!tgt.animationValues,
        hasAnimationsObject: !!tgt.animations,
        sampleKeys: keys
      });
    }
    return out;
  }

  function hasDirectAnimSupport(probe) {
    if (!Array.isArray(probe)) return false;
    return probe.some((p) => (
      p?.hasSetAnimationValues ||
      p?.hasSetAnimationValue ||
      p?.hasSetAnimations ||
      p?.hasApplyAnimationValues ||
      p?.hasControlsObject ||
      p?.hasAnimationValuesObject ||
      p?.hasAnimationsObject
    ));
  }

  function printAnimDebugReport() {
    const toLines = (obj) => {
      if (!obj || typeof obj !== 'object') return ['(none)'];
      const keys = Object.keys(obj);
      if (!keys.length) return ['(none)'];
      return keys.sort().map((k) => `${k}=${obj[k]}`);
    };

    const probeLines = (probe) => {
      if (!Array.isArray(probe) || !probe.length) return ['(none)'];
      const lines = [];
      for (const p of probe) {
        lines.push(
          `${p.name} | setAnimationValues=${!!p.hasSetAnimationValues} | setAnimationValue=${!!p.hasSetAnimationValue} | setAnimations=${!!p.hasSetAnimations} | applyAnimationValues=${!!p.hasApplyAnimationValues} | controls=${!!p.hasControlsObject} | animationValues=${!!p.hasAnimationValuesObject} | animations=${!!p.hasAnimationsObject}`
        );
      }
      return lines;
    };

    const elapsed = Math.max(0, now() - (animDebugStats.startedAt || now()));
    const text = [
      '=== FR098 Animation Debug Report ===',
      `elapsedMs=${Math.round(elapsed)}`,
      `frames=${animDebugStats.frames}`,
      `lastTrack=${animDebugStats.lastTrack || ''}`,
      `lastIndex=${animDebugStats.lastIndex}`,
      `lastState=${JSON.stringify(animDebugStats.lastState || {})}`,
      `lastReport=${JSON.stringify(animDebugStats.lastReport || {})}`,
      'methodCounts:',
      ...toLines(animDebugStats.methods).map((x) => `  ${x}`),
      'errorCounts:',
      ...toLines(animDebugStats.errors).map((x) => `  ${x}`),
      'probe:',
      ...probeLines(animDebugStats.probe).map((x) => `  ${x}`),
      '=== /FR098 Animation Debug Report ==='
    ].join('\n');

    return text;
  }

  function applyAnimFallback(track, state) {
    const g = track?._ghost;
    if (!g || !state) return null;
    const targets = [g, g._model, g.object3d, g._entity].filter(Boolean);
    const report = {
      setAnimationValues: 0,
      setAnimationValue: 0,
      setAnimations: 0,
      applyAnimationValues: 0,
      assignAnimationValues: 0,
      assignAnimations: 0,
      assignControls: 0,
      assignKnownFields: 0,
      errors: 0
    };

    const aliases = {
      gear: ['gear', 'landingGear', 'gearPosition', 'landing_gear'],
      flaps: ['flaps', 'flapsValue', 'flapsPosition', 'flaps_value'],
      spoilers: ['spoilers', 'spoiler', 'spoilersPosition'],
      airbrake: ['airbrake', 'airBrake', 'airbrakes']
    };

    for (const tgt of targets) {
      try {
        if (typeof tgt.setAnimationValues === 'function') {
          tgt.setAnimationValues(state);
          report.setAnimationValues++;
        }
      } catch (e) { report.errors++; animDbgError('setAnimationValues', e); }
      try {
        if (typeof tgt.setAnimationValue === 'function') {
          for (const [k, v] of Object.entries(state)) {
            if (v != null) {
              tgt.setAnimationValue(k, v);
              report.setAnimationValue++;
            }
          }
        }
      } catch (e) { report.errors++; animDbgError('setAnimationValue', e); }
      try {
        if (typeof tgt.setAnimations === 'function') {
          tgt.setAnimations(state);
          report.setAnimations++;
        }
      } catch (e) { report.errors++; animDbgError('setAnimations', e); }
      try {
        if (typeof tgt.applyAnimationValues === 'function') {
          tgt.applyAnimationValues(state);
          report.applyAnimationValues++;
        }
      } catch (e) { report.errors++; animDbgError('applyAnimationValues', e); }
      try {
        if (tgt.animationValues && typeof tgt.animationValues === 'object') {
          Object.assign(tgt.animationValues, state);
          report.assignAnimationValues++;
        }
      } catch (e) { report.errors++; animDbgError('assign animationValues', e); }
      try {
        if (tgt.animations && typeof tgt.animations === 'object') {
          Object.assign(tgt.animations, state);
          report.assignAnimations++;
        }
      } catch (e) { report.errors++; animDbgError('assign animations', e); }

      try {
        if (tgt.controls && typeof tgt.controls === 'object') {
          for (const [k, v] of Object.entries(state)) {
            if (v != null) {
              tgt.controls[k] = v;
              report.assignControls++;
            }
          }
        }
      } catch (e) { report.errors++; animDbgError('assign controls', e); }

      try {
        for (const [baseKey, names] of Object.entries(aliases)) {
          const v = state[baseKey];
          if (v == null) continue;
          for (const nm of names) {
            if (nm in tgt) {
              tgt[nm] = v;
              report.assignKnownFields++;
            }
          }
          if (tgt.animationValues && typeof tgt.animationValues === 'object') {
            for (const nm of names) {
              tgt.animationValues[nm] = v;
              report.assignKnownFields++;
            }
          }
          if (tgt.animations && typeof tgt.animations === 'object') {
            for (const nm of names) {
              tgt.animations[nm] = v;
              report.assignKnownFields++;
            }
          }
        }
      } catch (e) { report.errors++; animDbgError('assign aliases', e); }
    }

    if (animDebugOn) {
      for (const [k, v] of Object.entries(report)) animDbgCount(animDebugStats.methods, k, v);
    }

    return report;
  }

  function applyMatrix(node, mat16) {
    try {
      if (!node || !mat16 || mat16.length !== 16) return;
      const writeField = (obj, key) => {
        if (!obj || !(key in obj)) return;
        const cur = obj[key];
        if (cur && typeof cur.length === 'number' && cur.length >= 16) {
          for (let i = 0; i < 16; i++) cur[i] = mat16[i];
        } else if (window.Cesium?.Matrix4?.fromArray) {
          obj[key] = window.Cesium.Matrix4.fromArray(mat16);
        } else {
          obj[key] = mat16;
        }
      };

      const targets = [
        node,
        node.node,
        node.runtimeNode,
        node._runtimeNode,
        node.transformNode,
        node._transformNode
      ].filter(Boolean);

      const fields = [
        'matrix', '_matrix',
        'localMatrix', '_localMatrix',
        'transform', '_transform',
        'computedMatrix', '_computedMatrix',
        'modelMatrix', '_modelMatrix'
      ];

      for (const t of targets) {
        for (const f of fields) writeField(t, f);
        if (typeof t.setMatrix === 'function') {
          try { t.setMatrix(mat16); } catch { }
        }
        if (typeof t.setLocalMatrix === 'function') {
          try { t.setLocalMatrix(mat16); } catch { }
        }
        if ('matrixDirty' in t) t.matrixDirty = true;
        if ('_matrixDirty' in t) t._matrixDirty = true;
      }
    } catch {
      // no-op
    }
  }

  function setForcedGearMatrices(track, nodes, stateMap) {
    if (!track) return;
    const mats = new Map();
    for (const name of nodes || []) {
      const m = stateMap?.get?.(name);
      if (m) mats.set(name, m);
    }
    track._forcedGear = {
      enabled: mats.size > 0,
      nodes: [...mats.keys()],
      mats
    };
  }

  function clearForcedGearMatrices(track) {
    if (!track) return;
    track._forcedGear = { enabled: false, nodes: [], mats: new Map() };
  }

  function applyForcedGearMatrices(track) {
    const fg = track?._forcedGear;
    if (!fg?.enabled || !fg.nodes?.length) return;
    if (!track?._ghost?._model?.ready) return;
    if (!track._nodeCache?.size) buildNodeCache(track);
    for (const name of fg.nodes) {
      const node = track._nodeCache.get(name);
      const mat = fg.mats.get(name);
      if (!node || !mat) continue;
      applyMatrix(node, mat);
      track._lastApplied.set(name, mat);
    }
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

    for (const p of parts) {
      const nm = String(p?.name || p?.node || '');
      if (!nm) continue;
      const node = getNode(model, nm);
      if (!node) continue;
      all.push(node);
      const low = nm.toLowerCase();
      if (low.includes('ladder') || low.includes('stairs') || low.includes('boarding')) ladder.push(node);
      if (low.includes('door') || low.includes('hatch') || low.includes('bay')) doors.push(node);
      if (low.includes('wheel') || low.includes('bogie') || low.includes('truck') || low.includes('tire') || low.includes('tyre')) wheels.push(node);
      if (low.includes('gear') || low.includes('strut') || low.includes('oleo') || low.includes('shock')) gear.push(node);
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
      hideLadderNodes(track);
    } else {
      setCategoryVisible(track, 'doors', true);
      setCategoryVisible(track, 'gear', true);
      setCategoryVisible(track, 'wheels', true);
      hideLadderNodes(track);
    }
  }

  function readGearUp(ac) {
    const s = readAnimState(ac);
    const g = Number(s?.gear);
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

  function liveryAtIndex(track, idx) {
    const ev = track?.liveryEvents || [];
    let current = null;
    for (let i = 0; i < ev.length; i++) {
      if ((ev[i]?.t ?? -1) > idx) break;
      current = cloneLiveryId(ev[i]?.id ?? null);
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

  function changeGhostModelTexture(track, textureUrl, index) {
    const ghost = track?._ghost;
    const model = ghost?._model;
    if (!ghost || !model || !textureUrl || !Number.isFinite(Number(index))) return;

    const rendererTex = model?._rendererResources?.textures?.[index];
    const width = Number(rendererTex?._width) || 0;
    const height = Number(rendererTex?._height) || 0;

    // Use per-instance texture path (same strategy as LiverySelector multiplayer)
    // so we don't mutate shared model textures used by the player's own aircraft.
    Cesium.Resource.fetchImage({ url: textureUrl })
      .then((img) => {
        const canvas = document.createElement('canvas');
        canvas.width = width || img.width || 1024;
        canvas.height = height || img.height || 1024;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');

        try {
          if (typeof ghost.changeTexture === 'function') {
            ghost.changeTexture(dataUrl, { index });
            return;
          }
        } catch {
          // fallback below
        }

        try {
          if (typeof model.changeTexture === 'function') {
            model.changeTexture(dataUrl, { index });
            return;
          }
        } catch {
          // fallback below
        }
      })
      .catch(() => {
        // ignore remote texture fetch errors
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

  async function applyTrackLivery(track, liveryId) {
    if (!track?._ghost?._model?.ready) return;
    const entry = getLiverySelectorAircraftEntry(track);
    if (!entry) return;

    let livery = null;
    if (typeof liveryId === 'object' && liveryId) {
      const va = await getVALivery(track, liveryId);
      livery = va?.livery || null;
    } else {
      const idNum = Number(liveryId);
      if (!Number.isFinite(idNum)) return;
      const idx = idNum >= LIVERY_ID_OFFSET ? idNum - LIVERY_ID_OFFSET : idNum;
      livery = entry?.liveries?.[idx] || null;
    }
    if (!livery) return;

    const parts = Array.isArray(entry.parts) ? entry.parts : [];
    const indices = Array.isArray(entry.index) ? entry.index : [];
    const textures = Array.isArray(livery.texture) ? livery.texture : [];
    const mats = livery.materials || {};
    const model = track._ghost._model;

    for (let i = 0; i < textures.length; i++) {
      const tx = textures[i];
      if (tx && typeof tx === 'object' && tx.material != null) {
        const mat = mats?.[tx.material];
        if (mat) applyGhostMaterial(model, mat);
        continue;
      }
      if (typeof tx !== 'string' || !tx) continue;
      const modelIndex = Number(indices[i]);
      if (!Number.isFinite(modelIndex)) continue;
      changeGhostModelTexture(track, tx, modelIndex);
    }
  }

  function requestApplyTrackLivery(track, liveryId) {
    if (!track?._livery || track._livery.applying) return;
    track._livery.applying = true;
    Promise.resolve(applyTrackLivery(track, liveryId))
      .catch(() => { })
      .finally(() => {
        if (track?._livery) track._livery.applying = false;
      });
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

  function warmupTrackNodes(track, liveModel, dtStep) {
    const rec = track._rec;
    rec.warmAcc += dtStep;
    if (rec.warmAcc < DISCOVERY_STEP_MS) return;
    rec.warmAcc = 0;

    const dynamicNames = collectModelNodeNames(liveModel);
    if (dynamicNames.length) {
      const warmSet = new Set(rec.warmNames);
      for (const n of dynamicNames) {
        if (isLadderName(n)) continue;
        if (track._nodeNameSet.has(n)) continue;
        if (!warmSet.has(n)) {
          rec.warmNames.push(n);
          warmSet.add(n);
        }
      }
    }

    for (const name of rec.warmNames) {
      const node = getNode(liveModel, name);
      if (!node || isLadderName(name)) continue;
      const mat = matrixFromNode(node);
      if (!mat) continue;

      const prev = rec.warmPrev.get(name);
      if (prev && matrixChanged(mat, prev)) {
        if (!track._nodeNameSet.has(name)) {
          track._nodeNameSet.add(name);
          track._nodeNames.push(name);
        }
      }
      rec.warmPrev.set(name, mat);
    }
  }

  function startRecordingInternal(t0) {
    const ac = geofs?.aircraft?.instance;
    if (!ac) return alert('No active aircraft.');
    const modelUrl = ac?.object3d?.model?._model?._resource?.url;
    if (!modelUrl) return alert('No model URL found.');

    const tr = makeTrackBase(ac, defaultSampleMs);
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
    tr._rec.lastLiverySig = liverySig(initialLivery);
    tr.liveryEvents.push({ t: 0, id: initialLivery });

    currentRec = tr;
    recordState = 'RECORDING';
    updateUi();
  }

  function startRecording() {
    if (!canStartRecording()) return;
    startRecordingInternal(now());
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

  function getStoredDeltaStats(track) {
    const gearChanges = (track?.gearEvents || []).length;
    return { frames: gearChanges, nodeWrites: 0, topNodes: '-', topNonWheel: '-' };
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

      const liveryNow = readCurrentLiveryId(ac);
      const sigNow = liverySig(liveryNow);
      if (rec.lastLiverySig == null || rec.lastLiverySig !== sigNow) {
        track.liveryEvents.push({ t: rec.sampleCount, id: liveryNow });
        rec.lastLiverySig = sigNow;
      }

      rec.sampleCount++;
    }
  }

  /* ---------- Playback ---------- */
  function canStartPlayback() {
    return recordState === 'IDLE' && playState === 'IDLE';
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

  function resetDeltaCursor(track) {
    track._play.deltaCursor = { b: 0, s: 0, next: null };
    advanceDeltaCursor(track);
  }

  function advanceDeltaCursor(track) {
    const c = track._play.deltaCursor;
    while (c.b < track.blocks.length) {
      const blk = track.blocks[c.b] || [];
      if (c.s < blk.length) {
        c.next = blk[c.s];
        return;
      }
      c.b++;
      c.s = 0;
    }
    c.next = null;
  }

  function applyDeltasUntil(track, idx) {
    const c = track._play.deltaCursor;
    while (c.next && c.next.t <= idx) {
      const delta = c.next;
      const changes = delta.m || {};

      if (!track._nodeCache?.size) buildNodeCache(track);

      for (const nodeName of Object.keys(changes)) {
        if (isLadderName(nodeName)) continue;
        const node = track._nodeCache.get(nodeName);
        if (!node) continue;
        const mat = changes[nodeName];
        applyMatrix(node, mat);
        track._lastApplied.set(nodeName, mat);
      }

      c.s++;
      advanceDeltaCursor(track);
    }
  }

  function applyLastMatrices(track) {
    if (!track._nodeCache?.size) buildNodeCache(track);
    for (const [nodeName, mat] of track._lastApplied) {
      const node = track._nodeCache.get(nodeName);
      if (!node) continue;
      applyMatrix(node, mat);
    }
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
  }

  function poseAt(track, i1, i2, f, dt) {
    const idxFloat = i1 + clamp(f, 0, 1);
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
      track._livery.lastSig = null;
      track._livery.applying = false;
    }
    updatePlayState();
  }

  function startPlayback(track) {
    if (!canStartPlayback()) return;
    startPlaybackInternal(track, now());
    updateUi();
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
    track._ghost = null;
    track._nodeCache = { ready: false, all: [], gear: [], wheels: [], doors: [], ladder: [] };
    track._lastGearUp = null;
    if (track._livery) {
      track._livery.lastSig = null;
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

    const liveryNow = liveryAtIndex(track, i1);
    const sigNow = liverySig(liveryNow);
    if (track._livery && track._livery.lastSig !== sigNow) {
      track._livery.lastSig = sigNow;
      requestApplyTrackLivery(track, liveryNow);
    }

    const upNow = gearUpAtIndex(track, i1);
    if (track._lastGearUp == null || track._lastGearUp !== upNow) {
      applyGearState(track, upNow);
      track._lastGearUp = upNow;
    }
    hideLadderNodes(track);

    if (i1 >= last) {
      p.paused = true;
    }
  }

  function applyTrackAtIndex(track, idx) {
    if (!track?._ghost?._model?.ready) return false;
    const last = (track.lla?.length || 0) - 1;
    if (last < 0) return false;

    const targetIdx = clamp(Math.floor(idx), 0, last);
    if (!track._nodeCache?.size) buildNodeCache(track);

    if (track._play?.idx > targetIdx) {
      track._lastApplied = new Map();
      resetDeltaCursor(track);
    }

    applyDeltasUntil(track, targetIdx);

    const i1 = targetIdx;
    const i2 = clamp(i1 + 1, 0, last);
    const pose = poseAt(track, i1, i2, 0, 16);
    if (pose?.lla && pose?.htr) {
      setGhostPose(track, pose.lla, pose.htr);
    }

    applyLastMatrices(track);
    hideLadderNodes(track);
    if (track._play) track._play.idx = targetIdx;
    return true;
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
  function applyGearStateFromSample(track, sampleIdx) {
    if (!track?._ghost?._model?.ready) return false;
    const idx = clamp(Math.floor(sampleIdx), 0, Math.max(0, (track?.lla?.length || 1) - 1));

    if (!track._gearProfile) track._gearProfile = buildGearProfile(track);
    const nodes = track?._gearProfile?.nodes || [];
    if (!nodes.length) return false;

    if (!track._nodeCache?.size) buildNodeCache(track);

    const state = buildMatrixStateAt(track, idx);
    setForcedGearMatrices(track, nodes, state);
    let cacheHits = 0;
    let appliedNow = 0;
    for (const name of nodes) {
      const mat = state.get(name);
      if (!mat) continue;
      const node = track._nodeCache.get(name);
      if (!node) continue;
      cacheHits++;
      applyMatrix(node, mat);
      appliedNow++;
      track._lastApplied.set(name, mat);
    }

    hideLadderNodes(track);
    return { ok: true, cacheHits, appliedNow, forcedNodes: track._forcedGear?.nodes?.length || 0 };
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

  function buildGearProfile(track) {
    if (!track?.blocks?.length) return null;

    const targets = [0, 0.5, 1];
    const keyframes = [];
    for (const t of targets) {
      const m = findClosestGearSampleIndex(track, t);
      if (m.idx < 0) continue;
      keyframes.push({
        gear: t,
        idx: m.idx,
        err: m.err,
        state: buildMatrixStateAt(track, m.idx)
      });
    }
    if (!keyframes.length) return null;

    // Use in/out diff to determine meaningful candidate nodes.
    const inK = keyframes.find((k) => k.gear === 0) || keyframes[0];
    const outK = keyframes.find((k) => k.gear === 1) || keyframes[keyframes.length - 1];
    const names = new Set([...(inK?.state?.keys?.() || []), ...(outK?.state?.keys?.() || [])]);
    const strictNodes = [];
    const relaxedNodes = [];
    for (const n of names) {
      if (isLadderName(n) || isNoiseNodeName(n)) continue;
      if (isGlobalLikeNodeName(n)) continue;
      if (!isGearCandidateName(n)) continue;
      const score = matrixDiffScore(inK.state.get(n), outK.state.get(n));
      if (!Number.isFinite(score) || score <= EPS) continue;
      if (isStrictGearNodeName(n)) strictNodes.push({ name: n, score });
      else relaxedNodes.push({ name: n, score });
    }
    strictNodes.sort((a, b) => b.score - a.score);
    relaxedNodes.sort((a, b) => b.score - a.score);
    const nodes = strictNodes.length >= 3
      ? strictNodes
      : [...strictNodes, ...relaxedNodes];
    if (!nodes.length) return null;

    return {
      nodes: nodes.slice(0, 24).map((n) => n.name),
      keyframes
    };
  }

  function applyGearProfile(track, gearValue) {
    const profile = track?._gearProfile;
    if (!profile?.nodes?.length || !profile?.keyframes?.length) return;
    if (!track._nodeCache?.size) buildNodeCache(track);

    const g = clamp(Number(gearValue) || 0, 0, 1);
    let best = profile.keyframes[0];
    let bestErr = Math.abs(g - best.gear);
    for (const k of profile.keyframes) {
      const e = Math.abs(g - k.gear);
      if (e < bestErr) {
        best = k;
        bestErr = e;
      }
    }

    for (const name of profile.nodes) {
      const mat = best.state.get(name);
      if (!mat) continue;
      const node = track._nodeCache.get(name);
      if (!node) continue;
      applyMatrix(node, mat);
      track._lastApplied.set(name, mat);
    }
  }

  function analyzeGearNodes() {
    const active = tracks.find((t) => t._play?.playing && t._ghost?._model?.ready);
    if (!active) {
      alert('No active ghost playback. Start a playback first.');
      return;
    }

    const inMatch = findClosestGearSampleIndex(active, 0);
    const outMatch = findClosestGearSampleIndex(active, 1);
    if (inMatch.idx < 0 || outMatch.idx < 0) {
      alert('Could not find both gear-in and gear-out samples in this track.');
      return;
    }

    const inState = buildMatrixStateAt(active, inMatch.idx);
    const outState = buildMatrixStateAt(active, outMatch.idx);
    const names = new Set([...inState.keys(), ...outState.keys()]);
    const diffs = [];
    for (const n of names) {
      if (isLadderName(n) || isNoiseNodeName(n)) continue;
      const score = matrixDiffScore(inState.get(n), outState.get(n));
      if (!Number.isFinite(score) || score <= EPS) continue;
      diffs.push({ name: n, score });
    }
    diffs.sort((a, b) => b.score - a.score);
    const top = diffs.slice(0, 10);

    const summary = top.length
      ? top.map((x) => `${x.name}:${x.score.toFixed(4)}`).join(', ')
      : '(none)';

    gui.mtInfo.textContent = `Gear node analysis • inIdx=${inMatch.idx} outIdx=${outMatch.idx} • candidates=${top.length} • ${summary}`;
    const profile = buildGearProfile(active);
    active._gearProfile = profile;
    if (profile?.nodes?.length) {
      gui.mtInfo.textContent += ` • profileNodes=${profile.nodes.length} • profileKeys=${profile.keyframes.length}`;
    }
  }

  /* ---------- Storage ---------- */
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

  function startFormationSelected() {
    if (!(recordState === 'IDLE' && playState === 'IDLE')) return;
    const selected = getSelectedTracks();
    if (!selected.length) return alert('Select at least one track.');
    const t0 = now();
    for (const tr of selected) startPlaybackAt(tr, t0);
    updateUi();
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

  function deleteTrack(id) {
    const idx = tracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    stopPlayback(tracks[idx]);
    tracks.splice(idx, 1);
    saveToLocalStorage();
    updateUi();
  }

  /* ---------- UI ---------- */
  function openGui() {
    if (guiWin && !guiWin.closed) {
      guiWin.focus();
      return;
    }

    guiWin = window.open('', '_blank', 'width=980,height=820');
    guiWin.document.title = `Flight Recorder ${VERSION}`;
    guiWin.document.body.innerHTML = `
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
          <div id="recStatus" style="text-align:center; color:#777; margin-top:10px; font-size:14px;">REC • 0 • ${(1000 / defaultSampleMs).toFixed(1)} Hz</div>
          <div id="recHint" style="text-align:center; color:#777; margin-top:4px; min-height:18px;"></div>
        </fieldset>

        <fieldset style="margin-bottom:10px;">
          <legend>Playback</legend>
          <div style="margin-bottom:10px; display:flex; justify-content:center; gap:14px; flex-wrap:wrap; align-items:center;">
            <button id="playSelBtn" title="Play selected" style="width:62px; height:62px; border-radius:50%; border:1px solid #0a7f2e; background:#16a34a; color:#fff; font-size:26px; font-weight:700; cursor:pointer;">▶</button>
            <button id="pauseSelBtn" title="Pause selected" style="width:62px; height:62px; border-radius:50%; border:1px solid #0a4f97; background:#2563eb; color:#fff; font-size:24px; font-weight:700; cursor:pointer;">❚❚</button>
            <button id="stopSelBtn" title="Stop selected" style="width:62px; height:62px; border-radius:50%; border:1px solid #991b1b; background:#dc2626; color:#fff; font-size:22px; font-weight:700; cursor:pointer;">■</button>
          </div>
          <div style="text-align:center; color:#555; margin-bottom:10px;">
            <label for="ultraStrength">Smoothing</label>
            <input id="ultraStrength" type="range" min="0" max="100" step="1" value="${ultraStrength}" style="width:220px; vertical-align:middle;">
            <span id="ultraStrengthVal">${ultraStrength}</span>
          </div>
          <div style="margin-bottom:6px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center;">
            <button id="saveBtn">Save (to Browser)</button>
            <button id="loadBtn">Load (from Browser)</button>
            <button id="exportBtn">Export JSON</button>
            <button id="importBtn">Import JSON</button>
            <input type="file" id="importFile" accept="application/json" style="display:none;">
          </div>
          <small style="display:block; color:#555; text-align:center; margin-bottom:8px;">
            <b>Save/Load</b> = local browser storage on this PC.<br>
            <b>Export/Import</b> = JSON file backup/share.
          </small>
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

    gui.recBtn = guiWin.document.getElementById('recBtn');
    gui.rateSel = guiWin.document.getElementById('rateSel');
    gui.recStatus = guiWin.document.getElementById('recStatus');
    gui.recHint = guiWin.document.getElementById('recHint');
    gui.ultraStrength = guiWin.document.getElementById('ultraStrength');
    gui.ultraStrengthVal = guiWin.document.getElementById('ultraStrengthVal');
    gui.playSelBtn = guiWin.document.getElementById('playSelBtn');
    gui.pauseSelBtn = guiWin.document.getElementById('pauseSelBtn');
    gui.stopSelBtn = guiWin.document.getElementById('stopSelBtn');
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
    gui.rateSel.onchange = (e) => {
      defaultSampleMs = Number(e.target.value) || 16;
      updateLiveStatus();
    };
    gui.ultraStrength.value = String(ultraStrength);
    gui.ultraStrengthVal.textContent = String(ultraStrength);
    gui.ultraStrength.oninput = (e) => {
      ultraStrength = clamp(Number(e.target.value) || 0, 0, 100);
      for (const tr of tracks) {
        tr._precision = null;
      }
      gui.ultraStrengthVal.textContent = String(ultraStrength);
    };

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
      const checked = previousSelected.has(t.id) ? 'checked' : '';
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
            <div style="width:min(720px, 95%);">
              <textarea class="descIn" data-id="${escapeHtml(t.id)}" rows="3" placeholder="Description" style="width:100%; box-sizing:border-box; resize:vertical;">${escapeHtml(t.description || '')}</textarea>
            </div>
          </div>
          <div style="display:flex; justify-content:center; margin-bottom:8px;">
            <span style="color:#666; text-align:center; width:min(720px, 95%); overflow-wrap:anywhere;">• ID: #${orderLabel} • Date: ${escapeHtml(recDate)} • Duration: ${seconds}s • Rate: ${rateHz} Hz • Gear changes: ${gearChanges}<br>• Model: ${escapeHtml(t.modelUrl || '-')}</span>
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

  function updateUi() {
    if (!guiWin || guiWin.closed) return;

    const recActive = recordState === 'RECORDING';
    gui.recBtn.textContent = recActive ? 'STOP RECORDING' : 'START RECORDING';
    gui.recBtn.style.background = recActive ? '#0b5ed7' : '#c92a2a';

    const canRec = recordState === 'IDLE';
    const canPlay = recordState === 'IDLE' && playState === 'IDLE';

    if (!recActive) gui.recBtn.disabled = !canRec;
    else gui.recBtn.disabled = false;

    gui.playSelBtn.disabled = !canRec;
    if (gui.pauseSelBtn) gui.pauseSelBtn.disabled = !canRec;
    if (gui.stopSelBtn) gui.stopSelBtn.disabled = !canRec;
    if (gui.ultraStrength) {
      gui.ultraStrength.value = String(ultraStrength);
    }
    if (gui.ultraStrengthVal) gui.ultraStrengthVal.textContent = String(ultraStrength);
    if (gui.rateSel) gui.rateSel.value = String(defaultSampleMs);

    renderFlightsList();
    updateLiveStatus();
  }

  function updateLiveStatus() {
    if (!guiWin || guiWin.closed) return;
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
  function addLauncherButton() {
    const b = document.createElement('button');
    b.textContent = `Flight Recorder ${VERSION}`;
    b.style.cssText = 'position:absolute;top:20px;right:20px;padding:6px 10px;z-index:999999;cursor:pointer;';
    b.onclick = openGui;
    document.body.appendChild(b);
  }

  loadFromLocalStorage();
  addLauncherButton();
  requestAnimationFrame(mainRAF);
})();