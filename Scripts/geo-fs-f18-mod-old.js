// ==UserScript==
// @name         GeoFS F-18 Mod
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      0.2.0
// @description  F-18 specific mods. Adds HUD speed suffix plus AoA/G indicator.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @match        https://*.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const F18_AIRCRAFT_ID = '27';
  const SPEED_SUFFIX = 'H';
  const SPEED_MATCH_TOLERANCE_KTS = 3;
  const SPEED_X_MAX = 220;
  const HUD_INDICATOR_ID = 'geofs-f18-mod-aoa-g-indicator';

  const state = {
    canvasPatched: false,
    originalFillText: null,
    hudOverlayEl: null,
    hudTimer: null
  };

  function getAircraftId() {
    return String(
      window.geofs?.aircraft?.instance?.id ??
      window.geofs?.aircraft?.instance?.aircraftRecord?.id ??
      ''
    ).trim();
  }

  function isF18Active() {
    return getAircraftId() === F18_AIRCRAFT_ID;
  }

  function getIasKnots() {
    const mps = Number(window.geofs?.animation?.values?.airspeedms);
    if (!Number.isFinite(mps)) return null;
    return Math.round(mps * 1.94384);
  }

  function getAoADeg() {
    const ac = window.geofs?.aircraft?.instance;
    const v = Number(ac?.angleOfAttackDeg);
    return Number.isFinite(v) ? v : null;
  }

  function getGLoad() {
    const av = window.geofs?.animation?.values || {};
    const directCandidates = [
      av.gload,
      av.gLoad,
      av.loadFactor,
      av.gForce,
      av.nFactor
    ];
    for (const c of directCandidates) {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }

    const rb = window.geofs?.aircraft?.instance?.rigidBody;
    const a = rb?.v_acceleration;
    if (Array.isArray(a) && a.length >= 3) {
      const ax = Number(a[0]);
      const ay = Number(a[1]);
      const az = Number(a[2]);
      if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)) {
        const mag = Math.sqrt(ax * ax + ay * ay + az * az);
        if (Number.isFinite(mag)) return mag / 9.80665;
      }
    }

    return null;
  }

  function ensureHudOverlay() {
    let el = document.getElementById(HUD_INDICATOR_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = HUD_INDICATOR_ID;
      el.style.position = 'fixed';
      el.style.left = '24px';
      el.style.top = '52%';
      el.style.transform = 'translateY(-50%)';
      el.style.zIndex = '99999';
      el.style.pointerEvents = 'none';
      el.style.color = '#5CFF5C';
      el.style.fontFamily = 'Consolas, monospace';
      el.style.fontSize = '16px';
      el.style.fontWeight = '700';
      el.style.letterSpacing = '0.4px';
      el.style.lineHeight = '1.35';
      el.style.textShadow = '0 0 4px rgba(0,0,0,0.95), 0 0 7px rgba(0,0,0,0.9)';
      document.body.appendChild(el);
    }
    state.hudOverlayEl = el;
    return el;
  }

  function updateHudIndicator() {
    const el = ensureHudOverlay();
    if (!isF18Active()) {
      el.style.display = 'none';
      return;
    }

    const aoa = getAoADeg();
    const g = getGLoad();
    const aoaText = Number.isFinite(aoa) ? `${aoa.toFixed(1)}°` : '--.-°';
    const gText = Number.isFinite(g) ? `${g.toFixed(2)}G` : '--.--G';

    el.innerHTML = `AOA ${aoaText}<br>G ${gText}`;
    el.style.display = '';
  }

  function tryPatchCanvasHudText() {
    if (state.canvasPatched) return true;

    const proto = window.CanvasRenderingContext2D?.prototype;
    if (!proto || typeof proto.fillText !== 'function') return false;
    if (proto.fillText.__f18ModPatched) {
      state.canvasPatched = true;
      return true;
    }

    const original = proto.fillText;
    state.originalFillText = original;

    proto.fillText = function (text, x, y, maxWidth) {
      let outText = text;

      try {
        if (isF18Active() && typeof text === 'string') {
          const trimmed = text.trim();
          const parsedValue = Number(trimmed);
          const iasKnots = getIasKnots();

          const isLikelyHudSpeedValue =
            Number.isFinite(parsedValue) &&
            Number.isFinite(iasKnots) &&
            Math.abs(parsedValue - iasKnots) <= SPEED_MATCH_TOLERANCE_KTS &&
            Number.isFinite(Number(x)) &&
            Number(x) >= 0 && Number(x) <= SPEED_X_MAX;

          if (isLikelyHudSpeedValue) {
            outText = `${trimmed.replace(/[A-Za-z]$/, '')}${SPEED_SUFFIX}`;
          }
        }
      } catch {
        // Keep original text on any patch error.
      }

      if (maxWidth === undefined) return original.call(this, outText, x, y);
      return original.call(this, outText, x, y, maxWidth);
    };

    proto.fillText.__f18ModPatched = true;
    state.canvasPatched = true;
    console.log('[GeoFS F-18 Mod] HUD speed suffix patch active.');
    return true;
  }

  function init() {
    // Try immediately and then retry while GeoFS finishes loading.
    tryPatchCanvasHudText();
    const timer = window.setInterval(() => {
      if (tryPatchCanvasHudText()) {
        clearInterval(timer);
      }
    }, 500);

    updateHudIndicator();
    state.hudTimer = window.setInterval(updateHudIndicator, 100);

    window.GeoFsF18Mod = {
      getState: () => ({
        activeAircraftId: getAircraftId(),
        isF18Active: isF18Active(),
        canvasPatched: state.canvasPatched,
        speedSuffix: SPEED_SUFFIX,
        aoa: getAoADeg(),
        gLoad: getGLoad()
      }),
      restore: () => {
        const proto = window.CanvasRenderingContext2D?.prototype;
        if (!proto || typeof state.originalFillText !== 'function') return false;
        proto.fillText = state.originalFillText;
        state.canvasPatched = false;
        if (state.hudTimer) {
          clearInterval(state.hudTimer);
          state.hudTimer = null;
        }
        if (state.hudOverlayEl?.parentNode) {
          state.hudOverlayEl.parentNode.removeChild(state.hudOverlayEl);
        }
        state.hudOverlayEl = null;
        console.log('[GeoFS F-18 Mod] Patch restored to original.');
        return true;
      }
    };
  }

  init();
})();
