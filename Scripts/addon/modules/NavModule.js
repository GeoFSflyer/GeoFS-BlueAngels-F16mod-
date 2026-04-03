
  class NavModule {
      constructor(mapModule = null, dataCartridgeModule = null) {
        this.mapModule = mapModule;
        this.dataCartridgeModule = dataCartridgeModule;
      }

    setMapModule(mapModule) {
      this.mapModule = mapModule;
      return this;
    }

    setDataCartridgeModule(dataCartridgeModule) {
      this.dataCartridgeModule = dataCartridgeModule;
      return this;
    }

    registerMfdPages(mfdModule) {
      mfdModule.registerPage({
        title: 'NAV',
        leftButtons: [
          { key: 'DISPLAY', label: 'DISP', states: ['HSI', 'MAP'], stateIndex: 0 },
          { key: 'DECLUTTER', label: 'DCL', states: ['OFF', 'L1', 'L2'], stateIndex: 0 },
          {
            key: 'MARK',
            label: 'MRK',
            states: ['', 'FRND', 'CIV', 'UNKN', 'FOO'],
            values: ['', 'FRIEND', 'CIVILIAN', 'UNKNOWN', 'FOO'],
            stateIndex: 0,
            managedExternally: true,
            show() { return OptionModule.getOption('NAV', 'DISPLAY', 'HSI') === 'MAP'; },
            onClick: () => {
              this.mapModule.cycleSelectedTrafficMark();
            }
          },
          {
            key: 'SHOW',
            label: 'SHOW',
            states: ['', 'FRND', 'CIV', 'UNKN', 'FOO'],
            values: ['', 'FRIEND', 'CIVILIAN', 'UNKNOWN', 'FOO'],
            stateIndex: 0,
            managedExternally: true,
            show() { return OptionModule.getOption('NAV', 'DISPLAY', 'HSI') === 'MAP'; },
            onClick: () => {
              this.mapModule.cycleShowFilter();
            }
          },
          {
            key: 'VIEW',
            label: 'VW',
            states: ['A/C F/W', 'A/C CNT', 'A/C N', 'TGT', 'TGT N'],
            stateIndex: 0,
            managedExternally: true,
            show: () => OptionModule.getOption('NAV', 'DISPLAY', 'HSI') === 'MAP',
            onClick: () => {
              this.mapModule.cycleViewMode();
            }
          },
          { key: 'N/A', label: '', states: [''], stateIndex: 0 },
          {
            key: 'WPSEL',
            label: '↑',
            states: [''],
            stateIndex: 0,
            minimal: true,
            managedExternally: true,
            combinedGroupLabel: 'WP',
            show() { return OptionModule.getOption('NAV', 'DISPLAY', 'HSI') === 'HSI'; },
            onClick: () => {
              this.stepSelectedFlightPlanWaypoint(1);
            }
          },
          {
            key: 'WPSEL',
            label: '↓',
            states: [''],
            stateIndex: 0,
            minimal: true,
            managedExternally: true,
            combinedGroupLabel: 'WP',
            show() { return OptionModule.getOption('NAV', 'DISPLAY', 'HSI') === 'HSI'; },
            onClick: () => {
              this.stepSelectedFlightPlanWaypoint(-1);
            }
          },
        ],
        rightButtons: [
          {
            key: 'RANGE',
            label: '↑',
            states: ['1', '2.5', '5', '10', '20', '40', '80', '160'],
            values: [1, 2.5, 5, 10, 20, 40, 80, 160],
            stateIndex: 5,
            managedExternally: true,
            minimal: true,
            combinedGroupLabel: 'RNG',
            onClick: () => {
              this.mapModule.stepRange(1);
            }
          },
          {
            key: 'RANGE',
            label: '↓',
            states: ['1', '2.5', '5', '10', '20', '40', '80', '160'],
            values: [1, 2.5, 5, 10, 20, 40, 80, 160],
            stateIndex: 5,
            managedExternally: true,
            minimal: true,
            combinedGroupLabel: 'RNG',
            onClick: () => {
              this.mapModule.stepRange(-1);
            }
          },
          {
            key: 'ACSEL',
            label: '→',
            states: ['A/C'],
            values: ['A/C'],
            stateIndex: 0,
            managedExternally: true,
            minimal: true,
            combinedGroupLabel: 'AC',
            onClick: () => {
              this.mapModule.stepSelectedTraffic(1);
            }
          },
          {
            key: 'ACSEL',
            label: '←',
            states: ['A/C'],
            values: ['A/C'],
            stateIndex: 0,
            managedExternally: true,
            minimal: true,
            combinedGroupLabel: 'AC',
            onClick: () => {
              this.mapModule.stepSelectedTraffic(-1);
            }
          },
          {
            key: 'CLEAR',
            label: 'CLR',
            states: [''],
            stateIndex: 0,
            managedExternally: true,
            onClick: () => {
              this.mapModule.clearSelectedTraffic();
            }
          }
        ],
        lines: [],
        render: (renderer, renderContext) => {
          const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
          const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
          const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
          const color = renderContext?.color ?? '#00ff66';
          if (!ctx) return;

          window.addonRuntime.navRdrRuntime = window.addonRuntime.navRdrRuntime || { bootStartMs: 0 };

          const engOn = Boolean(window.geofs?.animation?.values?.enginesOn);
          if (!engOn) {
            window.addonRuntime.navRdrRuntime.bootStartMs = 0;
          } else if (!window.addonRuntime.navRdrRuntime.bootStartMs) {
            window.addonRuntime.navRdrRuntime.bootStartMs = Date.now();
          }

          const elapsedMs = engOn ? (Date.now() - window.addonRuntime.navRdrRuntime.bootStartMs) : 0;
          const bootReady = engOn && elapsedMs >= 4000;

          const contentX = w * 0.19;
          const contentY = h * 0.13;
          const contentW = w * 0.62;
          const contentH = h * 0.74;

          const mode = OptionModule.getOptionValue('NAV', 'DISPLAY', 'HSI');
          const declutterLevel = OptionModule.getOptionValue('NAV', 'DECLUTTER', 'OFF');
          const radarEnabled = OptionModule.getOptionValue('RDR', 'RADAR', 'OFF') === 'ON';

          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          if (mode !== 'MAP') {
            ctx.fillStyle = '#000000';
            ctx.fillRect(contentX, contentY, contentW, contentH);
          }

          if (!engOn) {
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
            ctx.fillText('NAV OFF', contentX + contentW * 0.5, contentY + contentH * 0.5);
            ctx.restore();
            return;
          }

          if (!bootReady) {
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
            ctx.fillText('ALIGNING NAV...', contentX + contentW * 0.5, contentY + contentH * 0.5);
            ctx.restore();
            return;
          }

          const scene = this.mapModule.getSceneData();
          const rangeNm = Math.max(1, Number(scene?.rangeNm) || 40);
          const shouldShowTraffic = radarEnabled && declutterLevel !== 'L2';
          if (!shouldShowTraffic) {
            this.mapModule.clearSelectedTraffic();
          }
          const visibleTraffic = shouldShowTraffic ? this.mapModule.getFilteredTraffic(scene?.traffic ?? []) : [];
          const selectedTrafficUid = shouldShowTraffic ? this.mapModule.getSelectedTrafficUid(visibleTraffic) : null;
          const selectedTraffic = visibleTraffic.find((c) => String(c?.uid ?? '') === String(selectedTrafficUid ?? '')) ?? null;
          const dataCartridgeScene = this.getDataCartridgeScene();
          const waypointColor = '#3da2ff';
          const navObjectTextPx = Math.round(h * 0.032);

          const drawOwnshipSymbol = (x, y, size = 1, headingRelDeg = 0) => {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            const fuselageHalf = h * 0.032 * size;
            const wingY = -h * 0.010 * size;
            const wingHalf = h * 0.028 * size;
            const tailY = h * 0.024 * size;
            const tailHalf = h * 0.014 * size;
            const angleRad = (Number(headingRelDeg) || 0) * Math.PI / 180;

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angleRad);
            ctx.beginPath();
            ctx.moveTo(0, -fuselageHalf);
            ctx.lineTo(0, fuselageHalf);
            ctx.moveTo(-wingHalf, wingY);
            ctx.lineTo(wingHalf, wingY);
            ctx.moveTo(-tailHalf, tailY);
            ctx.lineTo(tailHalf, tailY);
            ctx.stroke();
            ctx.restore();
          };

          const drawWaypointDiamond = (x, y, selected = false) => {
            const size = selected ? Math.max(5, h * 0.012) : Math.max(4, h * 0.010);
            if (selected) {
              ctx.fillStyle = waypointColor;
              ctx.beginPath();
              ctx.moveTo(x, y - size);
              ctx.lineTo(x + size, y);
              ctx.lineTo(x, y + size);
              ctx.lineTo(x - size, y);
              ctx.closePath();
              ctx.fill();
            }
            ctx.strokeStyle = waypointColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size, y);
            ctx.lineTo(x, y + size);
            ctx.lineTo(x - size, y);
            ctx.closePath();
            ctx.stroke();
          };

          const drawCartridgePoint = (x, y, pointColor, label = '', isMarkpoint = false) => {
            const radius = Math.max(3.5, h * 0.008);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.fillStyle = pointColor;

            if (isMarkpoint) {
              ctx.beginPath();
              ctx.moveTo(x, y - radius - 1);
              ctx.lineTo(x + radius, y + radius);
              ctx.lineTo(x - radius, y + radius);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(x, y, radius, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }

            if (declutterLevel !== 'L2' && label) {
              ctx.fillStyle = pointColor;
              ctx.font = `bold ${Math.round(h * 0.026)}px monospace`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText(label.slice(0, 10), x + w * 0.010, y - h * 0.012);
            }
          };

          const drawCartridgeAreaPath = (points, style) => {
            if (!Array.isArray(points) || points.length < 3) return;

            ctx.strokeStyle = style.color;
            ctx.lineWidth = 1.4;
            ctx.fillStyle = style.fillColor;
            ctx.globalAlpha = Number.isFinite(style.fillOpacity) ? style.fillOpacity : 0.12;
            ctx.beginPath();
            for (let i = 0; i < points.length; i++) {
              const p = points[i];
              if (!p) continue;
              if (i === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.stroke();
          };

          const drawTrafficContact = (x, y, contact, upHeadingDeg = Number(scene?.ownship?.heading) || 0) => {
            const isSelected = String(contact?.uid ?? '') === String(selectedTrafficUid ?? '');
            const trafficColor = this.mapModule.getTrafficColor(contact);

            if (declutterLevel === 'L1') {
              ctx.fillStyle = trafficColor;
              const boxSize = Math.max(8, Math.round(h * 0.018));
              ctx.fillRect(x - boxSize * 0.5, y - boxSize * 0.5, boxSize, boxSize);

              if (isSelected) {
                const pad = 2;
                const left = x - boxSize * 0.5 - pad;
                const right = x + boxSize * 0.5 + pad;
                const top = y - boxSize * 0.5 - pad;
                const bottom = y + boxSize * 0.5 + pad;
                const arm = Math.max(5, h * 0.012);
                ctx.strokeStyle = '#ff3333';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(left, top + arm); ctx.lineTo(left, top); ctx.lineTo(left + arm, top);
                ctx.moveTo(right - arm, top); ctx.lineTo(right, top); ctx.lineTo(right, top + arm);
                ctx.moveTo(left, bottom - arm); ctx.lineTo(left, bottom); ctx.lineTo(left + arm, bottom);
                ctx.moveTo(right - arm, bottom); ctx.lineTo(right, bottom); ctx.lineTo(right, bottom - arm);
                ctx.stroke();
              }
              return;
            }

            const number = this.mapModule.getContactNumber(contact);
            const glyph = String(number);

            ctx.fillStyle = trafficColor;
            ctx.font = `bold ${navObjectTextPx}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(glyph, x, y);

            const numberHalfH = Math.max(h * 0.016, 8);
            const roofHalfW = Math.max(w * 0.022, 10);
            const roofY = y - numberHalfH - h * 0.007;
            const legLen = Math.max(h * 0.022, 10);

            ctx.strokeStyle = trafficColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - roofHalfW, roofY);
            ctx.lineTo(x + roofHalfW, roofY);
            ctx.moveTo(x - roofHalfW, roofY);
            ctx.lineTo(x - roofHalfW, roofY + legLen);
            ctx.moveTo(x + roofHalfW, roofY);
            ctx.lineTo(x + roofHalfW, roofY + legLen);
            ctx.stroke();

            const track = Number(contact?.trackDeg);
            const relTrackRad = Number.isFinite(track)
              ? ((track - upHeadingDeg) * Math.PI / 180)
              : 0;
            const dirX = Math.sin(relTrackRad);
            const dirY = -Math.cos(relTrackRad);
            const numberRadius = Math.max(h * 0.021, 11);
            const lineStart = numberRadius + 2;
            const lineLen = Math.max(h * 0.034, 16);

            ctx.beginPath();
            ctx.moveTo(x + dirX * lineStart, y + dirY * lineStart);
            ctx.lineTo(x + dirX * (lineStart + lineLen), y + dirY * (lineStart + lineLen));
            ctx.stroke();

            if (isSelected) {
              const pad = 2;
              const left = x - roofHalfW - pad;
              const right = x + roofHalfW + pad;
              const top = roofY - pad;
              const bottom = y + numberHalfH + pad;
              const arm = Math.max(5, h * 0.012);
              ctx.strokeStyle = '#ff3333';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(left, top + arm); ctx.lineTo(left, top); ctx.lineTo(left + arm, top);
              ctx.moveTo(right - arm, top); ctx.lineTo(right, top); ctx.lineTo(right, top + arm);
              ctx.moveTo(left, bottom - arm); ctx.lineTo(left, bottom); ctx.lineTo(left + arm, bottom);
              ctx.moveTo(right - arm, bottom); ctx.lineTo(right, bottom); ctx.lineTo(right, bottom - arm);
              ctx.stroke();
            }
          };

          const drawSelectedTrafficInfo = (anchorX, anchorY) => {
            if (!selectedTraffic) return;
            const infoColor = '#ff3333';
            const lineStep = h * 0.040;
            let y = anchorY;

            const name = String(selectedTraffic?.aircraftName ?? '').trim() || 'UNKNOWN';
            const callsign = String(selectedTraffic?.callsign ?? '').trim() || 'N/A';
            const speed = Number.isFinite(selectedTraffic?.speedKts) ? selectedTraffic.speedKts : '--';
            const altitude = Number.isFinite(selectedTraffic?.altFeet) ? selectedTraffic.altFeet : '--';
            const headingSel = Number.isFinite(selectedTraffic?.headingDeg) ? selectedTraffic.headingDeg : '--';
            const selectedNumber = this.mapModule.getContactNumber(selectedTraffic);

            ctx.fillStyle = infoColor;
            ctx.font = `bold ${Math.round(h * 0.040)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`TGT ${selectedNumber}`, anchorX, y);
            y += lineStep;
            ctx.fillText(`${name} / ${callsign}`.slice(0, 34), anchorX, y);
            y += lineStep;
            ctx.fillText(`SPD ${speed}`, anchorX, y);
            y += lineStep;
            ctx.fillText(`ALT ${altitude}`, anchorX, y);
            y += lineStep;
            ctx.fillText(`HDG ${headingSel}`, anchorX, y);
          };

          const drawRadarOffInfo = (anchorX, anchorY) => {
            if (radarEnabled || String(declutterLevel).toUpperCase() !== 'OFF') return;
            ctx.fillStyle = '#ffff33';
            ctx.font = `bold ${Math.round(h * 0.040)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Radar OFF', anchorX, anchorY);
          };

          if (mode === 'HSI') {
            const heading = Number(scene?.ownship?.heading) || Number(window.geofs?.animation?.values?.heading) || 0;
            const cx = contentX + contentW * 0.5;
            const compassShiftPx = h * 0.016;
            const cy = contentY + contentH * 0.525 + compassShiftPx;
            const radius = Math.min(contentW * 0.44, h * 0.305) + compassShiftPx;
            const navTextPx = Math.round(h * 0.040);
            const headingTextPx = Math.round(h * 0.046);
            const headingBoxW = w * 0.13;
            const headingBoxH = h * 0.060;
            const headingBoxY = Math.max(contentY + h * 0.002, cy - radius - h * 0.129);
            const navReadouts = this.getReadouts();
            const hasNavCourse = Number.isFinite(navReadouts.course);
            const courseDisplay = hasNavCourse ? ((navReadouts.course % 360) + 360) % 360 : null;
            const hasAutopilotHeading = Number.isFinite(navReadouts.autopilotHeading);
            const autopilotHeadingDisplay = hasAutopilotHeading ? ((navReadouts.autopilotHeading % 360) + 360) % 360 : null;

            const projectHsi = (point) => {
              const right = Number(point?.rightNm);
              const forward = Number(point?.forwardNm);
              if (!Number.isFinite(right) || !Number.isFinite(forward)) return null;
              return {
                x: cx + (right / rangeNm) * radius,
                y: cy - (forward / rangeNm) * radius
              };
            };

            for (let deg = 0; deg < 360; deg += 10) {
              const relRad = (deg - heading) * Math.PI / 180;
              const dotX = cx + Math.sin(relRad) * radius;
              const dotY = cy - Math.cos(relRad) * radius;
              const dotR = deg % 30 === 0 ? Math.max(1.8, h * 0.0038) : Math.max(1.2, h * 0.0026);

              const isCardinal = deg % 90 === 0;
              const hasLabel = deg % 30 === 0 && !(declutterLevel === 'L2' && !isCardinal);

              if (!hasLabel) {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
                ctx.fill();
              }

              if (hasLabel) {
                const label = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(Math.round(deg / 10));
                ctx.fillStyle = color;
                ctx.font = `bold ${navTextPx}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, dotX, dotY);
              }
            }

            if (declutterLevel === 'OFF') {
              ctx.fillStyle = color;
              ctx.font = `bold ${navTextPx}px monospace`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'top';
              const kias = Number(window.geofs?.animation?.values?.kias) || 0;
              const topReadoutY = headingBoxY;
              const rowStepY = h * 0.052;
              const leftReadoutX = contentX + contentW * 0.025;
              const rightReadoutX = contentX + contentW * 0.725;

              ctx.fillText(`GND ${Math.round(kias * 1.05)}`, leftReadoutX, topReadoutY);
              ctx.fillText(`TAS ${Math.round(kias * 1.15)}`, leftReadoutX, topReadoutY + rowStepY);

              const dmeText = Number.isFinite(navReadouts.dme) ? String(navReadouts.dme) : '--';
              const navaidText = navReadouts.navaidLabel || '';
              ctx.fillText(`DME ${dmeText}`, rightReadoutX, topReadoutY);
              if (navaidText) {
                ctx.fillText(navaidText, rightReadoutX, topReadoutY + rowStepY);
              }
              ctx.textBaseline = 'middle';
            }

            const normalizeDeg = (value) => {
              const deg = Number(value);
              if (!Number.isFinite(deg)) return 0;
              return ((Math.round(deg) % 360) + 360) % 360;
            };
            const headingDisplay = normalizeDeg(window.geofs?.animation?.values?.heading360 ?? 0);

            if (hasNavCourse) {
              const getValue = window.geofs?.animation?.getValue?.bind(window.geofs?.animation);
              const navCourseDeviation = getValue
                ? (getValue('NAVCourseDeviation') ?? 0)
                : (window.geofs?.animation?.values?.NAVCourseDeviation ?? 0);
              const courseOffsetPx = HelperModule.clampValue(5 * navCourseDeviation, -100, 100) * (w / 512);

              const courseRelRad = (courseDisplay - heading) * Math.PI / 180;
              const dirX = Math.sin(courseRelRad);
              const dirY = -Math.cos(courseRelRad);
              const leftX = dirY;
              const leftY = -dirX;
              const signedOffset = -courseOffsetPx;
              const lineCenterX = cx + leftX * signedOffset;
              const lineCenterY = cy + leftY * signedOffset;
              const offsetAbs = Math.abs(signedOffset);
              const lineInset = Math.max(h * 0.016, 6);
              const lineRadius = Math.max(8, radius - lineInset);
              const clampedOffsetAbs = Math.min(offsetAbs, Math.max(0, lineRadius - 2));
              const halfLen = Math.sqrt(Math.max(0, (lineRadius * lineRadius) - (clampedOffsetAbs * clampedOffsetAbs)));

              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(lineCenterX - dirX * halfLen, lineCenterY - dirY * halfLen);
              ctx.lineTo(lineCenterX + dirX * halfLen, lineCenterY + dirY * halfLen);
              ctx.stroke();

              const arrowTipX = lineCenterX + dirX * halfLen;
              const arrowTipY = lineCenterY + dirY * halfLen;
              const arrowLen = Math.max(h * 0.028, 10);
              const arrowHalfW = Math.max(h * 0.013, 5);
              const arrowBaseX = arrowTipX - dirX * arrowLen;
              const arrowBaseY = arrowTipY - dirY * arrowLen;
              ctx.beginPath();
              ctx.moveTo(arrowTipX, arrowTipY);
              ctx.lineTo(arrowBaseX + leftX * arrowHalfW, arrowBaseY + leftY * arrowHalfW);
              ctx.lineTo(arrowBaseX - leftX * arrowHalfW, arrowBaseY - leftY * arrowHalfW);
              ctx.closePath();
              ctx.fillStyle = color;
              ctx.fill();
            }

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.clip();

            const waypointPoints = [];
            for (const wp of (scene?.waypoints ?? [])) {
              const p = projectHsi(wp);
              if (!p) continue;
              waypointPoints.push({ ...p, wp });
            }

            const projectGeoToHsi = (lat, lon) => {
              const ownship = scene?.ownship;
              if (!ownship || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
              const relNm = this.mapModule.toRelativeNm(ownship, Number(lat), Number(lon));
              const framePoint = this.mapModule.toHeadingFrame(relNm, ownship.heading);
              return projectHsi(framePoint);
            };

            const sortedAreas = [...(dataCartridgeScene?.areas ?? [])]
              .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0));
            for (const area of sortedAreas) {
              const style = this.getAreaStyle(area?.type);
              if (String(area?.variant).toUpperCase() === 'CIRCLE') {
                const center = Array.isArray(area?.center) ? area.center : null;
                const centerPt = center ? projectGeoToHsi(center[0], center[1]) : null;
                const radiusMeters = Number(area?.radius);
                if (!centerPt || !Number.isFinite(radiusMeters) || radiusMeters <= 0) continue;
                const radiusPx = (radiusMeters / 1852) / rangeNm * radius;
                ctx.fillStyle = style.fillColor;
                ctx.globalAlpha = Number.isFinite(style.fillOpacity) ? style.fillOpacity : 0.12;
                ctx.beginPath();
                ctx.arc(centerPt.x, centerPt.y, radiusPx, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.strokeStyle = style.color;
                ctx.lineWidth = 1.4;
                ctx.stroke();
                continue;
              }

              const points = Array.isArray(area?.points) ? area.points : [];
              const projected = points.map((pt) => projectGeoToHsi(pt?.[0], pt?.[1])).filter(Boolean);
              drawCartridgeAreaPath(projected, style);
            }

            if (waypointPoints.length >= 2) {
              ctx.strokeStyle = waypointColor;
              ctx.lineWidth = 1.4;
              ctx.beginPath();
              for (let i = 0; i < waypointPoints.length; i++) {
                const p = waypointPoints[i];
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
              }
              ctx.stroke();
            }

            for (const p of waypointPoints) {
              drawWaypointDiamond(p.x, p.y, p.wp?.selected);
              if (declutterLevel !== 'L2') {
                ctx.fillStyle = waypointColor;
                ctx.font = `bold ${navObjectTextPx}px monospace`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const wpName = String(p.wp?.ident ?? '').slice(0, 10);
                const wpIndex = Number(p.wp?.index) + 1;
                ctx.fillText(`WP${wpIndex}`, p.x + w * 0.010, p.y - h * 0.018);
                if (wpName) {
                  ctx.fillText(wpName, p.x + w * 0.010, p.y + h * 0.016);
                }
              }
            }

            for (const navaid of (dataCartridgeScene?.navaids ?? [])) {
              const p = projectGeoToHsi(navaid?.lat, navaid?.lon);
              if (!p) continue;
              const label = String(navaid?.ident ?? navaid?.icao ?? navaid?.name ?? '').trim();
              drawCartridgePoint(p.x, p.y, this.getNavaidColor(navaid?.missionType), label, false);
            }

            for (const markpoint of (dataCartridgeScene?.markpoints ?? [])) {
              const p = projectGeoToHsi(markpoint?.lat, markpoint?.lon);
              if (!p) continue;
              const label = String(markpoint?.abbreviation ?? markpoint?.name ?? '').trim();
              drawCartridgePoint(p.x, p.y, this.getMarkpointColor(markpoint?.type), label, true);
            }

            if (shouldShowTraffic) {
              for (const ac of visibleTraffic) {
                const p = projectHsi(ac);
                if (!p) continue;
                drawTrafficContact(p.x, p.y, ac);
              }
            }

            ctx.restore();

            const bottomReadoutY = cy + radius + h * 0.045;

            if (hasAutopilotHeading) {
              const hdgBugRelRad = (autopilotHeadingDisplay - heading) * Math.PI / 180;
              const radialOutX = Math.sin(hdgBugRelRad);
              const radialOutY = -Math.cos(hdgBugRelRad);
              const radialInX = -radialOutX;
              const radialInY = -radialOutY;
              const tangentX = Math.cos(hdgBugRelRad);
              const tangentY = Math.sin(hdgBugRelRad);

              const bugHalfW = Math.max(w * 0.024, 9);
              const bugHalfH = Math.max(h * 0.010, 4);
              const bugMargin = Math.max(h * 0.020, 7);
              const bugCenterRadius = radius + bugHalfH + bugMargin;
              const bugCx = cx + radialOutX * bugCenterRadius;
              const bugCy = cy + radialOutY * bugCenterRadius;
              const vHalf = Math.max(w * 0.0135, bugHalfW * 0.48);
              const vDepth = Math.max(h * 0.013, 4);

              const outerCx = bugCx + radialOutX * bugHalfH;
              const outerCy = bugCy + radialOutY * bugHalfH;
              const innerCx = bugCx + radialInX * bugHalfH;
              const innerCy = bugCy + radialInY * bugHalfH;

              const outerLeftX = outerCx - tangentX * bugHalfW;
              const outerLeftY = outerCy - tangentY * bugHalfW;
              const outerRightX = outerCx + tangentX * bugHalfW;
              const outerRightY = outerCy + tangentY * bugHalfW;
              const innerLeftX = innerCx - tangentX * bugHalfW;
              const innerLeftY = innerCy - tangentY * bugHalfW;
              const innerRightX = innerCx + tangentX * bugHalfW;
              const innerRightY = innerCy + tangentY * bugHalfW;

              const notchLeftX = outerCx - tangentX * vHalf;
              const notchLeftY = outerCy - tangentY * vHalf;
              const notchRightX = outerCx + tangentX * vHalf;
              const notchRightY = outerCy + tangentY * vHalf;
              const notchTipX = outerCx + radialInX * vDepth;
              const notchTipY = outerCy + radialInY * vDepth;

              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(outerLeftX, outerLeftY);
              ctx.lineTo(notchLeftX, notchLeftY);
              ctx.moveTo(notchRightX, notchRightY);
              ctx.lineTo(outerRightX, outerRightY);
              ctx.moveTo(outerLeftX, outerLeftY);
              ctx.lineTo(innerLeftX, innerLeftY);
              ctx.moveTo(outerRightX, outerRightY);
              ctx.lineTo(innerRightX, innerRightY);
              ctx.moveTo(innerLeftX, innerLeftY);
              ctx.lineTo(innerRightX, innerRightY);
              ctx.moveTo(notchLeftX, notchLeftY);
              ctx.lineTo(notchTipX, notchTipY);
              ctx.lineTo(notchRightX, notchRightY);
              ctx.stroke();
            }

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;

            const markerHalf = headingBoxW * 0.11;
            const markerTipY = headingBoxY + headingBoxH + h * 0.020;
            const boxLeft = cx - headingBoxW * 0.5;
            const boxRight = cx + headingBoxW * 0.5;
            const boxTop = headingBoxY;
            const boxBottom = headingBoxY + headingBoxH;
            ctx.beginPath();
            ctx.moveTo(boxLeft, boxTop);
            ctx.lineTo(boxRight, boxTop);
            ctx.moveTo(boxLeft, boxTop);
            ctx.lineTo(boxLeft, boxBottom);
            ctx.moveTo(boxRight, boxTop);
            ctx.lineTo(boxRight, boxBottom);
            ctx.moveTo(boxLeft, boxBottom);
            ctx.lineTo(cx - markerHalf, boxBottom);
            ctx.moveTo(cx + markerHalf, boxBottom);
            ctx.lineTo(boxRight, boxBottom);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(cx - markerHalf, boxBottom);
            ctx.lineTo(cx, markerTipY);
            ctx.lineTo(cx + markerHalf, boxBottom);
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.font = `bold ${headingTextPx}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(headingDisplay).padStart(3, '0'), cx, headingBoxY + headingBoxH * 0.5);

            ctx.fillStyle = color;
            ctx.font = `bold ${navTextPx}px monospace`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            if (declutterLevel === 'OFF' && hasAutopilotHeading) {
              ctx.fillText(`HDG ${String(autopilotHeadingDisplay).padStart(3, '0')}`, contentX + contentW * 0.025, bottomReadoutY);
            }
            ctx.textAlign = 'right';
            if (declutterLevel === 'OFF' && hasNavCourse) {
              ctx.fillText(`CRS ${courseDisplay}`, contentX + contentW * 0.975, bottomReadoutY);
            }

            drawOwnshipSymbol(cx, cy, 1);
            if (!radarEnabled) {
              drawRadarOffInfo(cx, cy + h * 0.080);
            } else if (shouldShowTraffic) {
              drawSelectedTrafficInfo(cx, cy + h * 0.080);
            }
          } else {
            const layout = renderContext?.layout;
            const topTabs = Array.isArray(layout?.topTabs) ? layout.topTabs : [];
            const bottomTabs = Array.isArray(layout?.bottomTabs) ? layout.bottomTabs : [];
            const topStripBottom = topTabs.length
              ? Math.max(...topTabs.map((tab) => (tab?.y ?? 0) + (tab?.h ?? 0)))
              : (h * 0.11);
            const bottomStripTop = bottomTabs.length
              ? Math.min(...bottomTabs.map((tab) => tab?.y ?? h))
              : (h * 0.89);

            const mapLeft = 0;
            const mapRight = w;
            const mapTop = topStripBottom + h * 0.004;
            const mapBottom = bottomStripTop - h * 0.004;
            const mapW = mapRight - mapLeft;
            const mapH = mapBottom - mapTop;
            const mapViewFrame = this.mapModule.getMapViewFrame(scene, selectedTraffic);
            const anchorRatio = mapViewFrame?.anchor === 'center' ? 0.5 : (2 / 3);
            const anchorX = mapLeft + mapW * 0.5;
            const anchorY = mapTop + mapH * anchorRatio;
            const pxPerNm = Math.max(0.0001, (anchorY - mapTop) / rangeNm);
            const mapUpHeadingDeg = Number(mapViewFrame?.upHeadingDeg) || 0;

            const drawNorthArrow = () => {
              const arrowMargin = w * 0.185;
              const pivotX = mapRight - arrowMargin;
              const pivotY = arrowMargin;
              const shaftHalfLen = Math.max(h * 0.080, 32);
              const headLen = Math.max(h * 0.028, 12);
              const headHalfW = Math.max(w * 0.020, 8);
              const northRelRad = (0 - mapUpHeadingDeg) * Math.PI / 180;
              const dirX = Math.sin(northRelRad);
              const dirY = -Math.cos(northRelRad);
              const leftX = -dirY;
              const leftY = dirX;
              const textBgR = Math.max(h * 0.018, 9);
              const shaftGap = textBgR + 2;

              const tipX = pivotX + dirX * shaftHalfLen;
              const tipY = pivotY + dirY * shaftHalfLen;
              const tailX = pivotX - dirX * shaftHalfLen;
              const tailY = pivotY - dirY * shaftHalfLen;
              const baseX = tipX - dirX * headLen;
              const baseY = tipY - dirY * headLen;
              const nearTipGapX = pivotX + dirX * shaftGap;
              const nearTipGapY = pivotY + dirY * shaftGap;
              const nearTailGapX = pivotX - dirX * shaftGap;
              const nearTailGapY = pivotY - dirY * shaftGap;

              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(nearTipGapX, nearTipGapY);
              ctx.lineTo(tipX, tipY);
              ctx.moveTo(tailX, tailY);
              ctx.lineTo(nearTailGapX, nearTailGapY);
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(baseX + leftX * headHalfW, baseY + leftY * headHalfW);
              ctx.lineTo(baseX - leftX * headHalfW, baseY - leftY * headHalfW);
              ctx.closePath();
              ctx.fillStyle = color;
              ctx.fill();

              const textX = pivotX;
              const textY = pivotY;

              ctx.fillStyle = '#000000';
              ctx.beginPath();
              ctx.arc(textX, textY, textBgR, 0, Math.PI * 2);
              ctx.fill();

              ctx.strokeStyle = color;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(textX, textY, textBgR, 0, Math.PI * 2);
              ctx.stroke();

              ctx.fillStyle = color;
              ctx.font = `bold ${Math.round(h * 0.032)}px monospace`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('N', textX, textY);
            };

            const projectMap = (point, latKey = 'lat', lonKey = 'lon') => {
              const projected = this.mapModule.projectToMapViewFrame(mapViewFrame, point?.[latKey], point?.[lonKey]);
              const right = Number(projected?.rightNm);
              const forward = Number(projected?.forwardNm);
              if (!Number.isFinite(right) || !Number.isFinite(forward)) return null;
              return {
                x: anchorX + right * pxPerNm,
                y: anchorY - forward * pxPerNm
              };
            };

            ctx.save();
            ctx.beginPath();
            ctx.rect(mapLeft, mapTop, mapW, mapH);
            ctx.clip();

            const waypointPoints = [];
            for (const wp of (scene?.waypoints ?? [])) {
              const p = projectMap(wp, 'lat', 'lon');
              if (!p) continue;
              waypointPoints.push({ ...p, wp });
            }

            const sortedAreas = [...(dataCartridgeScene?.areas ?? [])]
              .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0));
            for (const area of sortedAreas) {
              const style = this.getAreaStyle(area?.type);
              if (String(area?.variant).toUpperCase() === 'CIRCLE') {
                const center = Array.isArray(area?.center) ? area.center : null;
                const centerPt = center ? projectMap({ lat: center[0], lon: center[1] }, 'lat', 'lon') : null;
                const radiusMeters = Number(area?.radius);
                if (!centerPt || !Number.isFinite(radiusMeters) || radiusMeters <= 0) continue;
                const radiusPx = (radiusMeters / 1852) * pxPerNm;
                ctx.fillStyle = style.fillColor;
                ctx.globalAlpha = Number.isFinite(style.fillOpacity) ? style.fillOpacity : 0.12;
                ctx.beginPath();
                ctx.arc(centerPt.x, centerPt.y, radiusPx, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.strokeStyle = style.color;
                ctx.lineWidth = 1.4;
                ctx.stroke();
                continue;
              }

              const points = Array.isArray(area?.points) ? area.points : [];
              const projected = points
                .map((pt) => projectMap({ lat: pt?.[0], lon: pt?.[1] }, 'lat', 'lon'))
                .filter(Boolean);
              drawCartridgeAreaPath(projected, style);
            }

            if (waypointPoints.length >= 2) {
              ctx.strokeStyle = waypointColor;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              for (let i = 0; i < waypointPoints.length; i++) {
                const p = waypointPoints[i];
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
              }
              ctx.stroke();
            }

            for (const p of waypointPoints) {
              drawWaypointDiamond(p.x, p.y, p.wp?.selected);
              if (declutterLevel !== 'L2') {
                ctx.fillStyle = waypointColor;
                ctx.font = `bold ${navObjectTextPx}px monospace`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const wpName = String(p.wp?.ident ?? '').slice(0, 10);
                const wpIndex = Number(p.wp?.index) + 1;
                ctx.fillText(`WP${wpIndex}`, p.x + w * 0.010, p.y - h * 0.018);
                if (wpName) {
                  ctx.fillText(wpName, p.x + w * 0.010, p.y + h * 0.016);
                }
              }
            }

            for (const navaid of (dataCartridgeScene?.navaids ?? [])) {
              const p = projectMap(navaid, 'lat', 'lon');
              if (!p) continue;
              const label = String(navaid?.ident ?? navaid?.icao ?? navaid?.name ?? '').trim();
              drawCartridgePoint(p.x, p.y, this.getNavaidColor(navaid?.missionType), label, false);
            }

            for (const markpoint of (dataCartridgeScene?.markpoints ?? [])) {
              const p = projectMap(markpoint, 'lat', 'lon');
              if (!p) continue;
              const label = String(markpoint?.abbreviation ?? markpoint?.name ?? '').trim();
              drawCartridgePoint(p.x, p.y, this.getMarkpointColor(markpoint?.type), label, true);
            }

            if (shouldShowTraffic) {
              for (const ac of visibleTraffic) {
                const p = projectMap(ac, 'lat', 'lon');
                if (!p) continue;
                drawTrafficContact(p.x, p.y, ac, mapUpHeadingDeg);
              }
            }

            const ownshipPoint = projectMap(scene?.ownship, 'lat', 'lon');
            if (ownshipPoint) {
              const ownshipHeading = Number(scene?.ownship?.heading) || 0;
              const ownshipRelHeading = ownshipHeading - mapUpHeadingDeg;
              drawOwnshipSymbol(ownshipPoint.x, ownshipPoint.y, 1, ownshipRelHeading);
            }
            if (!radarEnabled) {
              drawRadarOffInfo(anchorX, anchorY + h * 0.080);
            } else if (shouldShowTraffic) {
              drawSelectedTrafficInfo(anchorX, anchorY + h * 0.080);
            }

            drawNorthArrow();
            ctx.restore();
          }

          ctx.restore();
        }
      });
      return true;
    }

    getDataCartridgeModule() {
      if (this.dataCartridgeModule) return this.dataCartridgeModule;

      const aircraftId = String(window.geofs?.aircraft?.instance?.id ?? '');
      if (aircraftId === '27' && window.F18Addon?.dataCartridge) return window.F18Addon.dataCartridge;
      if (aircraftId === '3591' && window.F15Addon?.dataCartridge) return window.F15Addon.dataCartridge;
      if (window.F18Addon?.dataCartridge) return window.F18Addon.dataCartridge;
      if (window.F15Addon?.dataCartridge) return window.F15Addon.dataCartridge;

      return null;
    }

    getDataCartridgeScene() {
      const cartridge = this.getDataCartridgeModule();
      const data = cartridge?.getRenderableData?.() ?? cartridge?.getMissionData?.() ?? {};

      return {
        navaids: Array.isArray(data?.navaids) ? data.navaids : [],
        markpoints: Array.isArray(data?.markpoints) ? data.markpoints : [],
        areas: Array.isArray(data?.areas) ? data.areas : []
      };
    }

    getAreaStyle(type) {
      const cartridge = this.getDataCartridgeModule();
      if (cartridge?.getAreaStyle) {
        return cartridge.getAreaStyle(type);
      }

      const fallback = {
        SAM: { color: '#ff5252', fillColor: '#ff5252', fillOpacity: 0.18 },
        NOFLY: { color: '#ff9800', fillColor: '#ff9800', fillOpacity: 0.16 },
        UNRESTRICTED: { color: '#4caf50', fillColor: '#4caf50', fillOpacity: 0.12 },
        DANGER: { color: '#9c27b0', fillColor: '#9c27b0', fillOpacity: 0.16 },
        AREA: { color: '#03a9f4', fillColor: '#03a9f4', fillOpacity: 0.14 }
      };
      return fallback[type] ?? fallback.AREA;
    }

    getMarkpointColor(type) {
      const cartridge = this.getDataCartridgeModule();
      if (cartridge?.getMarkpointColor) {
        return cartridge.getMarkpointColor(type);
      }

      const fallback = {
        TARGET: '#f44336',
        FRIENDLY: '#2196f3',
        RESQUE: '#ff9800',
        CIVILIAN: '#4caf50'
      };
      return fallback[type] ?? '#00bcd4';
    }

    getNavaidColor(missionType) {
      const cartridge = this.getDataCartridgeModule();
      if (cartridge?.getNavaidColor) {
        return cartridge.getNavaidColor(missionType);
      }

      const fallback = {
        CIVILIAN: '#4caf50',
        FOO: '#f44336',
        FRIEND: '#2196f3',
        ALTERNATE: '#ff9800'
      };
      return fallback[missionType ?? 'FRIEND'] ?? '#2196f3';
    }

    // Returns the currently selected GeoFS NAV unit.
    getCurrentNavUnit() {
      return window.geofs?.nav?.currentNAVUnit ?? null;
    }

    // Returns rounded DME distance in NM when available.
    getDmeValue(navUnit = this.getCurrentNavUnit()) {
      const raw = Number(navUnit?.DME);
      if (!Number.isFinite(raw)) return null;
      return Math.round(raw * 10) / 10;
    }

    // Returns rounded bearing in degrees when available.
    getBearingDeg(navUnit = this.getCurrentNavUnit()) {
      const raw = Number(navUnit?.bearing);
      return Number.isFinite(raw) ? Math.round(raw) : null;
    }

    // Returns rounded NAV course in degrees when available.
    getCourseDeg(navUnit = this.getCurrentNavUnit()) {
      const raw = Number(navUnit?.course);
      return Number.isFinite(raw) ? Math.round(raw) : null;
    }

    // Returns time-to-signal in minutes when available.
    getTimeToSignal(navUnit = this.getCurrentNavUnit()) {
      const raw = Number(navUnit?.timeToSignal);
      return Number.isFinite(raw) ? Math.round(raw) : null;
    }

    // Returns autopilot heading/course selector in degrees when available.
    getAutopilotHeadingDeg() {
      const raw = Number(window.geofs?.autopilot?.values?.course);
      return Number.isFinite(raw) ? Math.round(raw) : null;
    }

    // Returns FOO visibility setting from the RDR page.
    getFooVisibilityMode() {
      return OptionModule.getOptionValue('RDR', 'FOO', 'SHOW');
    }

    // Returns true when contacts with callsign FOO should be hidden.
    shouldHideFooContacts() {
      return this.getFooVisibilityMode() === 'HIDE';
    }

    // Returns true when a callsign equals FOO (case-insensitive).
    isFooCallsign(callsign) {
      return callsign === 'FOO';
    }

    // Returns true when one traffic contact is allowed by current FOO filter.
    isTrafficContactVisible(callsign) {
      if (!this.shouldHideFooContacts()) return true;
      return !this.isFooCallsign(callsign);
    }

    // Filters a multiplayer user list using the FOO visibility setting.
    filterMultiplayerContacts(users) {
      const list = Array.isArray(users) ? users : [];
      return list.filter((user) => this.isTrafficContactVisible(user?.callsign ?? user?.cs));
    }

    // Formats navaid type + identifier for HUD/MFD display.
    getNavaidTypeLabel(navUnit = this.getCurrentNavUnit()) {
      if (navUnit?.navaid?.type === 'ILS') {
        const icao = navUnit?.navaid?.icao ?? '';
        return `ILS ${icao}`.trim();
      }
      if (navUnit?.navaid?.type === 'VORTAC') {
        const ident = navUnit?.navaid?.ident ?? navUnit?.navaid?.icao ?? '';
        return `VOR ${ident}`.trim();
      }

      const type = String(navUnit?.navaid?.type ?? '').trim();
      let ident = navUnit?.navaid?.ident;
      if (!ident) {
        ident = navUnit?.navaid?.icao ?? '';
      }
      const identText = String(ident ?? '').trim();
      return `${type} ${identText}`.trim();
    }

    // Returns all commonly rendered NAV readouts as a single object.
    getReadouts(navUnit = this.getCurrentNavUnit()) {
      return {
        navUnit,
        dme: this.getDmeValue(navUnit),
        bearing: this.getBearingDeg(navUnit),
        course: this.getCourseDeg(navUnit),
        timeToSignal: this.getTimeToSignal(navUnit),
        navaidLabel: this.getNavaidTypeLabel(navUnit),
        autopilotHeading: this.getAutopilotHeadingDeg()
      };
    }

    // Selects next/previous flightplan waypoint relative to current selection.
    stepSelectedFlightPlanWaypoint(step = 1) {
      const direction = Number(step) >= 0 ? 1 : -1;
      const flightPlan = window.geofs?.flightPlan;
      const waypointArray = flightPlan?.waypointArray;

      if (!Array.isArray(waypointArray) || waypointArray.length === 0) return false;
      if (typeof flightPlan?.selectWaypoint !== 'function') return false;

      const currentIndex = waypointArray.findIndex((waypoint) => waypoint?.selected === true);
      const baseIndex = currentIndex >= 0
        ? currentIndex
        : (direction > 0 ? -1 : 0);
      const nextIndex = (baseIndex + direction + waypointArray.length) % waypointArray.length;

      flightPlan.selectWaypoint(nextIndex);
      return true;
    }
  }