// ==UserScript==
// @name         GeoFS F-18 HUD Mod (Direct HUD Node)
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      1.0.0
// @description  Direct F-18 HUD mod: speed suffix + AoA/G in original HUD. No fallback paths.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @match        https://*.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const F18_AIRCRAFT_ID = '27';
  const SPEED_SUFFIX = 'H';
  const SPEED_MATCH_TOLERANCE = 3;

  function getAircraftId() {
    return String(
      geofs?.aircraft?.instance?.id ??
      geofs?.aircraft?.instance?.aircraftRecord?.id ??
      ''
    ).trim();
  }

  function isF18Active() {
    return getAircraftId() === F18_AIRCRAFT_ID;
  }

  function getHudNode() {
    return geofs?.aircraft?.instance?.definition?.parts?.[87]?.object3d?._parent?._children?.[83]?._children?.[0] || null;
  }

  function iasKnots() {
    return Math.round((geofs?.animation?.values?.airspeedms || 0) * 1.94384);
  }

  function getAoA() {
    const v = Number(geofs?.aircraft?.instance?.angleOfAttackDeg);
    return Number.isFinite(v) ? v : null;
  }

  function getGLoad() {
    const av = geofs?.animation?.values || {};
    const direct = [av.gload, av.gLoad, av.loadFactor, av.gForce, av.nFactor];
    for (const c of direct) {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }

    const a = geofs?.aircraft?.instance?.rigidBody?.v_acceleration;
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

  function isHudCanvasContext(ctx, hudNode) {
    const c = ctx?.canvas;
    if (!c || !hudNode) return false;
    const candidates = [
      hudNode?.canvas,
      hudNode?._canvas,
      hudNode?.renderer?.canvas,
      hudNode?.renderer?._canvas,
      hudNode?._renderer?.canvas,
      hudNode?._renderer?._canvas,
      hudNode?.renderer?.context?.canvas,
      hudNode?._renderer?.context?.canvas,
      hudNode?.renderer?._context?.canvas,
      hudNode?._renderer?._context?.canvas
    ];
    return candidates.some((x) => x && x === c);
  }

  function installPatch() {
    const hudNode = getHudNode();
    if (!hudNode) {
      console.log('[F-18 HUD Mod] HUD node niet gevonden.');
      return false;
    }

    if (window.__f18HudSpeedSuffixPatch) {
      console.log('[F-18 HUD Mod] Patch was al actief.');
      return true;
    }

    const proto = CanvasRenderingContext2D?.prototype;
    if (!proto?.fillText) {
      console.log('[F-18 HUD Mod] Canvas fillText niet beschikbaar.');
      return false;
    }

    const original = proto.fillText;
    let activeHudCanvas = null;

    proto.fillText = function (text, x, y, maxWidth) {
      let out = text;

      try {
        if (isF18Active()) {
          const s = String(text ?? '').trim();
          const n = Number(s);
          const ias = iasKnots();
          const byNodeMatch = isHudCanvasContext(this, hudNode);
          const byLockedCanvas = !!activeHudCanvas && this?.canvas === activeHudCanvas;
          const ctxEligible = byNodeMatch || byLockedCanvas || !activeHudCanvas;

          // Heuristiek: alleen numerieke HUD-snelheid links in beeld
          let drewSpeedPatch = false;
          if (
            ctxEligible &&
            Number.isFinite(n) &&
            Number.isFinite(ias) &&
            Math.abs(n - ias) <= SPEED_MATCH_TOLERANCE &&
            Number(x) >= 0 && Number(x) <= 220
          ) {
            out = `${s.replace(/[A-Za-z]$/, '')}${SPEED_SUFFIX}`;
            drewSpeedPatch = true;
            if (!activeHudCanvas && this?.canvas) {
              activeHudCanvas = this.canvas;
              console.log('[F-18 HUD Mod] HUD canvas locked via speed text match.');
            }
          }

          // Teken AoA/G direct in dezelfde HUD-canvas zodra de speed-text wordt geraakt.
          // Niet throttlen: de HUD wist per frame, dus throttling veroorzaakt flikkeren.
          if (drewSpeedPatch) {
            const aoa = getAoA();
            const g = getGLoad();
            const aoaText = Number.isFinite(aoa) ? aoa.toFixed(1) : '--.-';
            const gText = Number.isFinite(g) ? g.toFixed(2) : '--.--';

            const prevFillStyle = this.fillStyle;
            const prevFont = this.font;
            const prevAlign = this.textAlign;

            this.fillStyle = '#00ff66';
            this.textAlign = 'left';
            this.font = 'bold 15px sans-serif';

            original.call(this, `AOA ${aoaText}°`, 330, 62);
            original.call(this, `G ${gText}`, 330, 80);

            this.fillStyle = prevFillStyle;
            this.font = prevFont;
            this.textAlign = prevAlign;
          }
        }
      } catch {
        // keep original draw path if anything fails
        console.warn('[F-18 HUD Mod] Fout bij patchen van HUD, originele tekst behouden.');
      }

      return maxWidth === undefined
        ? original.call(this, out, x, y)
        : original.call(this, out, x, y, maxWidth);
    };

    window.__f18HudSpeedSuffixPatch = {
      hudNode,
      restore() {
        CanvasRenderingContext2D.prototype.fillText = original;
        delete window.__f18HudSpeedSuffixPatch;
        console.log('[F-18 HUD Mod] Patch verwijderd.');
      },
      getState() {
        return {
          aircraftId: getAircraftId(),
          f18Active: isF18Active(),
          hudNodeFound: !!getHudNode(),
          speedSuffix: SPEED_SUFFIX
        };
      }
    };

    console.log('[F-18 HUD Mod] Patch actief (direct HUD node methode). Gebruik __f18HudSpeedSuffixPatch.restore() om terug te zetten.');
    return true;
  }

  // Wacht tot de F-18/HUD scene geladen is en patch dan één keer.
  const bootTimer = setInterval(() => {
    if (!isF18Active()) return;
    if (installPatch()) {
      clearInterval(bootTimer);
    }
  }, 400);
})();
