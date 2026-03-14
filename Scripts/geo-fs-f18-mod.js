// ==UserScript==
// @name         GeoFS F-18 HUD Mod
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      1.0.0
// @description  Vervangt de genericHUD renderer voor de F-18 met een volledige custom HUD.
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
  const CAMERA_STEP_Z = 0.005;
  const CAMERA_UP_BUTTON_ID = 'f18-hud-camera-up';
  const CAMERA_DOWN_BUTTON_ID = 'f18-hud-camera-down';

  // ---------------------------------------------------------------------------
  // FPV tracking state
  // ---------------------------------------------------------------------------

  const fpvState = {
    lastLat: null,
    lastLon: null,
    lastAlt: null,
    relAzDeg: 0,
    relElDeg: 0,
    valid: false
  };

  // Maximum positieve G sinds script start.
  let maxG = 1;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function angleDiffDeg(a, b) {
    let d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Checks if the currently selected aircraft is the F-18.
  function isF18Active() {
    return (window.geofs?.aircraft?.instance?.id ?? '') === F18_AIRCRAFT_ID;
  }

  function getCurrentCameraZ() {
    const mode = window.geofs?.camera?.modes?.[1];
    const baseZ = mode?.position?.[2] ?? DEFAULT_HUD_CAMERA_Z;
    const offsetZ = mode?.offsets?.current?.[2] ?? 0;
    return baseZ + offsetZ;
  }

  function adjustHudCameraZ(deltaZ) {
    const mode = window.geofs?.camera?.modes?.[1];
    if (!mode?.position) return;
    if (!Number.isFinite(mode.position[2])) {
      mode.position[2] = DEFAULT_HUD_CAMERA_Z;
    }
    mode.position[2] += deltaZ;
  }

  function createCameraPadButton(label, id, onClick) {
    const outer = document.createElement('div');
    outer.id = id;
    outer.className = 'geofs-inline-overlay geofs-textOverlay control-pad geofs-visible geofs-manipulator';
    outer.style.backgroundSize = '50px 25px';
    outer.style.marginLeft = '0px';
    outer.style.marginBottom = '0px';
    outer.style.zIndex = '60';
    outer.style.backgroundPosition = '0px 0px';
    outer.style.width = '50px';
    outer.style.height = '25px';
    outer.style.transformOrigin = '0px 25px';
    outer.style.opacity = '1';
    outer.style.transform = 'rotate(0deg)';
    outer.style.position = 'relative';
    outer.style.cursor = 'pointer';

    const inner = document.createElement('div');
    inner.className = 'geofs-overlay geofs-textOverlay control-pad-dyn-label geofs-visible';
    inner.style.backgroundSize = '50px 25px';
    inner.style.marginLeft = '0px';
    inner.style.marginBottom = '0px';
    inner.style.left = '0px';
    inner.style.bottom = '0px';
    inner.style.zIndex = '61';
    inner.style.backgroundPosition = '0px 0px';
    inner.style.width = '50px';
    inner.style.height = '25px';
    inner.style.transformOrigin = '0px 25px';
    inner.style.opacity = '1';
    inner.style.transform = 'rotate(0deg)';
    inner.textContent = label;

    outer.appendChild(inner);
    outer.addEventListener('click', onClick);
    return outer;
  }

  function installCameraControls() {
    if (window.__f18HudCameraControls) return true;

    const padsContainer = document.querySelector('.geofs-pads-container');
    if (!padsContainer) return false;

    const wrapper = document.createElement('div');
    wrapper.id = 'f18-hud-camera-controls';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    wrapper.style.alignItems = 'flex-start';

    const upButton = createCameraPadButton('UP', CAMERA_UP_BUTTON_ID, () => {
      adjustHudCameraZ(CAMERA_STEP_Z);
    });
    const downButton = createCameraPadButton('DOWN', CAMERA_DOWN_BUTTON_ID, () => {
      adjustHudCameraZ(-CAMERA_STEP_Z);
    });

    wrapper.appendChild(upButton);
    wrapper.appendChild(downButton);
    padsContainer.prepend(wrapper);

    window.__f18HudCameraControls = {
      element: wrapper,
      remove() {
        wrapper.remove();
        delete window.__f18HudCameraControls;
      }
    };

    return true;
  }

  // Returns pixelsPerDeg (vertical), pixelsPerDegX (horizontal) and
  // cameraOffsetPx (vertical eye-height parallax correction in pixels).
  function computeHudGeometry(w, h) {
    const hudVerticalFovDeg = 2 * Math.atan((HUD_PHYSICAL_HEIGHT_M / 2) / CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const pixelsPerDeg = h / hudVerticalFovDeg;
    const hudPhysicalWidthM = HUD_PHYSICAL_HEIGHT_M * (w / h);
    const hudHorizontalFovDeg = 2 * Math.atan((hudPhysicalWidthM / 2) / CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const pixelsPerDegX = w / hudHorizontalFovDeg;
    const cameraDeltaZ = getCurrentCameraZ() - DEFAULT_HUD_CAMERA_Z;
    const cameraOffsetDeg = Math.atan2(cameraDeltaZ, CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const cameraOffsetPx = cameraOffsetDeg * pixelsPerDeg * HUD_PARALLAX_GAIN;
    return { pixelsPerDeg, pixelsPerDegX, cameraOffsetPx };
  }

  // ---------------------------------------------------------------------------
  // FPV state update
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Draw calls — geen fillText-prototype nodig; ctx is de gewone canvas context
  // ---------------------------------------------------------------------------

  function drawAoaText(ctx, w, h, aoa) {
    const previousAlign = ctx.textAlign;
    const previousBaseline = ctx.textBaseline;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`α ${aoa.toFixed(1)}`, w * 0.716, h * 0.93);
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

  // Pitch ladder — gebruikt ctx.fillText rechtstreeks (geen prototype-omweg).
  function drawPitchLadder(ctx, camera, ac, cx, clipCy, symbolCy, pixelsPerDeg, w, h) {
    const pitchDeg = -ac.htr[1] || 0;
    const cameraCompY = symbolCy - clipCy;
    const horizonOffsetY = pitchDeg * pixelsPerDeg + cameraCompY;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Clip to an approximate physical HUD combiner shape (wide, angular),
    // instead of a small circular clip.
    ctx.beginPath();
    ctx.moveTo(w * 0.34, h * 0.06);
    ctx.lineTo(w * 0.66, h * 0.06);
    ctx.lineTo(w * 0.92, h * 0.27);
    ctx.lineTo(w * 0.82, h * 0.92);
    ctx.lineTo(w * 0.18, h * 0.92);
    ctx.lineTo(w * 0.08, h * 0.27);
    ctx.closePath();
    ctx.clip();

    // Always rotate around the visual center of the HUD, while still applying
    // camera-height compensation through the vertical ladder offset.
    ctx.translate(cx, clipCy);
    ctx.rotate(-camera.roll);
    ctx.translate(0, horizonOffsetY);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;

    // Horizon line
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-w * 0.56, 0);
    ctx.lineTo(w * 0.56, 0);
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

        ctx.fillText(String(deg), -LABEL_X - 3, isBelow ? tickY - 7 : tickY + 7);
        ctx.fillText(String(deg), LABEL_X + 3, isBelow ? tickY - 7 : tickY + 7);
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

  // ---------------------------------------------------------------------------
  // Speed box links (geen tape)
  // ---------------------------------------------------------------------------

  function drawSpeedBox(ctx, kias, w, h) {
    const boxX = w * 0.145;
    const boxY = h * 0.333;
    const boxW = w * 0.118;
    const boxH = h * 0.064;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(1.2, w * 0.0028);
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.round(h * 0.042)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(kias)}`, boxX + boxW / 2, boxY + boxH / 2 + 1);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Altitude box rechts (geen tape, duizenden groter)
  // ---------------------------------------------------------------------------

  function drawAltitudeBox(ctx, alt, w, h) {
    const boxX = w * 0.730;
    const boxY = h * 0.333;
    const boxW = w * 0.138;
    const boxH = h * 0.064;

    const altRounded = Math.max(0, Math.round(alt));
    const thousands = Math.floor(altRounded / 1000);
    const hundreds = altRounded % 1000;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(1.2, w * 0.0028);
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    const rightX = boxX + boxW - w * 0.012;
    const centerY = boxY + boxH / 2 + 1;
    const smallText = String(hundreds).padStart(3, '0');

    ctx.fillStyle = 'white';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    ctx.font = `bold ${Math.round(h * 0.034)}px monospace`;
    const smallWidth = ctx.measureText(smallText).width;
    ctx.fillText(smallText, rightX, centerY);

    ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
    ctx.fillText(String(thousands), rightX - smallWidth - w * 0.006, centerY);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Linker readouts onder speed (Mach + AoA + G + maxG + autopilot details)
  // ---------------------------------------------------------------------------

  function drawLeftReadouts(ctx, mach, gValue, aoa, maxGValue, autopilot, w, h) {
    const x = w * 0.145;
    const y1 = h * 0.445;
    const y2 = h * 0.497;
    const y3 = h * 0.549;
    const y4 = h * 0.601;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'white';
    ctx.font = `${Math.round(h * 0.036)}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const gPrefix = 'G ';
    const gPrefixWidth = ctx.measureText(gPrefix).width;

    ctx.fillText(`M ${mach.toFixed(2)}`, x, y1);
    ctx.fillText(`α ${aoa.toFixed(1)}`, x, y2);
    ctx.fillText(gPrefix, x, y3);
    ctx.fillText(gValue.toFixed(1), x + gPrefixWidth, y3);
    // Max G zonder prefix, uitgelijnd op het G-getal.
    ctx.fillText(maxGValue.toFixed(1), x + gPrefixWidth, y4);

    if (autopilot?.on) {
      const sepY = h * 0.636;
      ctx.beginPath();
      ctx.moveTo(x, sepY);
      ctx.lineTo(w * 0.265, sepY);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const rowStep = h * 0.046;
      let rowY = sepY + h * 0.038;
      ctx.font = `${Math.round(h * 0.032)}px monospace`;

      if (autopilot?.values?.speed != null) {
        ctx.fillText(`SPD ${Math.round(autopilot.values.speed)}`, x, rowY);
        rowY += rowStep;
      }

      if (autopilot?.values?.altitude != null) {
        const altitudeText = String(autopilot.values.altitude).split('.')[0];
        ctx.fillText(`ALT ${altitudeText}`, x, rowY);
        rowY += rowStep;
      }

      if (autopilot?.mode) {
        ctx.fillText(String(autopilot.mode), x, rowY);
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Rechter readouts rond altitude (VSI boven, radio-alt onder)
  // ---------------------------------------------------------------------------

  function drawRightReadouts(ctx, vsi, radioAlt, trimDisplay, navUnit, w, h) {
    const x = w * 0.730;
    const yTop = h * 0.300;
    const yBottom = h * 0.445;
    const yTrim = h * 0.497;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'white';
    ctx.font = `${Math.round(h * 0.036)}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(` ${vsi >= 0 ? ' ' : ''}${vsi}`, x, yTop);

    if (radioAlt <= 10000) {
      ctx.fillText(`R ${Math.round(radioAlt)}`, x, yBottom);
    }

    ctx.fillText(trimDisplay, x, yTrim);

    if (navUnit != null) {
      const sepY = h * 0.532;
      ctx.beginPath();
      ctx.moveTo(x, sepY);
      ctx.lineTo(w * 0.85, sepY);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const rowStep = h * 0.046;
      let rowY = sepY + h * 0.038;
      ctx.font = `${Math.round(h * 0.032)}px monospace`;

      const dme = navUnit?.DME ?? '--';
      const bearing = Number.isFinite(navUnit?.bearing) ? Math.round(navUnit.bearing) : '--';
      const course = Number.isFinite(navUnit?.course) ? Math.round(navUnit.course) : '--';
      const timeToSignal = navUnit?.timeToSignal ?? '--';

      ctx.fillText(`DME ${dme}`, x, rowY);
      rowY += rowStep;
      ctx.fillText(`B ${bearing}`, x, rowY);
      rowY += rowStep;
      ctx.fillText(`C ${course}`, x, rowY);
      rowY += rowStep;
      ctx.fillText(`T ${timeToSignal} MIN`, x, rowY);
      rowY += rowStep;

      if (navUnit?.navaid?.type === 'ILS') {
        const icao = navUnit?.navaid?.icao ?? '';
        ctx.fillText(`ILS ${icao}`, x, rowY);
      } else if (navUnit?.navaid?.type === 'VORTAC') {
        const ident = navUnit?.navaid?.ident ?? navUnit?.navaid?.icao ?? '';
        ctx.fillText(`VOR ${ident}`, x, rowY);
      } else {
        let ident = navUnit?.navaid?.ident;
        if (!ident) { ident = navUnit?.navaid?.icao ?? ''; }
        ctx.fillText(`${navUnit?.navaid?.type} ${ident}`, x, rowY);
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Kompasband bovenaan + caret in het midden (omgekeerde V)
  // ---------------------------------------------------------------------------

  function drawTopHeadingScale(ctx, renderer, hdg, navUnit, w, h) {
    const bandX = w * 0.275;
    const bandY = h * 0.078;
    const bandW = w * 0.450;
    const bandH = h * 0.108;

    ctx.save();
    ctx.beginPath();
    ctx.rect(bandX, bandY, bandW, bandH);
    ctx.clip();
    ctx.textAlign = 'center';
    const prevFont = ctx.font;
    ctx.font = `${Math.round(h * 0.030)}px monospace`;

    renderer.drawGrads(renderer.canvasAPI, {
      position: [bandX, bandY + h * 0.030],
      zero: [bandW / 2, 0],
      size: [bandW, bandH],
      orientation: 'x',
      direction: 1,
      value: hdg,
      interval: 5,
      pixelRatio: w * 0.0105,
      pattern: [[{
        length: h * 0.016,
        legend: true,
        legendOffset: { x: 0, y: -h * 0.004 },
        process: v => {
          const deg = ((Math.round(v / 10) * 10) % 360 + 360) % 360;
          return String(deg);
        }
      }], [{
        length: h * 0.009
      }]]
    });
    ctx.font = prevFont;
    ctx.restore();

    // Center caret / inverted V marker.
    const cx = w / 2;
    const topY = bandY + bandH - h * 0.043;
    const halfW = w * 0.012;
    const height = h * 0.016;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(1.2, w * 0.0026);
    ctx.beginPath();
    ctx.moveTo(cx - halfW, topY);
    ctx.lineTo(cx, topY - height);
    ctx.lineTo(cx + halfW, topY);
    ctx.stroke();

    // Bearing diamond marker in heading tape.
    if (navUnit != null && Number.isFinite(navUnit?.bearing)) {
      const bearingDeltaDeg = angleDiffDeg(navUnit.bearing, hdg);
      const pxPerDeg = (w * 0.0105) / 5;
      const diamondX = cx + bearingDeltaDeg * pxPerDeg;
      const bandLeft = bandX;
      const bandRight = bandX + bandW;

      if (diamondX >= bandLeft && diamondX <= bandRight) {
        const diamondTopY = topY - height;
        const diamondHalfW = w * 0.007;
        const diamondHalfH = h * 0.010;

        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.moveTo(diamondX, diamondTopY);
        ctx.lineTo(diamondX + diamondHalfW, diamondTopY + diamondHalfH);
        ctx.lineTo(diamondX, diamondTopY + diamondHalfH * 2);
        ctx.lineTo(diamondX - diamondHalfW, diamondTopY + diamondHalfH);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // ILS deviation cues t.o.v. FPV
  // ---------------------------------------------------------------------------

  function drawIlsDeviationCues(ctx, fpvDrawn, w, h) {
    const navUnit = window.geofs?.nav?.currentNAVUnit;
    if (!navUnit || !fpvDrawn) return;

    const navDirection = window.geofs?.animation?.getValue?.('NAVDirection')
      ?? window.geofs?.animation?.values?.NAVDirection
      ?? navUnit?.NAVDirection;

    const outOfRange = navUnit?.inRange === false;
    const isFrom = navUnit === 'from' || navDirection === 'from';

    if (outOfRange || isFrom) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = `${Math.round(h * 0.033)}px monospace`;
      ctx.fillText(outOfRange ? 'OUT OF RANGE' : 'FROM', fpvDrawn.x, fpvDrawn.y + h * 0.032);
      ctx.restore();
      return;
    }

    const getValue = window.geofs?.animation?.getValue?.bind(window.geofs?.animation);
    const navCourseDeviation = getValue
      ? (getValue('NAVCourseDeviation') ?? 0)
      : (window.geofs?.animation?.values?.NAVCourseDeviation ?? 0);
    const navGlideDeviation = getValue
      ? (getValue('NAVGlideAngleDeviation') ?? 0)
      : (window.geofs?.animation?.values?.NAVGlideAngleDeviation ?? 0);

    // Scale originele HUD offsets naar huidige canvasafmetingen.
    const courseOffsetPx = clampValue(10 * navCourseDeviation, -75, 75) * (w / 512);
    const glideOffsetPx = clampValue(-10 * navGlideDeviation, -75, 75) * (h / 512);

    const fpvX = fpvDrawn.x;
    const fpvY = fpvDrawn.y;
    const hLen = w * 0.055;
    const vLen = h * 0.055;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([]);

    // Glide slope: horizontale streep (alleen bij VNAV-capable).
    if (navUnit?.VNAVCapable) {
      const glideY = fpvY + glideOffsetPx;
      ctx.beginPath();
      // Horizontaal gecentreerd op FPV, alleen verticale offset.
      ctx.moveTo(fpvX - hLen, glideY);
      ctx.lineTo(fpvX + hLen, glideY);
      ctx.stroke();
    }

    // Course deviation: verticale streep (alleen bij LNAV-capable).
    if (navUnit?.LNAVCapable) {
      const courseX = fpvX + courseOffsetPx;
      ctx.beginPath();
      // Verticaal gecentreerd op FPV, alleen horizontale offset.
      ctx.moveTo(courseX, fpvY - vLen);
      ctx.lineTo(courseX, fpvY + vLen);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // F-18 HUD renderer — volledige custom draw
  // ---------------------------------------------------------------------------

  function renderF18Hud(renderer) {
    const o = renderer.canvasAPI.context;
    const canvas = renderer.canvasAPI.canvas ?? o.canvas;
    const w = canvas?.width || 512;
    const h = canvas?.height || 512;

    const ac = window.geofs?.aircraft?.instance;
    const anim = window.geofs?.animation?.values ?? {};
    const camera = window.geofs?.api?.viewer?.camera;

    const kias = window.exponentialSmoothing
      ? window.exponentialSmoothing('smoothKias', anim.kias ?? 0, 0.1)
      : (anim.kias ?? 0);
    const alt = anim.altitude ?? 0;
    const hdg = anim.heading360 ?? anim.heading ?? 0;
    const aoa = anim.aoa ?? 0;
    const mach = Math.round(((window.geofs?.animation?.values?.mach ?? 0) * 100)) / 100;
    const vsi = Math.round((window.geofs?.animation?.values?.climbrate ?? 0) / 10) * 10;
    const radioAlt = window.geofs?.animation?.values?.haglFeet ?? 0;
    const trimScaled = Math.round((window.geofs?.animation?.values?.trim ?? 0) * 100);
    const trimDisplay = trimScaled === 0 ? 'T T/O' : `T ${trimScaled}`;
    const currentG = Number.isFinite(anim.loadFactor) ? anim.loadFactor : 1;
    const navUnit = window.geofs?.nav?.currentNAVUnit ?? null;
    const autopilot = window.geofs?.autopilot ?? null;

    if (currentG > maxG) {
      maxG = currentG;
    }

    // Canvas leeg maken.
    renderer.canvasAPI.clear();

    // Achtergrond overlay (GeoFS origineel gebruikt e.images.background; hier weglaten
    // want we willen een glazen HUD zonder achtergrond-sprite).

    o.fillStyle = '#00ff00';
    o.strokeStyle = '#00ff00';
    o.lineWidth = 2;
    o.font = `20px sans-serif`;

    // --- Kompasband bovenaan ---
    drawTopHeadingScale(o, renderer, hdg, navUnit, w, h);

    // --- Speed + Altitude boxed readouts (meer naar binnen) ---
    drawSpeedBox(o, kias, w, h);
    drawAltitudeBox(o, alt, w, h);

    // --- Readouts links/rechts rond de boxes ---
    drawLeftReadouts(o, mach, currentG, aoa, maxG, autopilot, w, h);
    drawRightReadouts(o, vsi, radioAlt, trimDisplay, navUnit, w, h);

    // --- Attitude-symbologie (pitch ladder, boresight, FPV, AoA) ---
    if (camera && ac?.htr) {
      const cx = w / 2;
      const cy = h / 2;
      const clipCy = cy;

      const { pixelsPerDeg, pixelsPerDegX, cameraOffsetPx } = computeHudGeometry(w, h);
      const symbolCy = cy - cameraOffsetPx;

      updateFpvState(ac.llaLocation, ac);
      drawBoresight(o, cx, symbolCy, pixelsPerDeg, w, h);
      drawPitchLadder(o, camera, ac, cx, clipCy, symbolCy, pixelsPerDeg, w, h);

      const fpvPos = computeFpvScreenPosition(camera, cx, symbolCy, pixelsPerDeg, pixelsPerDegX);
      const fpvDrawn = drawFpv(o, fpvPos, cx, clipCy, w, h);
      drawIlsDeviationCues(o, fpvDrawn, w, h);

      const isGearDown = window.controls?.gear?.position < 0.5;
      drawAoaBracket(o, fpvDrawn, cx, clipCy, pixelsPerDeg, w, h, aoa, isGearDown);
    }

    // AoA staat in linker readouts onder de speedbox.
  }

  // ---------------------------------------------------------------------------
  // Patch installatie: overschrijf instruments.renderers.genericHUD
  // ---------------------------------------------------------------------------

  function installPatch() {
    const renderers = window.instruments?.renderers;
    if (!window.__f18HudMod) {
      if (!renderers?.genericHUD) return false;

      const originalHUD = renderers.genericHUD;

      renderers.genericHUD = function (renderer) {
        if (!isF18Active()) {
          // Niet de F-18: origineel gedrag behouden.
          return originalHUD.call(this, renderer);
        }
        renderF18Hud(renderer);
      };

      window.__f18HudMod = {
        restore() {
          window.instruments.renderers.genericHUD = originalHUD;
          if (window.__f18HudCameraControls) {
            window.__f18HudCameraControls.remove();
          }
          delete window.__f18HudMod;
        }
      };
    }

    const controlsReady = installCameraControls();
    return Boolean(window.__f18HudMod && controlsReady);
  }

  // Blijft proberen totdat GeoFS instruments geladen zijn.
  const timer = setInterval(() => {
    if (installPatch()) clearInterval(timer);
  }, 400);
})();
