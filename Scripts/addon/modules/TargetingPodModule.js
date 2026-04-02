class TargetingPodModule {
  // TGP module implementation.
  constructor(getAddon = () => null) {
    this.getAddon = getAddon;
  }

  registerMfdPages(mfdModule) {
    const getMapModule = () => this.getAddon()?.map ?? null;
    const getOption = (page, key, fallback) => OptionModule.getOption(page, key, fallback);

    mfdModule.registerPage({
      title: 'TGP',
      leftButtons: [
        { key: 'MODE', label: 'MODE', states: ['CAPTURE', 'SETTINGS'], stateIndex: 0 },
        {
          key: 'RANGE',
          label: '↑',
          states: ['0.1', '0.5', '1', '2', '5', '10', '15', '20', '30', '45', '60', '90', '120'],
          stateIndex: 4,
          minimal: true,
          managedExternally: true,
          combinedGroupLabel: 'RNG',
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; },
          onClick: ({ page }) => page && page._stepRange(1)
        },
        {
          key: 'RANGE',
          label: '↓',
          states: ['0.1', '0.5', '1', '2', '5', '10', '15', '20', '30', '45', '60', '90', '120'],
          stateIndex: 4,
          minimal: true,
          managedExternally: true,
          combinedGroupLabel: 'RNG',
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; },
          onClick: ({ page }) => page && page._stepRange(-1)
        },
        { key: 'LOCK', label: 'LOCK', states: ['FREE', 'TRK', 'WPT'], stateIndex: 0, show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; } },
        {
          key: 'CAPTURE',
          label: 'CPT',
          states: [''],
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; },
          onClick: ({ page, uiState }) => {
            uiState.queueMfdExport(page.title);
          },
          stateIndex: 0
        },
        {
          key: 'NA1',
          label: '',
          states: [''],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'SETTINGS'; }
        },
        {
          key: 'FREQUENCY',
          label: 'FREQ',
          states: ['2', '3', '5', '10', '15', '30', '45', '60'],
          stateIndex: 3,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'SETTINGS'; }
        }
      ],
      rightButtons: [
        {
          key: 'SLEW_UP',
          label: '↑',
          states: [''],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; },
          onClick: ({ page }) => page && page._updateSlew(0, 1)
        },
        {
          key: 'SLEW_DOWN',
          label: '↓',
          states: [''],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; },
          onClick: ({ page }) => page && page._updateSlew(0, -1)
        },
        {
          key: 'SLEW_LEFT',
          label: '←',
          states: [''],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; },
          onClick: ({ page }) => page && page._updateSlew(-1, 0)
        },
        {
          key: 'SLEW_RIGHT',
          label: '→',
          states: [''],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; },
          onClick: ({ page }) => page && page._updateSlew(1, 0)
        },
        {
          key: 'SLEW_STEP',
          label: 'STEP',
          states: ['0.01', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '10'],
          stateIndex: 2,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'CAPTURE'; }
        },
        {
          key: 'STYLE',
          label: 'STL',
          states: ['DAY', 'NIGHT', 'WHITE'],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'SETTINGS'; }
        },
        {
          key: 'NA3',
          label: '',
          states: [''],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'SETTINGS'; }
        },
        {
          key: 'TRACK',
          label: 'TRK',
          states: ['SIMPLE', 'ADVANCED'],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'SETTINGS'; }
        },
        {
          key: 'NA4',
          label: '',
          states: [''],
          stateIndex: 0,
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'SETTINGS'; }
        },
        {
          key: 'SLEW_RESET',
          label: 'SLEW',
          states: ['RESET'],
          stateIndex: 0,
          onClick: ({ page }) => page && page._resetSlew(),
          show() { return OptionModule.getOption('TGP', 'MODE', 'CAPTURE') === 'SETTINGS'; }
        },
      ],

      _snap: null,
      _snapCtx: null,
      _snapCoverCrop: null,
      _captureQueued: false,
      _captureFovRad: 0,
      _captureIsLocked: false,
      _tick: 0,
      _camYaw: 0,
      _camPitch: -15,
      _relYaw: 0,
      _relPitch: 0,
      _lockMode: 'FREE',
      _activeMode: 'A/G',
      _targetWorldH: 0,
      _targetWorldP: 0,
      _targetLat: null,
      _targetLon: null,
      _targetAltM: null,
      _targetNorthM: 0,
      _targetEastM: 0,
      _targetUpM: 0,
      _lockTargetKey: null,
      _lockedCallsign: 'N/A',
      _lockedDist: null,
      _targetAltFt: 0,
      _targetHdg: 0,
      _closureKts: 0,
      _trackUpdateByUid: {},

      _WGS84_A: 6378137.0,
      _WGS84_E2: 0.00669437999014,

      _llaToEcef: function(latDeg, lonDeg, altM) {
        const lat = latDeg * Math.PI / 180;
        const lon = lonDeg * Math.PI / 180;
        const sinLat = Math.sin(lat);
        const cosLat = Math.cos(lat);
        const sinLon = Math.sin(lon);
        const cosLon = Math.cos(lon);
        const N = this._WGS84_A / Math.sqrt(1 - this._WGS84_E2 * sinLat * sinLat);
        return [
          (N + altM) * cosLat * cosLon,
          (N + altM) * cosLat * sinLon,
          (N * (1 - this._WGS84_E2) + altM) * sinLat
        ];
      },

      _ecefDeltaToNeu: function(refLatDeg, refLonDeg, dX, dY, dZ) {
        const lat = refLatDeg * Math.PI / 180;
        const lon = refLonDeg * Math.PI / 180;
        const sinLat = Math.sin(lat);
        const cosLat = Math.cos(lat);
        const sinLon = Math.sin(lon);
        const cosLon = Math.cos(lon);
        const dN = -sinLat * cosLon * dX - sinLat * sinLon * dY + cosLat * dZ;
        const dE = -sinLon * dX + cosLon * dY;
        const dU = cosLat * cosLon * dX + cosLat * sinLon * dY + sinLat * dZ;
        return [dN, dE, dU];
      },

      // Compute closure rate from relative velocity projected on LOS.
      _computeClosureRateKts: function(dN, dE, dU, targetHeadingDeg, targetSpeedKts) {
        const losLen = Math.hypot(dN, dE, dU);
        if (!losLen) return 0;

        const losN = dN / losLen;
        const losE = dE / losLen;
        const losU = dU / losLen;

        const ownHeadingDeg = Number(window.geofs?.animation?.values?.heading ?? 0);
        const ownSpeedMps = Number(window.geofs?.animation?.values?.airspeedms ?? 0);
        const ownHeadingRad = ownHeadingDeg * Math.PI / 180;
        const ownVelN = ownSpeedMps * Math.cos(ownHeadingRad);
        const ownVelE = ownSpeedMps * Math.sin(ownHeadingRad);
        const ownVelU = 0;

        const tgtHeadingRad = targetHeadingDeg * Math.PI / 180;
        const tgtSpeedMps = targetSpeedKts / 1.94384;
        const tgtVelN = tgtSpeedMps * Math.cos(tgtHeadingRad);
        const tgtVelE = tgtSpeedMps * Math.sin(tgtHeadingRad);
        const tgtVelU = 0;

        const relVelN = tgtVelN - ownVelN;
        const relVelE = tgtVelE - ownVelE;
        const relVelU = tgtVelU - ownVelU;
        const distanceRateMps = relVelN * losN + relVelE * losE + relVelU * losU;
        const closureMps = -distanceRateMps;
        return Math.round(closureMps * 1.94384);
      },

      // Compute relative local offsets and range using map-style approximation.
      _computeRelativePositionMeters: function(ownLat, ownLon, ownAltM, targetLat, targetLon, targetAltM) {
        const latAvgRad = ((ownLat + targetLat) / 2) * Math.PI / 180;
        const dE = (targetLon - ownLon) * 111320 * Math.cos(latAvgRad);
        const dN = (targetLat - ownLat) * 110540;
        const dU = targetAltM - ownAltM;
        const distM = Math.hypot(dN, dE, dU);
        const distNm = distM * 0.000539957;
        return { dN, dE, dU, distM, distNm };
      },

      // Read GeoFS multiplayer distance and convert feet to NM.
      _getTrackDistanceNmFromMultiplayer: function(trackUid) {
        if (!trackUid) return null;
        const users = Object.values(window.multiplayer?.visibleUsers ?? {});
        for (const user of users) {
          const uid = String(user?.id ?? user?.uid ?? '');
          if (uid !== String(trackUid)) continue;
          const distanceFeet = Number(user?.distance);
          if (!Number.isFinite(distanceFeet)) return null;
          return distanceFeet / 6076.11549;
        }
        return null;
      },

      // Track when a multiplayer contact position actually changed.
      _getTrackUpdateAgeMs: function(trackUid, lat, lon, altM) {
        const uid = String(trackUid ?? '');
        if (!uid) return 0;

        const now = Date.now();
        const cache = this._trackUpdateByUid[uid];
        if (!cache) {
          this._trackUpdateByUid[uid] = { lat, lon, altM, changedMs: now };
          return 0;
        }

        if (cache.lat !== lat || cache.lon !== lon || cache.altM !== altM) {
          cache.lat = lat;
          cache.lon = lon;
          cache.altM = altM;
          cache.changedMs = now;
          return 0;
        }

        return now - cache.changedMs;
      },

      // Predict tracked position from heading/speed and elapsed update age.
      _predictTrackedPosition: function(lat, lon, altM, headingDeg, speedKts, lastSeenMs) {
        const dtSec = Math.max(0, (Date.now() - lastSeenMs) / 1000);
        if (!dtSec) return { lat, lon, altM };

        const speedMps = speedKts / 1.94384;
        const travelM = speedMps * dtSec;
        const hdgRad = headingDeg * Math.PI / 180;
        const dN = travelM * Math.cos(hdgRad);
        const dE = travelM * Math.sin(hdgRad);
        const nextLat = lat + (dN / 110540);
        const nextLon = lon + (dE / (111320 * Math.cos(lat * Math.PI / 180)));
        return { lat: nextLat, lon: nextLon, altM };
      },

      _updateSlew: function(x, y) {
        const stepBtn = this.rightButtons.find((b) => b.key === 'SLEW_STEP');
        const step = Number(stepBtn.states[stepBtn.stateIndex]);
        if (this._lockMode === 'FREE') {
          this._camYaw = ((this._camYaw + (x * step)) + 360) % 360;
          if (this._camYaw > 180) this._camYaw -= 360;
          this._camPitch = Math.max(-85, Math.min(30, this._camPitch + (y * step)));
        } else {
          this._relYaw = ((this._relYaw + (x * step)) + 360) % 360;
          if (this._relYaw > 180) this._relYaw -= 360;
          this._relPitch = Math.max(-85, Math.min(85, this._relPitch + (y * step)));
        }
      },

      // Reset all slew offsets to neutral.
      _resetSlew: function() {
        this._camYaw = 0;
        this._camPitch = 0;
        this._relYaw = 0;
        this._relPitch = 0;
      },

      // Step FOV range up/down and keep both shared buttons in sync.
      _stepRange: function(direction) {
        const rangeButtons = this.leftButtons.filter((b) => b.key === 'RANGE');
        if (!rangeButtons.length) return;

        const states = rangeButtons[0].states;
        const selected = OptionModule.getOption('TGP', 'RANGE', states[rangeButtons[0].stateIndex]);
        const currentIndex = Math.max(0, states.findIndex((s) => s === selected));
        const nextIndex = Math.max(0, Math.min(states.length - 1, currentIndex + direction));
        const nextState = states[nextIndex];

        OptionModule.setOption('TGP', 'RANGE', nextState);
        for (const button of rangeButtons) {
          button.stateIndex = nextIndex;
        }
      },

      _updateLock: function() {
        if (this._lockMode === 'FREE') {
          this._resetLockData();
          return;
        }

        let tLat = null;
        let tLon = null;
        let tAltM = 0;
        let cs = 'UNKNOWN';
        let targetKey = null;
        let trackUid = null;
        let targetHeadingDeg = 0;
        let targetSpeedKts = 0;

        if (this._lockMode === 'TRK') {
          const map = getMapModule();
          const nav = map?.getSceneData?.() ?? null;
          const traffic = map?.getFilteredTraffic?.(nav?.traffic ?? [], true) ?? [];
          const uid = map?.getSelectedTrafficUid?.(traffic) ?? null;
          const target = traffic.find((c) => String(c?.uid ?? '') === String(uid ?? '')) ?? null;

          if (target) {
            tLat = Number(target.lat);
            tLon = Number(target.lon);
            tAltM = Number(target.alt) || 0;
            cs = target.callsign ?? target.cs ?? 'TRACK';
            trackUid = String(target.uid ?? uid ?? '');
            targetKey = `TRK:${String(target.uid ?? uid ?? cs)}`;
            this._targetAltFt = Math.round(tAltM * 3.28084);
            targetHeadingDeg = Number(target.headingDeg ?? target.trackDeg ?? target.heading ?? target.hdg ?? 0);
            targetSpeedKts = Number(target.speedKts ?? 0);
            this._targetHdg = targetHeadingDeg;

            const trackMode = getOption('TGP', 'TRACK', 'SIMPLE');
            if (trackMode === 'ADVANCED') {
              const ageMs = this._getTrackUpdateAgeMs(trackUid, tLat, tLon, tAltM);
              const predicted = this._predictTrackedPosition(tLat, tLon, tAltM, targetHeadingDeg, targetSpeedKts, Date.now() - ageMs);
              tLat = predicted.lat;
              tLon = predicted.lon;
              tAltM = predicted.altM;
            }
          }
        } else if (this._lockMode === 'WPT') {
          const waypointArray = window.geofs?.flightPlan?.waypointArray;
          const wp = Array.isArray(waypointArray) ? waypointArray.find((w) => w?.selected) : null;
          if (wp) {
            tLat = Number(wp.lat);
            tLon = Number(wp.lon);
            tAltM = (Number(wp.alt) || 0) * 0.3048;
            cs = String(wp.ident ?? wp.name ?? wp.id ?? 'WPT');
            targetKey = `WPT:${cs}`;
            this._targetAltFt = Math.round(tAltM * 3.28084);
          }
        }

        const own = window.geofs?.aircraft?.instance?.llaLocation;

        if (tLat === null || tLon === null || !Number.isFinite(tLat) || !Number.isFinite(tLon) || !own) {
          this._resetLockData();
          return;
        }

        if (targetKey && targetKey !== this._lockTargetKey) {
          this._lockTargetKey = targetKey;
          this._relYaw = 0;
          this._relPitch = 0;
          this._closureKts = 0;
        }

        const ownEcef = this._llaToEcef(own[0], own[1], own[2]);
        const tgtEcef = this._llaToEcef(tLat, tLon, tAltM);
        const dX = tgtEcef[0] - ownEcef[0];
        const dY = tgtEcef[1] - ownEcef[1];
        const dZ = tgtEcef[2] - ownEcef[2];
        const [dN, dE, dU] = this._ecefDeltaToNeu(own[0], own[1], dX, dY, dZ);
        const rel = this._computeRelativePositionMeters(own[0], own[1], own[2], tLat, tLon, tAltM);

        const distH = Math.hypot(dN, dE);
        const trkDistNm = this._lockMode === 'TRK' ? this._getTrackDistanceNmFromMultiplayer(trackUid) : null;
        const distNm = this._lockMode === 'TRK'
          ? (trkDistNm !== null ? Math.round(trkDistNm * 10) / 10 : null)
          : Math.round(rel.distNm * 10) / 10;
        this._closureKts = this._computeClosureRateKts(rel.dN, rel.dE, rel.dU, targetHeadingDeg, targetSpeedKts);

        this._targetWorldH = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
        this._targetWorldP = Math.atan2(dU, distH) * 180 / Math.PI;
        this._targetLat = tLat;
        this._targetLon = tLon;
        this._targetAltM = tAltM;
        this._targetNorthM = dN;
        this._targetEastM = dE;
        this._targetUpM = dU;
        this._lockedCallsign = cs;
        this._lockedDist = distNm;
      },

      // Reset target and lock values.
      _resetLockData: function() {
        this._lockTargetKey = null;
        this._targetLat = null;
        this._targetLon = null;
        this._targetAltM = null;
        this._targetNorthM = 0;
        this._targetEastM = 0;
        this._targetUpM = 0;
        this._lockedDist = null;
        this._closureKts = 0;
      },

      // Capture one TGP camera frame.
      _captureFrame: function(fovRad, isLocked) {
        const viewer = window.geofs?.api?.viewer;
        const mode1 = window.geofs?.camera?.modes?.[1];
        if (!viewer?.scene || !mode1) return;

        const oPos = [...mode1.position];
        const oOri = [...mode1.orientation];
        const oFov = mode1.FOV;
        const oCurr = mode1.orientations ? [...mode1.orientations.current] : [...oOri];
        const oLast = mode1.orientations ? [...mode1.orientations.last] : [...oOri];

        const animVals = window.geofs?.animation?.values ?? {};
        const acHeading = Number(animVals.heading360 ?? animVals.heading ?? 0);
        const acPitch = -Number(animVals.atilt ?? 0);
        const acRoll = Number(animVals.aroll ?? 0);

        const normDeg = (a) => ((a % 360) + 540) % 360 - 180;
        let finalH;
        let finalP;
        let finalR;

        if (isLocked && this._lockTargetKey) {
          let refLat = Number(window.geofs?.camera?.lla?.[0]);
          let refLon = Number(window.geofs?.camera?.lla?.[1]);
          let refAlt = Number(window.geofs?.camera?.lla?.[2]);

          const sceneCamera = viewer?.scene?.camera;
          if (typeof Cesium !== 'undefined' && sceneCamera?.positionWC) {
            const carto = Cesium.Cartographic.fromCartesian(sceneCamera.positionWC);
            refLat = Cesium.Math.toDegrees(carto.latitude);
            refLon = Cesium.Math.toDegrees(carto.longitude);
            refAlt = Number(carto.height);
          }

          const tgtLat = Number(this._targetLat);
          const tgtLon = Number(this._targetLon);
          const tgtAlt = Number(this._targetAltM);

          if (Number.isFinite(refLat) && Number.isFinite(refLon) && Number.isFinite(refAlt)
            && Number.isFinite(tgtLat) && Number.isFinite(tgtLon) && Number.isFinite(tgtAlt)) {
            const refEcef = this._llaToEcef(refLat, refLon, refAlt);
            const tgtEcef = this._llaToEcef(tgtLat, tgtLon, tgtAlt);
            const dX = tgtEcef[0] - refEcef[0];
            const dY = tgtEcef[1] - refEcef[1];
            const dZ = tgtEcef[2] - refEcef[2];
            const [dN, dE, dU] = this._ecefDeltaToNeu(refLat, refLon, dX, dY, dZ);

            const hdgRad = acHeading * Math.PI / 180;
            const pitchRad = acPitch * Math.PI / 180;
            const rollRad = -acRoll * Math.PI / 180;

            const xH = dN * Math.cos(hdgRad) + dE * Math.sin(hdgRad);
            const yH = -dN * Math.sin(hdgRad) + dE * Math.cos(hdgRad);
            const zH = dU;

            const xP = xH * Math.cos(pitchRad) + zH * Math.sin(pitchRad);
            const yP = yH;
            const zP = -xH * Math.sin(pitchRad) + zH * Math.cos(pitchRad);

            const xB = xP;
            const yB = yP * Math.cos(rollRad) - zP * Math.sin(rollRad);
            const zB = yP * Math.sin(rollRad) + zP * Math.cos(rollRad);

            finalH = normDeg(Math.atan2(yB, xB) * 180 / Math.PI + this._relYaw);
            finalP = Math.max(-85, Math.min(85, Math.atan2(zB, Math.hypot(xB, yB)) * 180 / Math.PI + this._relPitch));
            finalR = 0;
          } else {
            finalH = normDeg(this._targetWorldH - acHeading + this._relYaw);
            finalP = Math.max(-85, Math.min(85, this._targetWorldP - acPitch + this._relPitch));
            finalR = 0;
          }
        } else {
          finalH = this._camYaw;
          finalP = this._camPitch;
          finalR = 0;
        }

        mode1.position = [oPos[0], oPos[1], -1.2];
        mode1.orientation = [finalH, finalP, finalR];
        mode1.FOV = fovRad;

        if (mode1.orientations) {
          mode1.orientations.current = [finalH, finalP, finalR];
          mode1.orientations.last = [finalH, finalP, finalR];
        }

        // if (window.geofs.camera.currentModeName === 'cockpit') window.geofs.camera.update(0);

        const frustum = viewer.scene.camera.frustum;
        const origFrustumFov = frustum.fov;
        frustum.fov = fovRad;
        viewer.scene.render(viewer.clock.currentTime);
        frustum.fov = origFrustumFov;

        const vc = viewer.canvas;
        if (this._snap.width !== vc.width || this._snap.height !== vc.height) {
          this._snap.width = vc.width;
          this._snap.height = vc.height;
          this._snapCoverCrop = null;
          this._snapCtx = null;
        }
        if (!this._snapCtx) {
          this._snapCtx = this._snap.getContext('2d', { alpha: false });
        }
        this._snapCtx.drawImage(vc, 0, 0);

        mode1.position = oPos;
        mode1.orientation = oOri;
        mode1.FOV = oFov;

        if (mode1.orientations) {
          mode1.orientations.current = oCurr;
          mode1.orientations.last = oLast;
        }
        // if (window.geofs.camera.currentModeName === 'cockpit') window.geofs.camera.update(0);
      },

      // Queue capture for the next browser frame.
      _queueCaptureFrame: function(fovRad, isLocked) {
        this._captureFovRad = fovRad;
        this._captureIsLocked = isLocked;
        if (this._captureQueued) return;

        this._captureQueued = true;
        requestAnimationFrame(() => {
          this._captureQueued = false;
          this._captureFrame(this._captureFovRad, this._captureIsLocked);
        });
      },

      // Draw snapshot with cover-style crop.
      _drawSnapshot: function(ctx, w, h) {
        const srcW = this._snap.width;
        const srcH = this._snap.height;
        const dstW = w;
        const dstH = h;

        let crop = this._snapCoverCrop;
        if (!crop || crop.srcW !== srcW || crop.srcH !== srcH || crop.dstW !== dstW || crop.dstH !== dstH) {
          const scale = Math.max(dstW / srcW, dstH / srcH);
          const sw = dstW / scale;
          const sh = dstH / scale;
          crop = {
            srcW,
            srcH,
            dstW,
            dstH,
            sx: (srcW - sw) / 2,
            sy: (srcH - sh) / 2,
            sw,
            sh
          };
          this._snapCoverCrop = crop;
        }

        ctx.drawImage(this._snap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, dstW, dstH);
      },

      // Apply DAY/NIGHT/WHT image mode.
      _applyImageMode: function(ctx, w, h, imgMode) {
        if (imgMode === 'DAY') return;

        const id = ctx.getImageData(0, 0, w, h);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
          if (imgMode === 'NIGHT') {
            d[i] = l * 0.1;
            d[i + 1] = l;
            d[i + 2] = l * 0.1;
          } else {
            d[i] = l;
            d[i + 1] = l;
            d[i + 2] = l;
          }
        }
        ctx.putImageData(id, 0, 0);
      },

      // Draw A/G overlay.
      _drawAgHud: function(ctx, w, h, fovDeg, isLocked) {
        const cx = w / 2;
        const cy = h / 2;
        const bs = 22;
        const cl = 52;
        const gap = bs + 6;

        ctx.strokeRect(cx - bs, cy - bs, bs * 2, bs * 2);

        ctx.beginPath();
        ctx.moveTo(cx, cy - cl);
        ctx.lineTo(cx, cy - gap);
        ctx.moveTo(cx, cy + gap);
        ctx.lineTo(cx, cy + cl);
        ctx.moveTo(cx - cl, cy);
        ctx.lineTo(cx - gap, cy);
        ctx.moveTo(cx + gap, cy);
        ctx.lineTo(cx + cl, cy);
        ctx.stroke();

        for (let i = 1; i <= 3; i += 1) {
          const ty = cy - gap - i * 8;
          ctx.beginPath();
          ctx.moveTo(cx - 5, ty);
          ctx.lineTo(cx + 5, ty);
          ctx.stroke();
        }

        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('A/G', 8, 24);

        ctx.textAlign = 'right';
        ctx.fillText(`FOV ${fovDeg}°`, w - 8, 24);

        ctx.textAlign = 'center';
        ctx.fillText(isLocked ? `${this._lockMode} ◆ ${this._lockedCallsign}` : 'SLEW', cx, 48);

        if (isLocked && this._targetLat !== null) {
          ctx.font = 'bold 17px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`LAT  ${this._targetLat.toFixed(4)}`, 8, h - 72);
          ctx.fillText(`LON  ${this._targetLon.toFixed(4)}`, 8, h - 50);
          ctx.fillText(`ELEV ${this._targetAltFt} ft`, 8, h - 28);

          ctx.textAlign = 'right';
          if (this._lockedDist !== null) {
            ctx.fillText(`RNG  ${this._lockedDist} NM`, w - 8, h - 50);
          }
          ctx.fillText(`BRG  ${Math.round(this._targetWorldH)}°`, w - 8, h - 28);
        } else {
          ctx.textAlign = 'center';
          ctx.font = 'bold 16px monospace';
          ctx.fillText('NO TGT', cx, h - 40);
        }
      },

      // Draw A/A overlay.
      _drawAaHud: function(ctx, w, h, fovDeg, isLocked, hud) {
        const cx = w / 2;
        const cy = h / 2;
        const R = 44;
        const dotR = 3;
        const tickLen = 12;

        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();

        for (let i = 0; i < 4; i += 1) {
          const a = i * Math.PI / 2;
          const ix = cx + Math.cos(a) * (R - tickLen / 2);
          const iy = cy + Math.sin(a) * (R - tickLen / 2);
          const ox = cx + Math.cos(a) * (R + tickLen / 2);
          const oy = cy + Math.sin(a) * (R + tickLen / 2);
          ctx.beginPath();
          ctx.moveTo(ix, iy);
          ctx.lineTo(ox, oy);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        if (isLocked && this._lockTargetKey) {
          ctx.fill();
        } else {
          ctx.stroke();
        }

        const barX = cx - R - 18;
        const barH = 44;
        const barY = cy - barH / 2;
        const frac = Math.max(0, Math.min(1, Math.abs(this._closureKts) / 600));
        ctx.strokeRect(barX - 4, barY, 4, barH);
        if (frac > 0) {
          ctx.fillRect(barX - 4, barY + barH * (1 - frac), 4, barH * frac);
        }
        for (let i = 0; i <= 4; i += 1) {
          const ty = barY + i * (barH / 4);
          const len = i === 2 ? 8 : 4;
          ctx.beginPath();
          ctx.moveTo(barX, ty);
          ctx.lineTo(barX + len, ty);
          ctx.stroke();
        }

        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('A/A', 70, 60);

        ctx.textAlign = 'right';
        ctx.fillText(`FOV ${fovDeg}°`, w - 50, 60);

        ctx.textAlign = 'center';
        if (isLocked && this._lockTargetKey) {
          ctx.fillText(`TRK ◆ ${this._lockedCallsign}`, cx, 60);
        } else {
          ctx.fillText('ACQ', cx, 60);
        }

        if (isLocked && this._lockTargetKey) {
          ctx.font = 'bold 17px monospace';
          ctx.textAlign = 'left';

          ctx.fillText(`ALT  ${this._targetAltFt} ft`, 70, h - 141);
          if (this._lockedDist !== null) {
            ctx.fillText(`RNG  ${this._lockedDist} NM`, 70, h - 119);
          }

          if (Math.abs(this._closureKts) > 200) ctx.fillStyle = '#ffcc00';
          const vcSign = this._closureKts >= 0 ? '+' : '';
          ctx.fillText(`CLR  ${vcSign}${this._closureKts} kts`, 70, h - 97);
          ctx.fillStyle = hud;

          ctx.fillText(`BRG  ${Math.round(this._targetWorldH)}°`, 70, h - 70);
        } else {
          ctx.textAlign = 'center';
          ctx.font = 'bold 16px monospace';
          ctx.fillText('NO TARGET SELECTED', cx, h - 70);
        }
      },

      render: function(renderer, renderContext) {
        const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
        const w = renderContext?.w ?? 512;
        const h = renderContext?.h ?? 512;
        const color = renderContext?.color ?? '#00ff66';
        if (!ctx) return;

        if (!this._snap) this._snap = document.createElement('canvas');

        const page = renderContext?.page;
        if (!page) return;

        const imgMode = getOption('TGP', 'STYLE', 'DAY');
        const fovDeg = Number(getOption('TGP', 'RANGE', 30));
        const fovRad = fovDeg * Math.PI / 180;
        const frequency = Number(getOption('TGP', 'FREQUENCY', 4));
        this._activeMode = getOption('WPN', 'MODE', 'A/G');
        this._lockMode = getOption('TGP', 'LOCK', 'FREE');

        const isLocked = this._lockMode === 'TRK' || this._lockMode === 'WPT';
        const isAA = this._activeMode === 'A/A';

        this._updateLock();

        this._tick += 1;
        if (this._tick % frequency === 0) {
          this._queueCaptureFrame(fovRad, isLocked);
        }

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        if (this._snap?.width > 0) {
          this._drawSnapshot(ctx, w, h);
          this._applyImageMode(ctx, w, h, imgMode);
        }

        const hud = isLocked ? '#ff0000' : color;
        ctx.strokeStyle = hud;
        ctx.fillStyle = hud;
        ctx.lineWidth = 2;

        if (isAA) {
          this._drawAaHud(ctx, w, h, fovDeg, isLocked, hud);
        } else {
          this._drawAgHud(ctx, w, h, fovDeg, isLocked);
        }

        ctx.restore();
      }
    });

    return true;
  }
}

window.TargetingPodModule = TargetingPodModule;
