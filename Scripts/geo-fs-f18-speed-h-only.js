// ==UserScript==
// @name         GeoFS F-18 Speed H Only
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      1.0.0
// @description  Alleen voor F-18: zet een H achter de HUD-snelheid.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @match        https://*.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const F18_AIRCRAFT_ID = '27';
  const RAD_TO_DEG = 180 / Math.PI;
  const CAMERA_TO_HUD_DISTANCE_M = 0.92;
  const HUD_PHYSICAL_HEIGHT_M = 0.30;
  const DEFAULT_HUD_CAMERA_Z = 0.925;
  const HUD_PARALLAX_GAIN = 1.65;

  // FPV tracking state (based on camera movement, similar to the external FPV script).
  const fpvState = {
    lastLat: null,
    lastLon: null,
    lastAlt: null,
    relAzDeg: 0,
    relElDeg: 0,
    valid: false
  };

  function angleDiffDeg(a, b) {
    let d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  // Checks if the currently selected aircraft is the F-18.
  function isF18Active() {
    // Compares current aircraft ID with the F-18 ID.
    return (window.geofs?.aircraft?.instance?.id ?? '') === F18_AIRCRAFT_ID;
  }

  function applyF18Viewpoint() {
    // geofs.camera.modes[1].offsets.current[2] = 0;
    // geofs.camera.modes[1].position[2] = DEFAULT_HUD_CAMERA_Z;
  }

  function getCurrentCameraZ() {
    const mode = window.geofs?.camera?.modes?.[1];
    const baseZ = mode?.position?.[2] ?? DEFAULT_HUD_CAMERA_Z;
    const offsetZ = mode?.offsets?.current?.[2] ?? 0;
    return baseZ + offsetZ;
  }

  function computeHudGeometry(w, h) {
    const hudVerticalFovDeg = 2 * Math.atan((HUD_PHYSICAL_HEIGHT_M / 2) / CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const pixelsPerDeg = h / hudVerticalFovDeg;
    const hudPhysicalWidthM = HUD_PHYSICAL_HEIGHT_M * (w / h);
    const hudHorizontalFovDeg = 2 * Math.atan((hudPhysicalWidthM / 2) / CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const pixelsPerDegX = w / hudHorizontalFovDeg;
    // Camera height delta relative to HUD reference seat.
    const cameraDeltaZ = getCurrentCameraZ() - DEFAULT_HUD_CAMERA_Z;
    const cameraOffsetDeg = Math.atan2(cameraDeltaZ, CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const cameraOffsetPx = cameraOffsetDeg * pixelsPerDeg * HUD_PARALLAX_GAIN;
    return { pixelsPerDeg, pixelsPerDegX, cameraOffsetPx };
  }

  function updateFpvState(lla, ac) {
    if (!Array.isArray(lla) || !Number.isFinite(lla[0]) || !Number.isFinite(lla[1]) || !Number.isFinite(lla[2])) {
      return;
    }

    const lat = lla[0];
    const lon = lla[1];
    const alt = lla[2];

    if (fpvState.lastLat != null && fpvState.lastLon != null && fpvState.lastAlt != null) {
      const latRad = lat * Math.PI / 180;
      const dNorth = (lat - fpvState.lastLat) * 111320;
      const dEast = (lon - fpvState.lastLon) * (111320 * Math.cos(latRad));
      const dUp = alt - fpvState.lastAlt;
      const horizontal = Math.hypot(dNorth, dEast);

      if (horizontal > 0.01 || Math.abs(dUp) > 0.01) {
        let trackDeg = Math.atan2(dEast, dNorth) * RAD_TO_DEG;
        if (trackDeg < 0) trackDeg += 360;
        const fpaDeg = Math.atan2(dUp, Math.max(horizontal, 1e-6)) * RAD_TO_DEG;

        const hdgDeg = (window.geofs?.animation?.values?.heading360 ?? window.geofs?.animation?.values?.heading ?? ac.htr?.[0] ?? 0);
        const pitchDegNow = -(ac.htr[1] || 0);

        fpvState.relAzDeg = angleDiffDeg(hdgDeg, trackDeg);
        fpvState.relElDeg = fpaDeg - pitchDegNow;
        fpvState.valid = true;
      }
    }

    fpvState.lastLat = lat;
    fpvState.lastLon = lon;
    fpvState.lastAlt = alt;
  }

  function drawAoaText(ctx, original, w, h, aoa) {
    const previousAlign = ctx.textAlign;
    const previousBaseline = ctx.textBaseline;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    original.call(ctx, `α ${aoa.toFixed(1)}`, w * 0.716, h * 0.93);
    ctx.textAlign = previousAlign;
    ctx.textBaseline = previousBaseline;
  }

  function drawBoresight(ctx, cx, symbolCy, pixelsPerDeg, w, h) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([]);

    const wx = cx;
    const wy = symbolCy - 1.5 * pixelsPerDeg;
    const ww = w * 0.027;
    const wh = h * 0.016;
    const stub = w * 0.010;

    ctx.beginPath();
    ctx.moveTo(wx - ww, wy);
    ctx.lineTo(wx - ww * 0.55, wy + wh);
    ctx.lineTo(wx, wy - wh * 0.15);
    ctx.lineTo(wx + ww * 0.55, wy + wh);
    ctx.lineTo(wx + ww, wy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(wx - ww - stub, wy);
    ctx.lineTo(wx - ww, wy);
    ctx.moveTo(wx + ww, wy);
    ctx.lineTo(wx + ww + stub, wy);
    ctx.stroke();
    ctx.restore();
  }

  function drawPitchLadder(ctx, original, camera, ac, cx, clipCy, symbolCy, pixelsPerDeg, w, h) {
    const pitchDeg = -ac.htr[1] || 0;
    const horizonOffsetY = pitchDeg * pixelsPerDeg;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.beginPath();
    ctx.ellipse(cx, clipCy, w * 0.28, h * 0.38, 0, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, symbolCy);
    ctx.rotate(-camera.roll);
    ctx.translate(0, horizonOffsetY);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-w * 0.4, 0);
    ctx.lineTo(w * 0.4, 0);
    ctx.stroke();

    const TICK_RANGE_DEG = 85;
    const SEGMENT_OUTER = w * 0.14;
    const SEGMENT_INNER = w * 0.025;
    const END_TICK_LEN = h * 0.03;
    const LABEL_X = SEGMENT_OUTER + w * 0.025;

    const savedFont = ctx.font;
    const savedAlign = ctx.textAlign;
    const savedBaseline = ctx.textBaseline;
    ctx.fillStyle = 'white';
    ctx.font = `${Math.round(h * 0.038)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    for (let deg = 5; deg <= TICK_RANGE_DEG; deg += 5) {
      for (const sign of [-1, 1]) {
        const tickY = sign * deg * pixelsPerDeg;
        const isBelow = sign > 0;
        const tickDir = isBelow ? -1 : 1;

        ctx.setLineDash(isBelow ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(-SEGMENT_OUTER, tickY);
        ctx.lineTo(-SEGMENT_INNER, tickY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(SEGMENT_INNER, tickY);
        ctx.lineTo(SEGMENT_OUTER, tickY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(-SEGMENT_OUTER, tickY);
        ctx.lineTo(-SEGMENT_OUTER, tickY + tickDir * END_TICK_LEN);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(SEGMENT_OUTER, tickY);
        ctx.lineTo(SEGMENT_OUTER, tickY + tickDir * END_TICK_LEN);
        ctx.stroke();

        original.call(ctx, String(deg), -LABEL_X - 3, isBelow ? tickY - 7 : tickY + 7);
        original.call(ctx, String(deg), LABEL_X + 3, isBelow ? tickY - 7 : tickY + 7);
      }
    }

    ctx.font = savedFont;
    ctx.textAlign = savedAlign;
    ctx.textBaseline = savedBaseline;
    ctx.setLineDash([]);
    ctx.restore();
  }

  function computeFpvScreenPosition(camera, cx, symbolCy, pixelsPerDeg, pixelsPerDegX) {
    if (!fpvState.valid) return null;

    const dxBody = -(fpvState.relAzDeg * pixelsPerDegX);
    const dyBody = -(fpvState.relElDeg * pixelsPerDeg);
    const cr = Math.cos(-camera.roll);
    const sr = Math.sin(-camera.roll);
    const fpvX = cx + (dxBody * cr - dyBody * sr);
    const fpvY = symbolCy + (dxBody * sr + dyBody * cr);

    return { x: fpvX, y: fpvY };
  }

  function drawFpv(ctx, fpvPos, cx, clipCy, w, h) {
    if (!fpvPos) return null;
    const fpvX = fpvPos.x;
    const fpvY = fpvPos.y;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.ellipse(cx, clipCy, w * 0.28, h * 0.38, 0, 0, Math.PI * 2);
    ctx.clip();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([]);

    const r = w * 0.012;
    const wing = w * 0.024;
    const tail = h * 0.024;

    ctx.beginPath();
    ctx.arc(fpvX, fpvY, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(fpvX - r - wing, fpvY);
    ctx.lineTo(fpvX - r, fpvY);
    ctx.moveTo(fpvX + r, fpvY);
    ctx.lineTo(fpvX + r + wing, fpvY);
    ctx.moveTo(fpvX, fpvY - r);
    ctx.lineTo(fpvX, fpvY - r - tail);
    ctx.stroke();

    ctx.restore();

    return { x: fpvX, y: fpvY, r, wing };
  }

  function drawAoaBracket(ctx, fpvDrawn, cx, clipCy, pixelsPerDeg, w, h, aoa, isGearDown) {
    if (!isGearDown || !fpvDrawn || !Number.isFinite(aoa)) return;

    // Calibration: top aligns at 6.9, middle at 8.1, bottom at 9.3.
    const AOA_TOP = 6.9;
    const AOA_STEP = 1.2;
    const tickSpacingPx = AOA_STEP * pixelsPerDeg;
    const index = (aoa - AOA_TOP) / AOA_STEP;

    const topY = fpvDrawn.y - index * tickSpacingPx;
    const midY = topY + tickSpacingPx;
    const bottomY = topY + 2 * tickSpacingPx;

    const bracketX = fpvDrawn.x - fpvDrawn.r - fpvDrawn.wing - w * 0.022;
    const tickLen = w * 0.018;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.ellipse(cx, clipCy, w * 0.28, h * 0.38, 0, 0, Math.PI * 2);
    ctx.clip();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([]);

    // Vertical spine.
    ctx.beginPath();
    ctx.moveTo(bracketX, topY);
    ctx.lineTo(bracketX, bottomY);
    ctx.stroke();

    // Right-facing ticks: top, middle, bottom.
    ctx.beginPath();
    ctx.moveTo(bracketX, topY);
    ctx.lineTo(bracketX + tickLen, topY);
    ctx.moveTo(bracketX, midY);
    ctx.lineTo(bracketX + tickLen, midY);
    ctx.moveTo(bracketX, bottomY);
    ctx.lineTo(bracketX + tickLen, bottomY);
    ctx.stroke();

    ctx.restore();
  }

  // Installs the canvas text patch once.
  function installPatch() {
    // Stops if the patch is already installed.
    if (window.__f18HudPatch) return true;

    applyF18Viewpoint();

    // Gets the canvas 2D context prototype.
    const proto = window.CanvasRenderingContext2D?.prototype;
    // Stores the original fillText method.
    const original = proto.fillText;

    // Patch drawGrads in a targeted way: disable only stock attitude degree legends.
    const rendererProto = window.instruments?.Renderer?.prototype;
    const originalDrawGrads = rendererProto?.drawGrads;
    if (rendererProto && originalDrawGrads && !rendererProto.__f18LegendPatched) {
      rendererProto.drawGrads = function (canvasApi, cfg) {
        if (
          isF18Active() &&
          cfg &&
          cfg.orientation === 'y' &&
          cfg.interval === 5 &&
          cfg.direction === -1 &&
          cfg.pixelRatio === 20 &&
          Array.isArray(cfg.pattern) &&
          cfg.pattern.length === 1 &&
          Array.isArray(cfg.pattern[0]) &&
          cfg.pattern[0].length === 2
        ) {
          // Skip the stock attitude ladder draw completely (labels + small lines).
          return;
        }
        return originalDrawGrads.call(this, canvasApi, cfg);
      };
      rendererProto.__f18LegendPatched = true;
      rendererProto.__f18LegendOriginal = originalDrawGrads;
    }

    // Replaces fillText with patched logic.
    proto.fillText = function (text, x, y, maxWidth) {
      const w = this.canvas?.width || 0;
      const h = this.canvas?.height || 0;

      // Draw original text exactly as requested.
      const result = maxWidth === undefined
        ? original.call(this, text, x, y)
        : original.call(this, text, x, y, maxWidth);

      if (isF18Active()) {
        const ac = window.geofs?.aircraft?.instance;
        const aoa = window.geofs?.animation?.values?.aoa ?? 0;

        if (w > 0 && h > 0) {
          drawAoaText(this, original, w, h, aoa);

          // Use aircraft pitch in degrees and inverse camera roll.
          // Head-look pitch is intentionally ignored.
          const camera = window.geofs?.api?.viewer?.camera;
          if (camera && ac?.htr) {
            const cx = w / 2;
            const cy = h / 2;
            const clipCy = cy;

            const { pixelsPerDeg, pixelsPerDegX, cameraOffsetPx } = computeHudGeometry(w, h);
            // Collimated symbology anchor corrected for eye height relative to HUD reference.
            const symbolCy = cy - cameraOffsetPx;
            updateFpvState(ac?.llaLocation, ac);
            drawBoresight(this, cx, symbolCy, pixelsPerDeg, w, h);
            drawPitchLadder(this, original, camera, ac, cx, clipCy, symbolCy, pixelsPerDeg, w, h);
            const fpvPos = computeFpvScreenPosition(camera, cx, symbolCy, pixelsPerDeg, pixelsPerDegX);
            const fpvDrawn = drawFpv(this, fpvPos, cx, clipCy, w, h);
            const isGearDown = controls?.gear?.position < 0.5;
            drawAoaBracket(this, fpvDrawn, cx, clipCy, pixelsPerDeg, w, h, aoa, isGearDown);
          }
        }
      }

      return result;
    };

    // Exposes a global patch object with a restore function.
    window.__f18HudPatch = {
      // Restores the original canvas fillText behavior.
      restore() {
        // Puts back the original fillText method.
        CanvasRenderingContext2D.prototype.fillText = original;
        // Restores drawGrads when it was patched.
        const rp = window.instruments?.Renderer?.prototype;
        if (rp?.__f18LegendPatched && rp.__f18LegendOriginal) {
          rp.drawGrads = rp.__f18LegendOriginal;
          delete rp.__f18LegendPatched;
          delete rp.__f18LegendOriginal;
        }
        // Removes the global patch object.
        delete window.__f18HudPatch;
      }
    };

    // Reports successful patch installation.
    return true;
  }

  // Repeats installation attempts until GeoFS is ready.
  const timer = setInterval(() => {
    // Installs the patch and stops retrying on success.
    if (installPatch()) clearInterval(timer);
  }, 400);
})();
