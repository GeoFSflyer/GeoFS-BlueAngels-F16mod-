class RadarModule {
  constructor(dependencies = {}) {
    this.navModule = dependencies.navModule ?? null;
    this.weaponModule = dependencies.weaponModule ?? null;
    this.hardLockedUid = null;
    this.sweepAngle = 0; // Current sweep position (0-100)
    this.sweepDirection = 1; // 1 = left to right, -1 = right to left
    this.lastSweepUpdateTime = 0;
    this.verticalScanPos = 0; // Current vertical scan position (0-100)
    this.verticalScanDirection = 1; // 1 = down, -1 = up
    this.lastVerticalScanUpdateTime = 0;
    this.visibleAircraftInCone = []; // Store currently visible aircraft in cone
    this.lastContactUpdateTime = 0; // Timestamp of last contact update
    this.cachedAircraftInCone = []; // Cached aircraft positions
  }

  setNavModule(navModule) {
    this.navModule = navModule;
    return this;
  }

  setWeaponModule(weaponModule) {
    this.weaponModule = weaponModule;
    return this;
  }

  stepSelectedTrafficInCone(direction) {
    const mapModule = this.navModule?.mapModule;
    if (!mapModule || !this.visibleAircraftInCone.length) return;

    const currentUid = String(mapModule.selectedTrafficUid ?? '');
    const uids = [...new Set(this.visibleAircraftInCone
      .map((a) => String(a?.uid ?? '').trim())
      .filter(Boolean))];
    if (!uids.length) return;

    if (!currentUid || !uids.includes(currentUid)) {
      // Select first aircraft
      mapModule.selectedTrafficUid = uids[0];
      return;
    }

    const currentIndex = uids.indexOf(currentUid);
    const newIndex = (currentIndex + direction + uids.length) % uids.length;
    mapModule.selectedTrafficUid = uids[newIndex];
  }

  registerMfdPages(mfdModule) {
    const radarModule = this;

    mfdModule.registerPage({
      title: 'RDR',
      leftButtons: [
        {
          key: 'RADAR',
          label: 'RDR',
          states: ['OFF', 'ON'],
          stateIndex: 0,
          onClick: ({ nextState }) => {
            if (String(nextState ?? '').toUpperCase() !== 'ON') return;
            window.addonRuntime = window.addonRuntime || {};
            window.addonRuntime.navRdrRuntime = window.addonRuntime.navRdrRuntime || { bootStartMs: 0 };
            window.addonRuntime.navRdrRuntime.bootStartMs = Date.now();
          }
        },
        {
          key: 'FOO',
          label: 'FOO',
          states: ['SH', 'HD'],
          stateIndex: 0,
          managedExternally: true,
          onClick: () => {
            const current = OptionModule.getOptionValue('RDR', 'FOO', 'SH');
            OptionModule.setOption('RDR', 'FOO', current === 'SH' ? 'HD' : 'SH');
          }
        },
        {
          key: 'LOCK',
          label: 'LOCK',
          states: [''],
          stateIndex: 0,
          onClick: () => {
            const mapModule = radarModule.navModule?.mapModule;
            if (!mapModule) return;
            const selectedUid = String(mapModule.selectedTrafficUid ?? '').trim();
            if (!selectedUid) return;

            // Toggle lock when pressing LOCK on the already locked target.
            if (String(radarModule.hardLockedUid ?? '') === selectedUid) {
              radarModule.hardLockedUid = null;
              return;
            }

            radarModule.hardLockedUid = selectedUid;
          }
        },
        {
          key: 'SCAN',
          label: 'SCN',
          states: ['6B', '3B'],
          stateIndex: 0,
          managedExternally: true,
          onClick: () => {
            const current = OptionModule.getOptionValue('RDR', 'SCAN', '6B');
            OptionModule.setOption('RDR', 'SCAN', current === '6B' ? '3B' : '6B');
          }
        },
        {
          key: 'FIRE',
          label: 'FIRE',
          states: [''],
          stateIndex: 0,
          onClick: () => {
            const mode = OptionModule.getOption('WPN', 'MODE', 'NAV');
            const modeLoadout = radarModule.weaponModule?.getModeLoadout(mode);
            if (radarModule.weaponModule && modeLoadout) {
              radarModule.weaponModule.fireSelectedWeapon(mode, modeLoadout);
            }
          },
          show: () => {
            return window.controls?.gear?.position === 1 && 
                   window.geofs?.animation?.values?.haglFeet > 50 && 
                   OptionModule.getOption('WPN', 'MASTER', 'OFF') !== 'OFF' &&
                   OptionModule.getOption('WPN', 'MODE', 'NAV') === 'A/A';
          }
        }
      ],
      rightButtons: [
        {
          key: 'RANGE',
          label: '↑',
          states: ['5', '10', '20', '40', '80', '160'],
          values: [5, 10, 20, 40, 80, 160],
          stateIndex: 2,
          managedExternally: true,
          minimal: true,
          combinedGroupLabel: 'RNG',
          onClick: () => {
            const currentValues = [5, 10, 20, 40, 80, 160];
            const currentVal = Number(OptionModule.getOptionValue('RDR', 'RANGE', 20));
            const currentIndex = currentValues.indexOf(currentVal);
            const newIndex = Math.min(currentValues.length - 1, currentIndex + 1);
            OptionModule.setOption('RDR', 'RANGE', String(currentValues[newIndex]));
          }
        },
        {
          key: 'RANGE',
          label: '↓',
          states: ['5', '10', '20', '40', '80', '160'],
          values: [5, 10, 20, 40, 80, 160],
          stateIndex: 2,
          managedExternally: true,
          minimal: true,
          combinedGroupLabel: 'RNG',
          onClick: () => {
            const currentValues = [5, 10, 20, 40, 80, 160];
            const currentVal = Number(OptionModule.getOptionValue('RDR', 'RANGE', 20));
            const currentIndex = currentValues.indexOf(currentVal);
            const newIndex = Math.max(0, currentIndex - 1);
            OptionModule.setOption('RDR', 'RANGE', String(currentValues[newIndex]));
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
            // Cycle through aircraft visible in cone only
            radarModule.stepSelectedTrafficInCone(1);
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
            // Cycle through aircraft visible in cone only  
            radarModule.stepSelectedTrafficInCone(-1);
          }
        },
        {
          key: 'CLEAR',
          label: 'CLR',
          states: [''],
          stateIndex: 0,
          managedExternally: true,
          onClick: () => {
            radarModule.navModule?.mapModule?.clearSelectedTraffic();
            radarModule.hardLockedUid = null;
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

        window.addonRuntime = window.addonRuntime || {};
        window.addonRuntime.navRdrRuntime = window.addonRuntime.navRdrRuntime || { bootStartMs: 0 };

        const engOn = Boolean(window.geofs?.animation?.values?.enginesOn);
        if (!engOn) {
          window.addonRuntime.navRdrRuntime.bootStartMs = 0;
        } else if (!window.addonRuntime.navRdrRuntime.bootStartMs) {
          window.addonRuntime.navRdrRuntime.bootStartMs = Date.now();
        }

        const elapsedMs = engOn ? (Date.now() - window.addonRuntime.navRdrRuntime.bootStartMs) : 0;
        const bootReady = engOn && elapsedMs >= 5000;

        const contentX = w * 0.14;
        const contentY = h * 0.10;
        const contentW = w * 0.74;
        const contentH = h * 0.80;

        const rangeNmRaw = Number(OptionModule.getOptionValue('RDR', 'RANGE', 20));
        const rangeNm = Number.isFinite(rangeNmRaw) && rangeNmRaw > 0 ? rangeNmRaw : 20;
        const radarEnabled = OptionModule.getOptionValue('RDR', 'RADAR', 'OFF') === 'ON';
        const fooMode = OptionModule.getOptionValue('RDR', 'FOO', 'SH');
        const scanMode = OptionModule.getOptionValue('RDR', 'SCAN', '6B');
        const weaponMasterState = String(OptionModule.getOptionValue('WPN', 'MASTER', 'OFF')).toUpperCase();
        const weaponMode = String(OptionModule.getOptionValue('WPN', 'MODE', 'NAV')).toUpperCase();
        const modeLoadout = radarModule.weaponModule?.getModeLoadout(weaponMode);
        const selectedWeaponLabel = modeLoadout
          ? radarModule.weaponModule.getSelectedLoadDisplay(weaponMode, modeLoadout)
          : 'N/A';
        const selectedWeaponEffectiveness = modeLoadout
          ? radarModule.weaponModule.getSelectedWeaponEffectiveness(weaponMode, modeLoadout)
          : null;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#000000';
        ctx.fillRect(contentX, contentY, contentW, contentH);

        if (!engOn) {
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
          ctx.fillText('RDR OFF', contentX + contentW * 0.5, contentY + contentH * 0.5);
          ctx.restore();
          return;
        }

        if (!bootReady) {
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
          ctx.fillText('RADAR BIT TEST...', contentX + contentW * 0.5, contentY + contentH * 0.5);
          ctx.restore();
          return;
        }

        if (!radarEnabled) {
          ctx.fillStyle = '#ffff33';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.075)}px monospace`;
          ctx.fillText('Radar OFF', contentX + contentW * 0.5, contentY + contentH * 0.5);
          ctx.restore();
          return;
        }

        const navModule = radarModule.navModule;
        const mapModule = navModule?.mapModule;
        const scene = mapModule?.getSceneData?.();
        const ownship = scene?.ownship ?? null;
        const trafficContactsAll = Array.isArray(scene?.traffic) ? scene.traffic : [];
        const trafficContacts = fooMode === 'HD'
          ? trafficContactsAll.filter((contact) => contact.callsign !== 'Foo')
          : trafficContactsAll;
        const myHeading = Number(ownship?.heading ?? window.geofs?.animation?.values?.heading) || 0;
        const myPitch = -Number(window.geofs?.animation?.values?.atilt);
        const myAltMeters = Number(ownship?.alt ?? window.geofs?.aircraft?.instance?.llaLocation?.[2]) || 0;

        // Define display area - wider, extending further left and right
        const margin = contentW * 0.02;
        const displayLeft = contentX + margin;
        const displayRight = contentX + contentW - margin;
        const displayTop = contentY + contentH * 0.06;
        const displayBottom = contentY + contentH * 0.95;
        const displayWidth = displayRight - displayLeft;
        const displayHeight = displayBottom - displayTop;

        // Update sweep angle
        const sweepMs = scanMode === '3B' ? 500 : 1000;
        const sweepNow = Date.now();
        if (!radarModule.lastSweepUpdateTime) {
          radarModule.lastSweepUpdateTime = sweepNow;
        }
        const deltaMs = sweepNow - radarModule.lastSweepUpdateTime;
        radarModule.lastSweepUpdateTime = sweepNow;
        radarModule.sweepAngle += radarModule.sweepDirection * (deltaMs * (100 / sweepMs));
        if (radarModule.sweepAngle >= 100) {
          radarModule.sweepAngle = 100;
          radarModule.sweepDirection = -1;
        } else if (radarModule.sweepAngle <= 0) {
          radarModule.sweepAngle = 0;
          radarModule.sweepDirection = 1;
        }
        const sweepX = displayLeft + (radarModule.sweepAngle / 100) * displayWidth;

        const verticalNow = Date.now();
        if (!radarModule.lastVerticalScanUpdateTime) {
          radarModule.lastVerticalScanUpdateTime = verticalNow;
        }
        const verticalDeltaMs = verticalNow - radarModule.lastVerticalScanUpdateTime;
        radarModule.lastVerticalScanUpdateTime = verticalNow;
        radarModule.verticalScanPos += radarModule.verticalScanDirection * (verticalDeltaMs * (100 / sweepMs));
        if (radarModule.verticalScanPos >= 100) {
          radarModule.verticalScanPos = 100;
          radarModule.verticalScanDirection = -1;
        } else if (radarModule.verticalScanPos <= 0) {
          radarModule.verticalScanPos = 0;
          radarModule.verticalScanDirection = 1;
        }

        const selectedTrafficUid = mapModule?.selectedTrafficUid ?? null;

        // Cone parameters by scan mode
        const CONE_HALF_ANGLE_H = scanMode === '3B' ? 15 : 30;
        const CONE_HALF_ANGLE_V = scanMode === '3B' ? 15 : 30;

        // Update contacts by scan mode
        const currentTime = Date.now();
        const contactUpdateMs = scanMode === '3B' ? 500 : 1000;
        const shouldUpdate = (currentTime - radarModule.lastContactUpdateTime) >= contactUpdateMs;
        
        let aircraftInCone = radarModule.cachedAircraftInCone;
        if (shouldUpdate && ownship) {
          radarModule.lastContactUpdateTime = currentTime;
          aircraftInCone = [];
          for (const contact of trafficContacts) {
            const uid = contact?.uid;
            if (!uid) continue;

            if (typeof mapModule?.isContactAllowedByShowFilter === 'function' && !mapModule.isContactAllowedByShowFilter(contact)) {
              continue;
            }

            const forwardNm = Number(contact?.forwardNm);
            const rightNm = Number(contact?.rightNm);
            if (!Number.isFinite(forwardNm) || !Number.isFinite(rightNm)) continue;

            const distanceNm = Math.sqrt((forwardNm * forwardNm) + (rightNm * rightNm));
            if (!Number.isFinite(distanceNm) || distanceNm <= 0 || distanceNm >= rangeNm) continue;

            // Calculate relative bearing using heading-frame coordinates.
            // In this frame: +forward is nose direction, +right is right wing.
            const relativeBearing = (Math.atan2(rightNm, forwardNm) * 180 / Math.PI);

            // Check if within horizontal cone
            if (Math.abs(relativeBearing) > CONE_HALF_ANGLE_H) continue;

            // Calculate elevation angle
            const horizontalDistM = Math.max(1, distanceNm * 1852);
            const targetAltMeters = Number(contact?.alt);
            const altDiff = (Number.isFinite(targetAltMeters) ? targetAltMeters : myAltMeters) - myAltMeters;
            const elevationAngle = Math.atan2(altDiff, horizontalDistM) * 180 / Math.PI;
            const relativeElevation = elevationAngle - myPitch;

            // Check if within vertical cone
            if (Math.abs(relativeElevation) > CONE_HALF_ANGLE_V) continue;

            const xRatio = (relativeBearing + CONE_HALF_ANGLE_H) / (2 * CONE_HALF_ANGLE_H);
            const x = displayLeft + xRatio * displayWidth;
            const yRatio = distanceNm / rangeNm;
            const y = displayBottom - yRatio * displayHeight;

            // Get track direction
            const track = Number(contact?.trackDeg ?? contact?.headingDeg ?? 0);

            // Add aircraft to list (always show all aircraft in cone)
            aircraftInCone.push({
              x, y, uid, distanceNm, relativeBearing, relativeElevation, track,
              altKft: Number.isFinite(Number(contact?.altFeet))
                ? Math.round(Number(contact.altFeet) / 1000)
                : Math.round(((Number(contact?.alt) || 0) * 3.28084) / 1000),
              contact
            });
          }
          
          // Store updated aircraft in cache
          radarModule.cachedAircraftInCone = aircraftInCone;
        }

        // Store visible aircraft for A/C selection
        radarModule.visibleAircraftInCone = aircraftInCone;

        // Break lock automatically when locked aircraft is no longer visible on RDR.
        if (radarModule.hardLockedUid) {
          const lockStillVisible = aircraftInCone.some((aircraft) => String(aircraft?.uid ?? '') === String(radarModule.hardLockedUid));
          if (!lockStillVisible) {
            radarModule.hardLockedUid = null;
          }
        }

        const lockedAircraft = radarModule.hardLockedUid
          ? aircraftInCone.find((aircraft) => String(aircraft.uid) === String(radarModule.hardLockedUid))
          : null;

        // Draw border
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(displayLeft, displayTop, displayWidth, displayHeight);

        // Draw weapon status labels above radar rectangle
        const statusY = displayTop - h * 0.030;
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.round(h * 0.032)}px monospace`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(`WPN ${weaponMode}`, displayLeft, statusY);
        ctx.textAlign = 'center';
        ctx.fillText(selectedWeaponLabel, displayLeft + displayWidth * 0.5, statusY);
        ctx.textAlign = 'right';
        ctx.fillText(`MASTER ${weaponMasterState}`, displayRight, statusY);

        if (selectedWeaponEffectiveness) {
          const markerFractions = radarModule.weaponModule.getEffectivenessMarkerFractions(selectedWeaponEffectiveness);
          const bracketHeight = displayHeight * (2 / 3);
          const bracketTop = displayTop + (displayHeight - bracketHeight) * 0.5;
          const bracketBottom = bracketTop + bracketHeight;
          const bracketX = displayRight - w * 0.02;
          const tickLen = w * 0.018;

          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bracketX, bracketTop);
          ctx.lineTo(bracketX, bracketBottom);
          ctx.stroke();

          const markerYs = [
            bracketTop + markerFractions.engagementMax * bracketHeight,
            bracketTop + markerFractions.effectiveMax * bracketHeight,
            bracketTop + markerFractions.effectiveMin * bracketHeight,
            bracketTop + markerFractions.engagementMin * bracketHeight
          ];

          for (const y of markerYs) {
            ctx.beginPath();
            ctx.moveTo(bracketX, y);
            ctx.lineTo(bracketX - tickLen, y);
            ctx.stroke();
          }

          if (lockedAircraft) {
            const lockedFraction = radarModule.weaponModule.getEffectivenessDistanceFraction(selectedWeaponEffectiveness, lockedAircraft.distanceNm);
            const lockedY = bracketTop + lockedFraction * bracketHeight;
            ctx.fillStyle = color;
            ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('>', bracketX, lockedY);
            ctx.fillStyle = color;
          }
        }

        if (weaponMasterState === 'OFF') {
          ctx.fillStyle = '#ffff33';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.032)}px monospace`;
          ctx.fillText('MASTER OFF', displayLeft + displayWidth * 0.5, displayTop + displayHeight * 0.5);
          ctx.fillStyle = color;
        } else if (weaponMode !== 'A/A') {
          ctx.fillStyle = '#ffff33';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.032)}px monospace`;
          ctx.fillText('SELECT A/A MODE', displayLeft + displayWidth * 0.5, displayTop + displayHeight * 0.5);
          ctx.fillStyle = color;
        }

        // Draw horizontal grid lines (range rings)
        ctx.strokeStyle = '#004422';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) {
          const ratio = i / 4;
          const y = displayBottom - (displayHeight * ratio);
          ctx.beginPath();
          ctx.moveTo(displayLeft, y);
          ctx.lineTo(displayRight, y);
          ctx.stroke();
        }

        // Draw tick marks on sides
        const tickLength = 20;
        
        // Left and right side ticks (3 each, horizontal)
        for (let i = 1; i <= 3; i++) {
          const y = displayTop + (displayHeight * i / 4);
          // Left side
          ctx.beginPath();
          ctx.moveTo(displayLeft, y);
          ctx.lineTo(displayLeft + tickLength, y);
          ctx.stroke();
          // Right side
          ctx.beginPath();
          ctx.moveTo(displayRight, y);
          ctx.lineTo(displayRight - tickLength, y);
          ctx.stroke();
        }

        // Top and bottom ticks (vertical)
        const topBottomTickCount = scanMode === '3B' ? 2 : 5;
        for (let i = 1; i <= topBottomTickCount; i++) {
          const x = displayLeft + (displayWidth * i / (topBottomTickCount + 1));
          // Top side
          ctx.beginPath();
          ctx.moveTo(x, displayTop);
          ctx.lineTo(x, displayTop + tickLength);
          ctx.stroke();
          // Bottom side
          ctx.beginPath();
          ctx.moveTo(x, displayBottom);
          ctx.lineTo(x, displayBottom - tickLength);
          ctx.stroke();
        }

        // Draw sweep line (vertical, moving left to right)
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sweepX, displayTop);
        ctx.lineTo(sweepX, displayBottom);
        ctx.stroke();

        const firstBarY = displayBottom - (displayHeight * (1 / 4));
        const thirdBarY = displayBottom - (displayHeight * (3 / 4));
        const scanTopY = Math.min(firstBarY, thirdBarY);
        const scanBottomY = Math.max(firstBarY, thirdBarY);
        const fullScanSpan = scanBottomY - scanTopY;
        const verticalScanSpan = scanMode === '3B' ? fullScanSpan * 0.5 : fullScanSpan;
        const verticalScanTop = scanTopY + (fullScanSpan - verticalScanSpan) * 0.5;
        const verticalScanY = verticalScanTop + (radarModule.verticalScanPos / 100) * verticalScanSpan;

        ctx.fillStyle = color;
        ctx.font = `bold ${Math.round(h * 0.035)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('<', displayLeft + 10, verticalScanY);

        if (radarModule.weaponModule?.isFireFlashVisible()) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.12)}px monospace`;
          ctx.fillStyle = '#ff0000';
          ctx.fillText(radarModule.weaponModule.getActionFlashLabel(), contentX + contentW * 0.5, h * 0.72);
          ctx.fillStyle = color;
        }

        // Draw aircraft symbols
        const drawTrafficContact = (x, y, aircraft) => {
          const isSelected = String(aircraft.uid) === String(selectedTrafficUid);
          const isHardLocked = String(aircraft.uid) === String(radarModule.hardLockedUid);
          
          // If hard locked, make entire icon red
          const baseColor = isHardLocked ? '#ff0000' : (mapModule?.getTrafficColor(aircraft.contact) ?? '#ffffff');
          const number = mapModule?.getContactNumber(aircraft.contact) ?? '?';
          const glyph = String(number);

          ctx.fillStyle = baseColor;
          ctx.font = `bold ${Math.round(h * 0.032)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(glyph, x, y);

          const numberHalfH = Math.max(h * 0.016, 8);
          const roofHalfW = Math.max(w * 0.022, 10);
          const roofY = y - numberHalfH - h * 0.007;
          const legLen = Math.max(h * 0.022, 10);

          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x - roofHalfW, roofY);
          ctx.lineTo(x + roofHalfW, roofY);
          ctx.moveTo(x - roofHalfW, roofY);
          ctx.lineTo(x - roofHalfW, roofY + legLen);
          ctx.moveTo(x + roofHalfW, roofY);
          ctx.lineTo(x + roofHalfW, roofY + legLen);
          ctx.stroke();

          // Direction indicator - shows track direction
          const track = Number(aircraft.track ?? 0);
          const relTrackRad = ((track - myHeading) * Math.PI / 180);
          const dirX = Math.sin(relTrackRad);
          const dirY = -Math.cos(relTrackRad);
          const numberRadius = Math.max(h * 0.021, 11);
          const lineStart = numberRadius + 2;
          const lineLen = Math.max(h * 0.034, 16);

          ctx.beginPath();
          ctx.moveTo(x + dirX * lineStart, y + dirY * lineStart);
          ctx.lineTo(x + dirX * (lineStart + lineLen), y + dirY * (lineStart + lineLen));
          ctx.stroke();

          // Selection brackets (square corners like NAV page)
          if (isSelected && !isHardLocked) {
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

          // Diamond for hard lock
          if (isHardLocked) {
            const boundLeft = x - roofHalfW - 6;
            const boundRight = x + roofHalfW + 6;
            const boundTop = roofY - 6;
            const boundBottom = y + numberHalfH + 6;
            const halfW = (boundRight - boundLeft) * 0.5;
            const halfH = (boundBottom - boundTop) * 0.5;
            const diamondSize = Math.max(halfW, halfH) + 3;
            const diamondCenterY = y - 2;
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(x, diamondCenterY - diamondSize);
            ctx.lineTo(x + diamondSize, diamondCenterY);
            ctx.lineTo(x, diamondCenterY + diamondSize);
            ctx.lineTo(x - diamondSize, diamondCenterY);
            ctx.closePath();
            ctx.stroke();
          }
        };

        // Plot aircraft
        for (const aircraft of aircraftInCone) {
          drawTrafficContact(aircraft.x, aircraft.y, aircraft);
        }

        // Draw range indicator
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.round(h * 0.032)}px monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`${rangeNm} NM`, displayRight - w * 0.01, displayTop + h * 0.01);

        // Draw LOCK indicator if hard locked
        if (radarModule.hardLockedUid) {
          const lockedType = String(lockedAircraft?.contact?.aircraftName ?? '').trim() || 'UNKNOWN';
          const lockedCallsign = String(lockedAircraft?.contact?.callsign ?? '').trim() || 'N/A';

          ctx.fillStyle = '#ff0000';
          ctx.font = `bold ${Math.round(h * 0.034)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const lockLineStep = h * 0.036;
          const lockTextX = displayLeft + displayWidth * 0.5;
          const lockTextY = displayTop + tickLength + h * 0.01;
          ctx.fillText(`LOCK ${lockedCallsign}`.slice(0, 42), lockTextX, lockTextY);
          ctx.fillText(lockedType.slice(0, 42), lockTextX, lockTextY + lockLineStep);
        }

        ctx.restore();
      }
    });

    return true;
  }
}
