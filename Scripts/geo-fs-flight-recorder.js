// ==UserScript==
// @name         GeoFS Flight Recorder - BETA
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      0.9.8
// @description  Record and replay GeoFS flights with smooth pose + delta-compressed matrix animation playback.
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
  const lowpassAngleDeg = (current, target, alpha) => current + angleDeltaDeg(current, target) * alpha;
  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  const VERSION = '0.9.8';
  const LS_KEY = 'FlightRecorder098';
  const MAX_DT_CAP = 120;
  const MAX_STEPS = 10;
  const MAX_RECORD_STEPS_PER_FRAME = 800;
  const EPS = 1e-6;
  const BLOCK_SIZE = 3000;
  const WARMUP_MS = 2500;
  const WARMUP_STEP_MS = 100;
  const TOKENS = [
    'gear', 'door', 'flap', 'slat', 'aileron', 'elevator', 'rudder',
    'brake', 'airbrake', 'canopy', 'hook', 'piston', 'leg', 'suspension',
    'wheel', 'bogie', 'truck', 'hatch', 'bay', 'oleo', 'shock', 'ladder', 'ladderdoor'
  ];

  let defaultSampleMs = 16; // 60 Hz
  let easingOn = false;
  let planeSplineOn = true;
  let motionSmoothOn = true;
  let motionTauMs = 120;
  let ultraSmoothOn = false;
  let ultraStrength = 35; // 0..100
  let ultraTauMs = 80 + ultraStrength * 4;

  /* ---------- State machines ---------- */
  let recordState = 'IDLE'; // IDLE | RECORDING
  let playState = 'IDLE';   // IDLE | PLAYING

  /* ---------- Runtime ---------- */
  let tracks = [];
  let currentRec = null; // draft, hidden from list until stop
  let lastMainT = now();

  let guiWin = null;
  const gui = {};

  /* ---------- Track helpers ---------- */
  function makeTrackBase(ac, sampleMs) {
    const id = `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const lat0 = ac.llaLocation[0];
    const lon0 = ac.llaLocation[1];
    const m = metersPerDeg(lat0);
    const modelUrl = ac?.object3d?.model?._model?._resource?.url;
    return {
      id,
      name: `${ac.aircraftRecord?.name || 'Unknown'} ${id.slice(-4)}`,
      modelUrl,
      sampleMs,
      base: { lat0, lon0, mLat: m.mLat, mLon: m.mLon },
      lla: [],
      htr: [],
      xy: [],
      anim: [],
      blocks: []
    };
  }

  function initTrackRuntime(tr) {
    tr._ghost = null;
    tr._nodeNames = Array.isArray(tr._nodeNames) ? tr._nodeNames : [];
    tr._nodeNameSet = new Set(tr._nodeNames);
    tr._nodeCache = new Map();
    tr._ladderNodes = [];
    tr._lastApplied = new Map();
    tr._smooth = { xy: null };
    tr._ultra = { lla: null, htr: null };
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
      acc: 0,
      idx: 0,
      startT: now(),
      lastT: now(),
      deltaCursor: { b: 0, s: 0, next: null }
    };
    tr._rec = {
      recording: false,
      acc: 0,
      lastT: now(),
      sampleCount: tr.lla.length,
      targetSamples: tr.lla.length,
      blockSampleCounter: 0,
      currBlock: [],
      startT: 0,
      prevMatrices: new Map(),
      warmNames: [],
      warmPrev: new Map(),
      warmAcc: 0
    };
  }

  function buildProject() {
    return {
      version: VERSION,
      tracks: tracks.map((t) => ({
        id: t.id,
        name: t.name,
        modelUrl: t.modelUrl,
        sampleMs: t.sampleMs,
        base: t.base,
        lla: t.lla,
        htr: t.htr,
        xy: t.xy,
        anim: t.anim || [],
        blocks: t.blocks,
        _nodeNames: t._nodeNames || []
      }))
    };
  }

  function updatePlayState() {
    playState = tracks.some((t) => t._play?.playing) ? 'PLAYING' : 'IDLE';
  }

  /* ---------- Node/matrix helpers ---------- */
  function getNode(model, name) {
    if (!model || !name) return null;
    try {
      return model.getNode(name) || model.getNode(String(name).toLowerCase()) || model.getNode(String(name).toUpperCase()) || null;
    } catch {
      return null;
    }
  }

  function isLadderName(name) {
    const low = String(name || '').toLowerCase();
    return low.includes('ladder');
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

  function applyAnimFallback(track, state) {
    const g = track?._ghost;
    if (!g || !state) return;
    const targets = [g, g._model, g.object3d, g._entity].filter(Boolean);

    for (const tgt of targets) {
      try {
        if (typeof tgt.setAnimationValues === 'function') tgt.setAnimationValues(state);
      } catch { }
      try {
        if (typeof tgt.setAnimationValue === 'function') {
          for (const [k, v] of Object.entries(state)) {
            if (v != null) tgt.setAnimationValue(k, v);
          }
        }
      } catch { }
      try {
        if (tgt.animationValues && typeof tgt.animationValues === 'object') {
          Object.assign(tgt.animationValues, state);
        }
      } catch { }
      try {
        if (tgt.animations && typeof tgt.animations === 'object') {
          Object.assign(tgt.animations, state);
        }
      } catch { }
    }
  }

  function applyMatrix(node, mat16) {
    try {
      if (!node || !mat16 || mat16.length !== 16) return;
      if (node.matrix && typeof node.matrix.length === 'number' && node.matrix.length >= 16) {
        for (let i = 0; i < 16; i++) node.matrix[i] = mat16[i];
      } else if (window.Cesium?.Matrix4?.fromArray) {
        node.matrix = window.Cesium.Matrix4.fromArray(mat16);
      } else {
        node.matrix = mat16;
      }
    } catch {
      // no-op
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
    const model = track._ghost._model;
    const names = track._nodeNames || [];
    track._nodeCache = new Map();
    track._ladderNodes = [];

    for (const name of names) {
      const node = getNode(model, name);
      if (node) track._nodeCache.set(name, node);
      if (isLadderName(name) && node) track._ladderNodes.push(node);
    }

    // Failsafe ladder lookup from parts
    const liveParts = geofs?.aircraft?.instance?.definition?.parts || [];
    for (const p of liveParts) {
      const nm = p?.name;
      if (!nm || !isLadderName(nm)) continue;
      const n = getNode(model, nm);
      if (n && !track._ladderNodes.includes(n)) track._ladderNodes.push(n);
    }

    return true;
  }

  function hideLadderNodes(track) {
    if (!track?._ghost?._model?.ready) return;
    if (!track._ladderNodes?.length) buildNodeCache(track);
    for (const n of track._ladderNodes || []) {
      try { n.show = false; } catch { }
    }
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

  function warmupTrackNodes(track, liveModel, dtStep) {
    const rec = track._rec;
    rec.warmAcc += dtStep;
    if (rec.warmAcc < WARMUP_STEP_MS) return;
    rec.warmAcc = 0;

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

    if (currentRec._rec.currBlock.length) currentRec.blocks.push(currentRec._rec.currBlock);
    currentRec._rec.currBlock = [];
    currentRec._rec.recording = false;

    const finalized = {
      id: currentRec.id,
      name: currentRec.name,
      modelUrl: currentRec.modelUrl,
      sampleMs: currentRec.sampleMs,
      base: currentRec.base,
      lla: currentRec.lla,
      htr: currentRec.htr,
      xy: currentRec.xy,
      anim: currentRec.anim,
      blocks: currentRec.blocks,
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
    const liveModel = ac?.object3d?.model?._model;
    const elapsedMs = Math.max(0, now() - rec.startT);
    const targetSamples = Math.floor(elapsedMs / Math.max(1, track.sampleMs)) + 1;
    rec.targetSamples = targetSamples;

    let steps = 0;
    while (rec.sampleCount < targetSamples && steps < MAX_RECORD_STEPS_PER_FRAME) {
      if ((now() - rec.startT) <= WARMUP_MS && liveModel) {
        warmupTrackNodes(track, liveModel, track.sampleMs);
      }

      const pose = readLivePose(ac, track.base);
      track.lla.push(pose.lla);
      track.htr.push(pose.htr);
      track.xy.push(pose.xy);
      track.anim.push(readAnimState(ac));

      const changed = {};
      if (liveModel) {
        for (const nodeName of track._nodeNames) {
          if (isLadderName(nodeName)) continue;
          const node = getNode(liveModel, nodeName);
          if (!node) continue;
          const mat = matrixFromNode(node);
          if (!mat) continue;
          const prev = rec.prevMatrices.get(nodeName);
          if (!prev || matrixChanged(mat, prev)) {
            changed[nodeName] = mat;
            rec.prevMatrices.set(nodeName, mat);
          }
        }
      }

      if (Object.keys(changed).length) {
        rec.currBlock.push({ t: rec.sampleCount, m: changed });
      }

      rec.sampleCount++;
      rec.blockSampleCounter++;
      if (rec.blockSampleCounter >= BLOCK_SIZE) {
        track.blocks.push(rec.currBlock);
        rec.currBlock = [];
        rec.blockSampleCounter = 0;
      }
      steps++;
    }

    // Failsafe: if the browser stalled too long, keep timeline aligned.
    if (rec.sampleCount < targetSamples) {
      rec.sampleCount = targetSamples;
    }
  }

  /* ---------- Playback ---------- */
  function canStartPlayback() {
    return recordState === 'IDLE' && playState === 'IDLE';
  }

  function spawnGhost(track) {
    if (!track?.lla?.length || !track?.htr?.length) return null;
    try {
      const ghost = new geofs.api.Model(null, {
        url: track.modelUrl,
        location: track.lla[0],
        rotation: track.htr[0]
      });
      track._ghost = ghost;
      return ghost;
    } catch (e) {
      console.warn('[FlightRecorder] ghost spawn failed', e);
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
    L[0] = lla[0]; L[1] = lla[1]; L[2] = lla[2];
    H[0] = htr[0]; H[1] = htr[1]; H[2] = htr[2];
    try { g.setPositionOrientationAndScale(L, H, null); } catch { }
  }

  function poseAt(track, i1, i2, f, dt) {
    const outL = track._pool.tmpA;
    const d = track.lla;
    const h = track.htr;

    let lat; let lon; let alt;
    if (planeSplineOn && track.xy?.length && track.base) {
      const get = (k) => track.xy[clamp(k, 0, track.xy.length - 1)] || track.xy[0];
      const p0 = get(i1 - 1);
      const p1 = get(i1);
      const p2 = get(i2);
      const p3 = get(i2 + 1);
      const c = track._pool.tmpB;
      catmullRom3(p0, p1, p2, p3, f, c);

      let X = c[0], Y = c[1], Z = c[2];
      const minX = Math.min(p1[0], p2[0]), maxX = Math.max(p1[0], p2[0]);
      const minY = Math.min(p1[1], p2[1]), maxY = Math.max(p1[1], p2[1]);
      const minZ = Math.min(p1[2], p2[2]), maxZ = Math.max(p1[2], p2[2]);
      X = clamp(X, minX, maxX);
      Y = clamp(Y, minY, maxY);
      Z = clamp(Z, minZ, maxZ);

      if (motionSmoothOn) {
        if (!track._smooth.xy) track._smooth.xy = [X, Y, Z];
        const alpha = 1 - Math.exp(-dt / Math.max(1, motionTauMs));
        track._smooth.xy[0] += alpha * (X - track._smooth.xy[0]);
        track._smooth.xy[1] += alpha * (Y - track._smooth.xy[1]);
        track._smooth.xy[2] += alpha * (Z - track._smooth.xy[2]);
        X = track._smooth.xy[0];
        Y = track._smooth.xy[1];
        Z = track._smooth.xy[2];
      }

      lat = track.base.lat0 + (Y / track.base.mLat);
      lon = track.base.lon0 + (X / track.base.mLon);
      alt = Z;
    } else {
      interpLLA(d[i1], d[i2], f, outL);
      lat = outL[0]; lon = outL[1]; alt = outL[2];
    }

    const hdg = lerpAngleDeg(h[i1][0], h[i2][0], f);
    const pit = lerpAngleDeg(h[i1][1], h[i2][1], f);
    const rol = lerpAngleDeg(h[i1][2], h[i2][2], f);

    if (ultraSmoothOn) {
      const alphaU = 1 - Math.exp(-dt / Math.max(1, ultraTauMs));

      if (!track._ultra.lla) track._ultra.lla = [lat, lon, alt];
      if (!track._ultra.htr) track._ultra.htr = [hdg, pit, rol];

      track._ultra.lla[0] += alphaU * (lat - track._ultra.lla[0]);
      const dLonU = angleDeltaDeg(track._ultra.lla[1], lon);
      track._ultra.lla[1] += alphaU * dLonU;
      track._ultra.lla[2] += alphaU * (alt - track._ultra.lla[2]);

      track._ultra.htr[0] = lowpassAngleDeg(track._ultra.htr[0], hdg, alphaU);
      track._ultra.htr[1] = lowpassAngleDeg(track._ultra.htr[1], pit, alphaU);
      track._ultra.htr[2] = lowpassAngleDeg(track._ultra.htr[2], rol, alphaU);

      return {
        lla: [track._ultra.lla[0], track._ultra.lla[1], track._ultra.lla[2]],
        htr: [track._ultra.htr[0], track._ultra.htr[1], track._ultra.htr[2]]
      };
    }

    return { lla: [lat, lon, alt], htr: [hdg, pit, rol] };
  }

  function startPlaybackInternal(track, t0) {
    if (!track || !track.lla?.length) return;

    if (!track._nodeNames?.length) {
      const ac = geofs?.aircraft?.instance;
      if (ac) {
        const detected = detectNodeNames(ac);
        track._nodeNames = [...detected.tokenNames];
        track._nodeNameSet = new Set(track._nodeNames);
      }
    }

    if (!track._ghost) spawnGhost(track);

    track._play.playing = true;
    track._play.paused = false;
    track._play.acc = 0;
    track._play.idx = 0;
    track._play.startT = t0;
    track._play.lastT = t0;
    track._smooth.xy = track.xy?.[0] ? [...track.xy[0]] : null;
    track._ultra.lla = null;
    track._ultra.htr = null;
    track._lastApplied = new Map();
    resetDeltaCursor(track);
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
    track._play.paused = !!paused;
    track._play.lastT = now();
    updateUi();
  }

  function stopPlayback(track) {
    if (!track?._play) return;
    track._play.playing = false;
    track._play.paused = true;
    track._play.acc = 0;
    track._play.idx = 0;
    if (track._ghost) {
      try { track._ghost.destroy(); } catch { }
    }
    track._ghost = null;
    track._nodeCache = new Map();
    track._ladderNodes = [];
    updatePlayState();
  }

  function playbackFixedStep(track, dt) {
    if (!track?._play?.playing || track._play.paused) return;
    if (!track._ghost) return;
    if (!track._ghost._model?.ready) return;
    if (!track._nodeCache?.size) buildNodeCache(track);

    const p = track._play;
    const elapsedMs = Math.max(0, now() - p.startT);
    const idxFloat = elapsedMs / Math.max(1, track.sampleMs);
    p.idx = Math.floor(idxFloat);
    applyDeltasUntil(track, p.idx);

    const last = track.lla.length - 1;
    const i1 = clamp(p.idx, 0, last);
    const i2 = clamp(i1 + 1, 0, last);
    let f = idxFloat - Math.floor(idxFloat);
    if (easingOn) f = smoothstep(f);

    const pose = poseAt(track, i1, i2, f, dt);
    const a1 = track.anim?.[i1] || null;
    const a2 = track.anim?.[i2] || a1;
    const animState = blendAnimState(a1, a2, f);

    setGhostPose(track, pose.lla, pose.htr);
    applyAnimFallback(track, animState);
    // GeoFS pose update can overwrite animated transforms; enforce replay transforms afterward.
    applyLastMatrices(track);
    hideLadderNodes(track);

    if (i1 >= last) {
      p.paused = true;
    }
  }

  /* ---------- Storage ---------- */
  function saveToLocalStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(buildProject()));
    } catch (e) {
      console.warn('[FlightRecorder] save failed', e);
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
        const tr = {
          id: t.id,
          name: t.name,
          modelUrl: t.modelUrl,
          sampleMs: t.sampleMs,
          base: t.base,
          lla: t.lla || [],
          htr: t.htr || [],
          xy: t.xy || [],
          anim: t.anim || [],
          blocks: t.blocks || [],
          _nodeNames: t._nodeNames || []
        };
        initTrackRuntime(tr);
        return tr;
      });
      updatePlayState();
    } catch (e) {
      console.warn('[FlightRecorder] load failed', e);
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
          const tr = {
            id: t.id || `T${Date.now().toString(36)}`,
            name: t.name || 'Imported',
            modelUrl: t.modelUrl,
            sampleMs: Number(t.sampleMs) || 16,
            base: t.base,
            lla: t.lla || [],
            htr: t.htr || [],
            xy: t.xy || [],
            anim: t.anim || [],
            blocks: t.blocks || [],
            _nodeNames: t._nodeNames || []
          };
          initTrackRuntime(tr);
          added.push(tr);
        }
        tracks.push(...added);
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
    updateUi();
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
        <h2 style="margin:0 0 12px;">Flight Recorder ${VERSION}</h2>

        <fieldset style="margin-bottom:10px;">
          <legend>Recording</legend>
          <div style="display:flex; justify-content:center; align-items:center;">
            <button id="recBtn" style="font-size:18px; font-weight:700; min-width:260px; padding:12px 14px; border:none; border-radius:8px; cursor:pointer; color:#fff;"></button>
          </div>
          <div id="recStatus" style="text-align:center; color:#777; margin-top:10px; font-size:14px;">REC • 0 • ${(1000 / defaultSampleMs).toFixed(1)} Hz</div>
          <div id="recHint" style="text-align:center; color:#777; margin-top:4px; min-height:18px;"></div>
          <div id="recDebug" style="text-align:center; color:#888; margin-top:2px; min-height:16px; font-size:12px;"></div>
          <div style="text-align:center; color:#555; margin-top:4px;">
            <label><input id="ultraSmoothCb" type="checkbox"> Ultra-smooth mode</label>
          </div>
          <div style="text-align:center; color:#555; margin-top:4px;">
            <label for="ultraStrength">Strength</label>
            <input id="ultraStrength" type="range" min="0" max="100" step="1" value="${ultraStrength}" style="width:220px; vertical-align:middle;">
            <span id="ultraStrengthVal">${ultraStrength}</span>
          </div>
        </fieldset>

        <fieldset style="margin-bottom:10px;">
          <legend>Playback</legend>
          <div style="margin-bottom:8px; display:flex; gap:8px; flex-wrap:wrap;">
            <button id="playSelBtn">Start Formation (selected)</button>
            <button id="stopAllBtn">Stop All</button>
          </div>
          <div id="tracks"></div>
        </fieldset>

        <fieldset style="margin-bottom:10px;">
          <legend>Storage</legend>
          <div style="margin-bottom:6px; display:flex; gap:8px; flex-wrap:wrap;">
            <button id="saveBtn">Save (to Browser)</button>
            <button id="loadBtn">Load (from Browser)</button>
            <button id="exportBtn">Export JSON</button>
            <label for="importFile" style="border:1px solid #888; padding:3px 6px; cursor:pointer;">Import JSON</label>
            <input type="file" id="importFile" accept="application/json" style="display:none;">
          </div>
          <small style="color:#555;">
            <b>Save/Load</b> = local browser storage on this PC.<br>
            <b>Export/Import</b> = JSON file backup/share.
          </small>
        </fieldset>

        <fieldset>
          <legend>Model Test</legend>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="mtBuild">Build/Refresh Cache</button>
            <button id="mtLadderShow">Ladder Show</button>
            <button id="mtLadderHide">Ladder Hide</button>
          </div>
          <small id="mtInfo" style="display:block; margin-top:6px; color:#666;"></small>
        </fieldset>

        <div style="margin-top:10px;"><small id="info" style="color:#444;"></small></div>
      </div>
    `;

    gui.recBtn = guiWin.document.getElementById('recBtn');
    gui.recStatus = guiWin.document.getElementById('recStatus');
    gui.recHint = guiWin.document.getElementById('recHint');
    gui.recDebug = guiWin.document.getElementById('recDebug');
    gui.ultraSmoothCb = guiWin.document.getElementById('ultraSmoothCb');
    gui.ultraStrength = guiWin.document.getElementById('ultraStrength');
    gui.ultraStrengthVal = guiWin.document.getElementById('ultraStrengthVal');
    gui.playSelBtn = guiWin.document.getElementById('playSelBtn');
    gui.stopAllBtn = guiWin.document.getElementById('stopAllBtn');
    gui.tracksDiv = guiWin.document.getElementById('tracks');
    gui.saveBtn = guiWin.document.getElementById('saveBtn');
    gui.loadBtn = guiWin.document.getElementById('loadBtn');
    gui.exportBtn = guiWin.document.getElementById('exportBtn');
    gui.importFile = guiWin.document.getElementById('importFile');
    gui.mtBuild = guiWin.document.getElementById('mtBuild');
    gui.mtLadderShow = guiWin.document.getElementById('mtLadderShow');
    gui.mtLadderHide = guiWin.document.getElementById('mtLadderHide');
    gui.mtInfo = guiWin.document.getElementById('mtInfo');
    gui.info = guiWin.document.getElementById('info');

    gui.recBtn.onclick = () => {
      if (recordState === 'RECORDING') stopRecording();
      else startRecordingWithSelectedPlaybacks();
      updateUi();
    };
    gui.ultraSmoothCb.checked = !!ultraSmoothOn;
    gui.ultraSmoothCb.onchange = (e) => {
      ultraSmoothOn = !!e.target.checked;
      for (const tr of tracks) {
        tr._ultra.lla = null;
        tr._ultra.htr = null;
      }
      updateUi();
    };
    gui.ultraStrength.value = String(ultraStrength);
    gui.ultraStrengthVal.textContent = String(ultraStrength);
    gui.ultraStrength.oninput = (e) => {
      ultraStrength = clamp(Number(e.target.value) || 0, 0, 100);
      ultraTauMs = 80 + ultraStrength * 4;
      gui.ultraStrengthVal.textContent = String(ultraStrength);
    };

    gui.playSelBtn.onclick = () => startFormationSelected();
    gui.stopAllBtn.onclick = () => stopAll();

    gui.saveBtn.onclick = () => saveToLocalStorage();
    gui.loadBtn.onclick = () => { loadFromLocalStorage(); updateUi(); };
    gui.exportBtn.onclick = () => exportJSON();
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
      gui.mtInfo.textContent = `Cache: ${active._nodeCache.size} nodes; ladder nodes: ${active._ladderNodes.length}`;
    };
    gui.mtLadderShow.onclick = () => {
      const active = tracks.find((t) => t._play?.playing && t._ghost?._model?.ready);
      if (!active) return;
      for (const n of active._ladderNodes || []) { try { n.show = true; } catch { } }
    };
    gui.mtLadderHide.onclick = () => {
      const active = tracks.find((t) => t._play?.playing && t._ghost?._model?.ready);
      if (!active) return;
      hideLadderNodes(active);
    };

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

    gui.tracksDiv.innerHTML = tracks.map((t) => {
      const seconds = Math.round((t.lla.length * t.sampleMs) / 1000);
      const rateHz = (1000 / t.sampleMs).toFixed(1);
      const playLabel = !t._play.playing ? 'Play' : (t._play.paused ? 'Resume' : 'Pause');
      const disabledPlay = (recordState === 'RECORDING' || (playState === 'PLAYING' && !t._play.playing)) ? 'disabled' : '';
      const checked = previousSelected.has(t.id) ? 'checked' : '';

      return `
        <div style="border:1px solid #ccc; padding:8px; margin-bottom:8px; border-radius:6px;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <label><input type="checkbox" class="track-select" data-id="${escapeHtml(t.id)}" ${checked}> Select</label>
            <input class="nameIn" data-id="${escapeHtml(t.id)}" value="${escapeHtml(t.name || 'Unnamed')}" style="min-width:220px;">
            <button class="renameBtn" data-id="${escapeHtml(t.id)}">Rename</button>
            <span style="color:#666;">• Duration: ${seconds}s • Rate: ${rateHz} Hz</span>
          </div>
          <div style="margin-top:6px;"><small style="color:#666;">${escapeHtml(t.modelUrl || '')}</small></div>
          <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
            <button class="playBtn" data-id="${escapeHtml(t.id)}" ${disabledPlay}>${playLabel}</button>
            <button class="stopBtn" data-id="${escapeHtml(t.id)}">Stop</button>
            <button class="delBtn" data-id="${escapeHtml(t.id)}">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    for (const btn of guiWin.document.querySelectorAll('.playBtn')) {
      btn.onclick = () => {
        const tr = tracks.find((x) => x.id === btn.dataset.id);
        if (!tr) return;
        if (!tr._play.playing) startPlayback(tr);
        else pausePlayback(tr, !tr._play.paused);
      };
    }

    for (const btn of guiWin.document.querySelectorAll('.stopBtn')) {
      btn.onclick = () => {
        const tr = tracks.find((x) => x.id === btn.dataset.id);
        if (!tr) return;
        stopPlayback(tr);
        updateUi();
      };
    }

    for (const btn of guiWin.document.querySelectorAll('.delBtn')) {
      btn.onclick = () => deleteTrack(btn.dataset.id);
    }

    for (const btn of guiWin.document.querySelectorAll('.renameBtn')) {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const input = guiWin.document.querySelector(`.nameIn[data-id="${id}"]`);
        renameTrack(id, input?.value || '');
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

    gui.playSelBtn.disabled = !canPlay;
    if (gui.ultraSmoothCb) gui.ultraSmoothCb.checked = !!ultraSmoothOn;
    if (gui.ultraStrength) {
      gui.ultraStrength.disabled = !ultraSmoothOn;
      gui.ultraStrength.value = String(ultraStrength);
    }
    if (gui.ultraStrengthVal) gui.ultraStrengthVal.textContent = String(ultraStrength);

    renderFlightsList();
    updateLiveStatus();
  }

  function updateLiveStatus() {
    if (!guiWin || guiWin.closed) return;
    const samples = currentRec?.lla?.length || 0;
    const hz = currentRec ? (1000 / currentRec.sampleMs).toFixed(1) : (1000 / defaultSampleMs).toFixed(1);
    if (gui.recStatus) gui.recStatus.textContent = `REC • ${samples} • ${hz} Hz`;

    if (gui.recDebug) {
      if (recordState === 'RECORDING' && currentRec?._rec) {
        const target = currentRec._rec.targetSamples || 0;
        const recorded = currentRec.lla.length;
        const lag = target - recorded;
        gui.recDebug.textContent = `debug: target=${target} • recorded=${recorded} • lag=${lag}`;
      } else {
        gui.recDebug.textContent = '';
      }
    }

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