// ==UserScript==
// @name         GeoFS F-18 Mod
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      1.1.0
// @description  Improves the cockpit with a new HUD and custom MFDs, adjustable seat height and more.
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
  const RIGHT_MFD_RENDERER_NAME = 'f18RightMFD';
  const RIGHT_MFD_INCLUDE_KEY = 'f18-3d-rightMFD';
  const RIGHT_MFD_PART_NAME = 'f18RightMFDPart';
  const RIGHT_MFD_PICK_NODE_NAME = 'glassPanel';
  const RIGHT_MFD_TOP_BUTTON_RENDERER_NAME = 'f18RightMFDTopButton';
  const RIGHT_MFD_TOP_BUTTON_INCLUDE_KEY_BASE = 'f18-3d-rightMFDTopButton';
  const RIGHT_MFD_TOP_BUTTON_PART_NAME_BASE = 'f18RightMFDTopButtonPart';
  const RIGHT_MFD_TOP_BUTTON_COUNT = 5;
  const RIGHT_MFD_TOP_BUTTON_START_X = -0.049;
  const RIGHT_MFD_TOP_BUTTON_STEP_X = 0.0225;
  const RIGHT_MFD_TOP_BUTTON_Y = -0.01;
  const RIGHT_MFD_TOP_BUTTON_Z = 0.092;
  const RIGHT_MFD_LEFT_BUTTON_PART_NAME_BASE = 'f18RightMFDLeftButtonPart';
  const RIGHT_MFD_LEFT_BUTTON_COUNT = RIGHT_MFD_TOP_BUTTON_COUNT;
  const RIGHT_MFD_LEFT_BUTTON_X = -0.0865;
  const RIGHT_MFD_LEFT_BUTTON_Y = RIGHT_MFD_TOP_BUTTON_Y;
  const RIGHT_MFD_LEFT_BUTTON_START_Z = 0.054;
  const RIGHT_MFD_LEFT_BUTTON_STEP_Z = 0.025;
  const RIGHT_MFD_RIGHT_BUTTON_PART_NAME_BASE = 'f18RightMFDRightButtonPart';
  const RIGHT_MFD_RIGHT_BUTTON_COUNT = RIGHT_MFD_TOP_BUTTON_COUNT;
  const RIGHT_MFD_RIGHT_BUTTON_X = 0.0835;
  const RIGHT_MFD_RIGHT_BUTTON_Y = RIGHT_MFD_TOP_BUTTON_Y;
  const RIGHT_MFD_RIGHT_BUTTON_START_Z = RIGHT_MFD_LEFT_BUTTON_START_Z;
  const RIGHT_MFD_RIGHT_BUTTON_STEP_Z = RIGHT_MFD_LEFT_BUTTON_STEP_Z;
  const RIGHT_MFD_TOP_BUTTON_VISUAL_SCALE = 2 / 3;
  const RIGHT_MFD_TILT_DEG = 8;
  const RIGHT_MFD_CLICK_HALF_WIDTH = 0.36;
  const RIGHT_MFD_CLICK_HALF_HEIGHT = 0.36;
  const F18_OPTIONS_STORAGE_KEY = 'F18Options';
  const F18_WPN_STATE_STORAGE_KEY = 'F18WpnState';
  const HUD_DEFAULT_COLOR = '#00ff00';
  let currentHudColor = HUD_DEFAULT_COLOR;

  let wpnLoadout = {
    'A/A': {
        gun: 578,
        left: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'AIM-120',
                display: '12M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint2: {
                load: 'AIM-120',
                display: '12M',
                quantity: 2,
                type: 'A/A'
            },
        },
        right: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'AIM-120',
                display: '12M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint2: {
                load: 'AIM-120',
                display: '12M',
                quantity: 2,
                type: 'A/A'
            }
        }
    },
    'L/R A/A': {
        gun: 578,
        left: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'AIM-120',
                display: '12M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint2: {
                load: 'Fuel',
                display: 'FUEL',
                quantity: 1,
                type: 'FUEL'
            },
        },
        right: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'AIM-120',
                display: '12M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint2: {
                load: 'Fuel',
                display: 'FUEL',
                quantity: 1,
                type: 'FUEL'
            }
        }
    },
    'A/G': {
        gun: 578,
        left: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'AGM-88',
                display: 'HARM',
                quantity: 1,
                type: 'A/G'
            },
            hardpoint2: {
                load: 'AGM-84K',
                display: 'SLAM-ER',
                quantity: 1,
                type: 'A/G'
            }
        },
        right: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'AGM-88',
                display: 'HARM',
                quantity: 1,
                type: 'A/G'
            },
            hardpoint2: {
                load: 'JDAM',
                display: 'JDAM',
                quantity: 1,
                type: 'A/G'
            }
        }
    },
    'L/R A/G': {
        gun: 578,
        left: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'AGM-88',
                display: 'HARM',
                quantity: 1,
                type: 'A/G'
            },
            hardpoint2: {
                load: 'Fuel',
                display: 'FUEL',
                quantity: 1,
                type: 'FUEL'
            }
        },
        right: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 2,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'AGM-88',
                display: 'HARM',
                quantity: 1,
                type: 'A/G'
            },
            hardpoint2: {
                load: 'Fuel',
                display: 'FUEL',
                quantity: 1,
                type: 'FUEL'
            }
        }
    },
    'L/R': {
        gun: 578,
        left: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 1,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'Fuel',
                display: 'FUEL',
                quantity: 1,
                type: 'FUEL'
            },
            hardpoint2: {
                load: 'Fuel',
                display: 'FUEL',
                quantity: 1,
                type: 'FUEL'
            }
        },
        right: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 1,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'Fuel',
                display: 'FUEL',
                quantity: 1,
                type: 'FUEL'
            },
            hardpoint2: {
                load: 'Fuel',
                display: 'FUEL',
                quantity: 1,
                type: 'FUEL'
            }
        }
    },
    'MIN': {
        gun: 300,
        left: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 1,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            },
            hardpoint2: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            }
        },
        right: {
            wingtip: {
                load: 'AIM-9',
                display: '9M',
                quantity: 1,
                type: 'A/A'
            },
            hardpoint1: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            },
            hardpoint2: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            }
        }
    },
    'CLEAN': {
        gun: 0,
        left: {
            wingtip: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            },
            hardpoint1: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            },
            hardpoint2: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            }
        },
        right: {
            wingtip: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            },
            hardpoint1: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            },
            hardpoint2: {
                load: 'N/A',
                display: 'N/A',
                quantity: 0,
                type: 'N/A'
            }
        }
    },
    
  }

  const WPN_STATION_RENDER_ORDER = [
    { side: 'center', station: 'gun' },
    { side: 'left', station: 'wingtip' },
    { side: 'left', station: 'hardpoint1' },
    { side: 'left', station: 'hardpoint2' },
    { side: 'right', station: 'hardpoint2' },
    { side: 'right', station: 'hardpoint1' },
    { side: 'right', station: 'wingtip' }
  ];

  const wpnSelectedWeaponByMode = {};
  const WPN_FIRE_BLINK_INTERVAL_MS = 500;
  const WPN_FIRE_BLINK_PHASES = 4;
  const WPN_GUN_FIRE_RATE_RPS = 66;
  const WPN_GUN_ROUNDS_PER_BURST = 100;
  const WPN_GUN_FIRE_TICK_MS = Math.max(1, Math.round(1000 / WPN_GUN_FIRE_RATE_RPS));
  const WPN_REARM_DURATION_MS = 60_000;
  const wpnLoadoutTemplates = JSON.parse(JSON.stringify(wpnLoadout));
  let wpnCurrentLoadout = JSON.parse(JSON.stringify(
    wpnLoadoutTemplates?.['A/A']
    ?? Object.values(wpnLoadoutTemplates ?? {})[0]
    ?? {}
  ));
  const wpnRearmState = {
    active: false,
    startTime: 0,
    progress: 0,
    durationMs: WPN_REARM_DURATION_MS,
    config: 'A/A',
    status: 'IDLE',
    lastSavedPercent: -1
  };

  const wpnGunFireState = {
    timerId: null,
    mode: null,
    roundsRemainingInBurst: 0
  };

  function deepCloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getWpnModeFromOptions() {
    const mode = getF18Option('WPN', 'MODE', 'NAV');
    return mode === 'A/A' || mode === 'A/G' || mode === 'NAV' || mode === 'JETTISON' ? mode : 'NAV';
  }

  function isModeCompatibleStation(mode, stationName, stationData) {
    if (mode === 'JETTISON') {
      return stationName !== 'gun';
    }
    if (stationName === 'gun') {
      return mode !== 'NAV';
    }
    if (mode === 'NAV') return false;
    const stationType = stationData?.type;
    if (!stationType) return true;
    return stationType === mode;
  }

  function saveWpnStateToStorage() {
    try {
      const payload = {
        config: getF18Option('WPN', 'CONFIG', 'A/A'),
        loadout: wpnCurrentLoadout,
        selected: wpnSelectedWeaponByMode
      };
      window.localStorage?.setItem?.(F18_WPN_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // Ignore storage write issues.
    }
  }

  function loadWpnStateFromStorage() {
    try {
      const raw = window.localStorage?.getItem?.(F18_WPN_STATE_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const storedLoadout = parsed?.loadout;
      if (!storedLoadout || typeof storedLoadout !== 'object') return;

      const baseTemplate = deepCloneJson(
        wpnLoadoutTemplates?.['A/A']
        ?? Object.values(wpnLoadoutTemplates ?? {})[0]
        ?? {}
      );

      const modeKeys = Object.keys(wpnLoadoutTemplates ?? {});
      const looksLikeLegacyByMode = modeKeys.some((k) => storedLoadout?.[k] && typeof storedLoadout[k] === 'object');
      const sourceLoadout = looksLikeLegacyByMode
        ? (storedLoadout?.[parsed?.config] ?? storedLoadout?.['A/A'] ?? storedLoadout?.[modeKeys[0]])
        : storedLoadout;

      if (sourceLoadout && typeof sourceLoadout === 'object') {
        baseTemplate.gun = Number.isFinite(sourceLoadout?.gun) ? sourceLoadout.gun : baseTemplate.gun;
        for (const sideKey of ['left', 'right']) {
          for (const stationKey of Object.keys(baseTemplate?.[sideKey] ?? {})) {
            const stationTemplate = baseTemplate[sideKey][stationKey];
            const stationStored = sourceLoadout?.[sideKey]?.[stationKey];
            if (!stationStored || typeof stationStored !== 'object') continue;

            stationTemplate.quantity = Number.isFinite(stationStored.quantity)
              ? stationStored.quantity
              : stationTemplate.quantity;
            if (typeof stationStored.load === 'string') stationTemplate.load = stationStored.load;
            if (typeof stationStored.display === 'string') stationTemplate.display = stationStored.display;
            if (typeof stationStored.type === 'string') stationTemplate.type = stationStored.type;
          }
        }
      }

      wpnCurrentLoadout = baseTemplate;

      const storedSelected = parsed?.selected;
      if (storedSelected && typeof storedSelected === 'object') {
        for (const key of Object.keys(wpnSelectedWeaponByMode)) {
          delete wpnSelectedWeaponByMode[key];
        }
        for (const modeKey of Object.keys(storedSelected)) {
          const selected = storedSelected[modeKey];
          if (!selected || typeof selected !== 'object' || !selected.station) continue;
          wpnSelectedWeaponByMode[modeKey] = {
            side: selected.side,
            station: selected.station
          };
        }
      }

      if (typeof parsed?.config === 'string') {
        wpnRearmState.config = parsed.config;
      }
    } catch (e) {
      // Ignore malformed storage.
    }
  }

  loadWpnStateFromStorage();

  function resolveWpnTemplateConfig(config) {
    if (config && wpnLoadoutTemplates?.[config]) return config;
    if (wpnLoadoutTemplates?.['A/A']) return 'A/A';
    const first = Object.keys(wpnLoadoutTemplates ?? {})[0];
    return first ?? null;
  }

  function getRearmTemplateByMode(config) {
    const resolvedConfig = resolveWpnTemplateConfig(config);
    const sourceTemplate = resolvedConfig ? wpnLoadoutTemplates?.[resolvedConfig] : null;
    if (!sourceTemplate) return null;

    return JSON.parse(JSON.stringify(sourceTemplate));
  }

  function zeroCurrentWpnLoadout() {
    if (!wpnCurrentLoadout) return;

    wpnCurrentLoadout.gun = 0;
    for (const sideKey of ['left', 'right']) {
      const sideStations = wpnCurrentLoadout?.[sideKey];
      if (!sideStations || typeof sideStations !== 'object') continue;
      for (const stationKey of Object.keys(sideStations)) {
        if (!Number.isFinite(sideStations[stationKey]?.quantity)) continue;
        sideStations[stationKey].quantity = 0;
      }
    }
  }

  function applyWpnRearmProgress(targetByMode, progress) {
    const p = Math.max(0, Math.min(1, progress));
    if (!wpnCurrentLoadout || !targetByMode) return;

    wpnCurrentLoadout.gun = Math.floor((Number.isFinite(targetByMode.gun) ? targetByMode.gun : 0) * p);

    for (const sideKey of ['left', 'right']) {
      wpnCurrentLoadout[sideKey] = wpnCurrentLoadout[sideKey] ?? {};
      const targetSide = targetByMode?.[sideKey] ?? {};

      for (const stationKey of Object.keys(targetSide)) {
        const targetStation = targetSide?.[stationKey] ?? {};
        wpnCurrentLoadout[sideKey][stationKey] = wpnCurrentLoadout[sideKey][stationKey] ?? {};

        wpnCurrentLoadout[sideKey][stationKey].load = targetStation?.load;
        wpnCurrentLoadout[sideKey][stationKey].display = targetStation?.display;
        wpnCurrentLoadout[sideKey][stationKey].type = targetStation?.type;

        const targetQuantity = Number.isFinite(targetStation?.quantity) ? targetStation.quantity : 0;
        wpnCurrentLoadout[sideKey][stationKey].quantity = Math.floor(targetQuantity * p);
      }
    }
  }

  function startWpnRearm(config) {
    if (wpnRearmState.active) return false;

    const resolvedConfig = resolveWpnTemplateConfig(config);
    const targetByMode = getRearmTemplateByMode(resolvedConfig);
    if (!resolvedConfig || !targetByMode) return false;

    zeroCurrentWpnLoadout();
    for (const modeKey of Object.keys(wpnSelectedWeaponByMode ?? {})) {
      delete wpnSelectedWeaponByMode[modeKey];
    }

    wpnRearmState.active = true;
    wpnRearmState.startTime = Date.now();
    wpnRearmState.progress = 0;
    wpnRearmState.config = resolvedConfig;
    wpnRearmState.status = 'REARMING';
    wpnRearmState.lastSavedPercent = -1;
    wpnRearmState.targetByMode = targetByMode;
    saveWpnStateToStorage();

    return true;
  }

  function updateWpnRearmState() {
    if (!wpnRearmState.active) return;

    if (window.geofs?.animation?.values?.enginesOn) {
      wpnRearmState.active = false;
      wpnRearmState.status = 'ABORTED';
      wpnRearmState.targetByMode = null;
      saveWpnStateToStorage();
      return;
    }

    const elapsed = Date.now() - wpnRearmState.startTime;
    const duration = Math.max(1, Number.isFinite(wpnRearmState.durationMs) ? wpnRearmState.durationMs : WPN_REARM_DURATION_MS);
    const progress = Math.max(0, Math.min(1, elapsed / duration));

    wpnRearmState.progress = progress;
    applyWpnRearmProgress(wpnRearmState.targetByMode, progress);

    const percent = Math.round(progress * 100);
    if (percent !== wpnRearmState.lastSavedPercent) {
      wpnRearmState.lastSavedPercent = percent;
      saveWpnStateToStorage();
    }

    if (progress >= 1) {
      wpnRearmState.active = false;
      wpnRearmState.status = 'READY';
      wpnRearmState.targetByMode = null;
      saveWpnStateToStorage();
    }
  }

  function stopWpnGunFireTimer() {
    if (wpnGunFireState.timerId) {
      clearTimeout(wpnGunFireState.timerId);
      wpnGunFireState.timerId = null;
    }
    wpnGunFireState.mode = null;
    wpnGunFireState.roundsRemainingInBurst = 0;
  }

  function processWpnGunFireTick() {
    if (wpnGunFireState.roundsRemainingInBurst <= 0) {
      stopWpnGunFireTimer();
      return;
    }

    const mode = wpnGunFireState.mode;
    const modeLoadout = getWpnModeLoadout(mode);
    let storedPayload = null;
    try {
      const raw = window.localStorage?.getItem?.(F18_WPN_STATE_STORAGE_KEY);
      storedPayload = raw ? JSON.parse(raw) : null;
    } catch (e) {
      storedPayload = null;
    }

    const storedGun = Number.isFinite(storedPayload?.loadout?.gun)
      ? storedPayload.loadout.gun
      : null;
    const memoryGun = Number.isFinite(modeLoadout?.gun) ? modeLoadout.gun : 0;
    const currentGun = storedGun != null ? storedGun : memoryGun;

    if (currentGun <= 0) {
      stopWpnGunFireTimer();
      selectNextWpnWeapon(mode, modeLoadout, 0);
      saveWpnStateToStorage();
      return;
    }

    const updatedGun = Math.max(0, currentGun - 1);
    if (modeLoadout) {
      modeLoadout.gun = updatedGun;
    }

    try {
      const payloadToStore = (storedPayload && typeof storedPayload === 'object') ? storedPayload : {};
      payloadToStore.loadout = (payloadToStore.loadout && typeof payloadToStore.loadout === 'object') ? payloadToStore.loadout : {};
      payloadToStore.loadout.gun = updatedGun;
      window.localStorage?.setItem?.(F18_WPN_STATE_STORAGE_KEY, JSON.stringify(payloadToStore));
    } catch (e) {
      saveWpnStateToStorage();
    }

    wpnGunFireState.roundsRemainingInBurst -= 1;

    if (updatedGun <= 0) {
      stopWpnGunFireTimer();
      selectNextWpnWeapon(mode, modeLoadout, 0);
      saveWpnStateToStorage();
      return;
    }

    if (wpnGunFireState.roundsRemainingInBurst <= 0) {
      stopWpnGunFireTimer();
      return;
    }

    wpnGunFireState.timerId = setTimeout(processWpnGunFireTick, WPN_GUN_FIRE_TICK_MS);
  }

  function ensureWpnGunFireTimerRunning() {
    if (wpnGunFireState.timerId) return;
    wpnGunFireState.timerId = setTimeout(processWpnGunFireTick, WPN_GUN_FIRE_TICK_MS);
  }

  function startWpnGunFire(mode, modeLoadout) {
    if (!modeLoadout || !Number.isFinite(modeLoadout.gun) || modeLoadout.gun <= 0) {
      return false;
    }

    const wasIdle = !wpnGunFireState.timerId;

    wpnGunFireState.mode = mode;

    wpnGunFireState.roundsRemainingInBurst += WPN_GUN_ROUNDS_PER_BURST;
    if (wasIdle) {
      processWpnGunFireTick();
    } else {
      ensureWpnGunFireTimerRunning();
    }
    triggerWpnFireFlash();
    return true;
  }

  let wpnFireFlash = {
    startTime: 0,
    label: 'FIRE'
  };

  function triggerWpnActionFlash(label = 'FIRE') {
    wpnFireFlash.startTime = Date.now();
    wpnFireFlash.label = label;
  }

  function triggerWpnFireFlash() {
    triggerWpnActionFlash('FIRE');
  }

  function getWpnActionFlashLabel() {
    return wpnFireFlash?.label || 'FIRE';
  }

  function isWpnFireFlashVisible() {
    if (!wpnFireFlash.startTime) return false;

    const elapsed = Date.now() - wpnFireFlash.startTime;
    const totalDuration = WPN_FIRE_BLINK_INTERVAL_MS * WPN_FIRE_BLINK_PHASES;
    if (elapsed >= totalDuration) {
      wpnFireFlash.startTime = 0;
      wpnFireFlash.label = 'FIRE';
      return false;
    }

    const phase = Math.floor(elapsed / WPN_FIRE_BLINK_INTERVAL_MS);
    return phase % 2 === 0;
  }

  function getWpnModeFromPage(page) {
    const modeButton = page?.leftButtons?.find?.((b) => b?.key === 'MODE')
      ?? page?.rightButtons?.find?.((b) => b?.key === 'MODE');
    return modeButton?.states?.[modeButton?.stateIndex] ?? 'A/A';
  }

  function getWpnModeLoadout(mode) {
    return wpnCurrentLoadout ?? null;
  }

  function canUseStationForMode(mode, modeLoadout, side, station, minimumQuantity = 0) {
    if (!modeLoadout || !station) return false;

    if (station === 'gun') {
      if (!isModeCompatibleStation(mode, station, null)) return false;
      return getWpnStationQuantity(modeLoadout, side, station) > minimumQuantity;
    }

    const stationData = modeLoadout?.[side]?.[station];
    if (!stationData) return false;
    if (!isModeCompatibleStation(mode, station, stationData)) return false;
    return getWpnStationQuantity(modeLoadout, side, station) > minimumQuantity;
  }

  function getWpnStationQuantity(modeLoadout, side, station) {
    if (station === 'gun') {
      const gun = modeLoadout?.gun;
      return Number.isFinite(gun) ? gun : 0;
    }
    const q = modeLoadout?.[side]?.[station]?.quantity;
    return Number.isFinite(q) ? q : 0;
  }

  function ensureWpnSelectedWeapon(mode, modeLoadout) {
    if (!modeLoadout) return null;

    const current = wpnSelectedWeaponByMode[mode];
    if (current?.station === 'gun' && Number.isFinite(modeLoadout?.gun)) {
      if (!isModeCompatibleStation(mode, 'gun', null)) return null;
      return current;
    }

    if (current?.side && current?.station && modeLoadout?.[current.side]?.[current.station]) {
      const stationData = modeLoadout?.[current.side]?.[current.station];
      if (!isModeCompatibleStation(mode, current.station, stationData)) return null;
      return current;
    }

    return null;
  }

  function getSelectedWpnLoadDisplay(mode, modeLoadout) {
    const selected = ensureWpnSelectedWeapon(mode, modeLoadout);
    if (!selected) return 'N/A';

    if (selected.station === 'gun') {
      return 'GUN';
    }

    const station = modeLoadout?.[selected.side]?.[selected.station];
    return station?.load ?? 'N/A';
  }

  function getSelectedWpnQuantityLine(mode, modeLoadout) {
    const selected = ensureWpnSelectedWeapon(mode, modeLoadout);
    if (!selected) return 'N/A';

    if (selected.station === 'gun') {
      const quantity = Number.isFinite(modeLoadout?.gun) ? modeLoadout.gun : 0;
      return `${quantity}x GUN`;
    }

    const station = modeLoadout?.[selected.side]?.[selected.station];
    if (!station) return 'N/A';
    const quantity = Number.isFinite(station.quantity) ? station.quantity : 0;
    const load = station.load ?? station.display ?? 'N/A';
    return `${quantity}x ${load}`;
  }

  function selectNextWpnWeapon(mode, modeLoadout, minimumQuantity = 0) {
    if (!modeLoadout) return false;

    const current = ensureWpnSelectedWeapon(mode, modeLoadout);
    const currentIndex = current
      ? Math.max(0, WPN_STATION_RENDER_ORDER.findIndex((s) => s.side === current.side && s.station === current.station))
      : -1;

    for (let step = 1; step <= WPN_STATION_RENDER_ORDER.length; step++) {
      const index = (currentIndex + step) % WPN_STATION_RENDER_ORDER.length;
      const candidate = WPN_STATION_RENDER_ORDER[index];
      if (!canUseStationForMode(mode, modeLoadout, candidate.side, candidate.station, minimumQuantity)) continue;
      wpnSelectedWeaponByMode[mode] = { side: candidate.side, station: candidate.station };
      saveWpnStateToStorage();
      return true;
    }

    return false;
  }

  function selectSameWeaponHardpoint(mode, modeLoadout, selected) {
    if (!modeLoadout || !selected) return false;
    if (selected.station === 'gun') return false;
    if (!String(selected.station).startsWith('hardpoint')) return false;

    const currentStation = modeLoadout?.[selected.side]?.[selected.station];
    const currentLoadType = currentStation?.load;
    if (!currentLoadType) return false;
    if (!isModeCompatibleStation(mode, selected.station, currentStation)) return false;

    const selectedIndex = WPN_STATION_RENDER_ORDER.findIndex((s) => s.side === selected.side && s.station === selected.station);
    if (selectedIndex < 0) return false;

    for (let step = 1; step <= WPN_STATION_RENDER_ORDER.length; step++) {
      const index = (selectedIndex + step) % WPN_STATION_RENDER_ORDER.length;
      const candidate = WPN_STATION_RENDER_ORDER[index];
      if (!candidate?.station || !String(candidate.station).startsWith('hardpoint')) continue;

      const candidateStation = modeLoadout?.[candidate.side]?.[candidate.station];
      if (!candidateStation) continue;
      if (candidateStation.load !== currentLoadType) continue;
      if (!isModeCompatibleStation(mode, candidate.station, candidateStation)) continue;
      if (!Number.isFinite(candidateStation.quantity) || candidateStation.quantity <= 0) continue;

      wpnSelectedWeaponByMode[mode] = { side: candidate.side, station: candidate.station };
      saveWpnStateToStorage();
      return true;
    }

    return false;
  }

  function fireSelectedWpnWeapon(mode, modeLoadout) {
    if (!modeLoadout) return false;
    if (mode === 'NAV' || mode === 'JETTISON') return false;

    let selected = ensureWpnSelectedWeapon(mode, modeLoadout);
    if (!selected) {
      if (!selectNextWpnWeapon(mode, modeLoadout, 0)) return false;
      selected = ensureWpnSelectedWeapon(mode, modeLoadout);
      if (!selected) return false;
    }

    if (selected.station === 'gun') {
      return startWpnGunFire(mode, modeLoadout);
    }

    const station = modeLoadout?.[selected?.side]?.[selected?.station];
    if (!station || !Number.isFinite(station.quantity)) {
      return false;
    }

    if (station.quantity <= 0) {
      if (!selectSameWeaponHardpoint(mode, modeLoadout, selected)) {
        selectNextWpnWeapon(mode, modeLoadout, 0);
      }
      return false;
    }

    station.quantity -= 1;
    triggerWpnFireFlash();
    saveWpnStateToStorage();

    if (station.quantity <= 0) {
      if (!selectSameWeaponHardpoint(mode, modeLoadout, selected)) {
        selectNextWpnWeapon(mode, modeLoadout, 0);
      }
    }

    return true;
  }

  function jettisonSelectedWpnWeapon(mode, modeLoadout) {
    if (!modeLoadout) return false;
    if (mode !== 'JETTISON') return false;

    let selected = ensureWpnSelectedWeapon(mode, modeLoadout);
    if (!selected) {
      if (!selectNextWpnWeapon(mode, modeLoadout, 0)) return false;
      selected = ensureWpnSelectedWeapon(mode, modeLoadout);
      if (!selected) return false;
    }

    if (selected.station === 'gun') return false;

    const station = modeLoadout?.[selected?.side]?.[selected?.station];
    if (!station || !Number.isFinite(station.quantity)) {
      return false;
    }

    if (station.quantity <= 0) {
      if (!selectSameWeaponHardpoint(mode, modeLoadout, selected)) {
        selectNextWpnWeapon(mode, modeLoadout, 0);
      }
      return false;
    }

    station.quantity = 0;
    triggerWpnActionFlash('JETT');
    saveWpnStateToStorage();

    if (!selectSameWeaponHardpoint(mode, modeLoadout, selected)) {
      selectNextWpnWeapon(mode, modeLoadout, 0);
    }

    return true;
  }

  function normalizeOptionToken(value) {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function buildF18OptionKey(pageTitle, buttonKey) {
    return `${normalizeOptionToken(pageTitle)}.${normalizeOptionToken(buttonKey)}`;
  }

  function readF18Options() {
    try {
      const raw = window.localStorage?.getItem?.(F18_OPTIONS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch (e) {
      return {};
    }
  }

  function getF18Option(pageTitle, buttonKey, fallback = null) {
    const options = readF18Options();
    const optionKey = buildF18OptionKey(pageTitle, buttonKey);
    return options[optionKey] ?? fallback;
  }

  function getF18OptionValue(pageTitle, buttonKey, fallback = null) {
    const selectedState = getF18Option(pageTitle, buttonKey, null);
    const pages = window.__f18MfdUiState?.pages;
    if (!Array.isArray(pages)) {
      return selectedState ?? fallback;
    }

    const page = pages.find((p) => p?.title === pageTitle);
    if (!page) {
      return selectedState ?? fallback;
    }

    const allButtons = [
      ...(Array.isArray(page.leftButtons) ? page.leftButtons : []),
      ...(Array.isArray(page.rightButtons) ? page.rightButtons : [])
    ];
    const button = allButtons.find((b) => b?.key === buttonKey || b?.label === buttonKey);
    if (!button || !Array.isArray(button.values) || !button.values.length) {
      return selectedState ?? fallback;
    }

    let stateIndex = -1;
    if (selectedState != null && Array.isArray(button.states)) {
      stateIndex = button.states.findIndex((s) => String(s).toUpperCase() === String(selectedState).toUpperCase());
    }

    if (stateIndex < 0 && Number.isInteger(button.stateIndex)) {
      stateIndex = button.stateIndex;
    }

    if (stateIndex >= 0 && stateIndex < button.values.length) {
      return button.values[stateIndex];
    }

    return selectedState ?? fallback;
  }

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

  function getHudPartDefinition() {
    const parts = window.geofs?.aircraft?.instance?.parts;
    if (!parts) return null;
    const allParts = Object.values(parts);
    return allParts.find((part) => part?.renderer?.name === 'genericHUD' || part?.rendererInstance?.definition?.name === 'genericHUD') ?? null;
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

    if (label === 'UP') {
        outer.style.borderBottom = '1px solid #333';
        outer.style.borderRadius = '15px 15px 0 0';
    } else if (label === 'DOWN') {
        outer.style.marginTop = '-9px';
        outer.style.borderRadius = '0 0 15px 15px';
        outer.style.borderTop = '0';
    }

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

  class F18MfdUiState {
    constructor() {
      this.pageIndex = 0;
      this.pages = this.createPages();
      this.loadFromStorage();
      this.saveToStorage();
    }

    createPages() {
      return [
        {
          title: 'REC',
          leftButtons: [
            { key: 'STATE', label: 'STATE', states: ['OFF', 'RECORDING', 'STOPPED'], stateIndex: 0 },
            { key: 'PLAYBACK', label: 'PLAYBACK', states: ['STARTED', 'PAUSED', 'STOPPED'], stateIndex: 0 },
          ],
          rightButtons: [
          ],
          lines: []
        },
        {
          title: 'HUD',
          leftButtons: [
            { key: 'BRIGHT', label: 'BRIGHT', states: ['NORM', 'DAY', 'NIGHT'], stateIndex: 0 },
            { key: 'LEVEL', label: 'LEVEL', states: ['FULL', 'DECLUTTERED', 'MIN'], stateIndex: 0 },
            {
              key: 'MAX_G',
              label: 'MAX G',
              states: ['RESET'],
              stateIndex: 0,
              onClick: () => {
                const currentLoadFactor = window.geofs?.animation?.values?.loadFactor;
                maxG = Number.isFinite(currentLoadFactor) ? currentLoadFactor : 1;
              }
            },
          ],
          rightButtons: [
            { key: 'COLOR', label: 'MFD COLOR', states: ['GREEN', 'WHITE', 'BLUE', 'RED'], values: ['#00FF00', '#FFFFFF', '#00fffb', '#FF0000'], stateIndex: 0 },
          ],
          lines: []
        },
        {
          title: 'INF',
          leftButtons: [
            { key: 'FLAPS', label: 'FLAPS', states: ['MAN', 'AUTO'], stateIndex: 0 }
          ],
          rightButtons: [
          ],
          lines: ['F-18 - Natrium mod', 'GEAR: ' + (controls?.gear?.position === 0 ? 'DOWN' : 'UP'), 'HOOK: ' + (controls?.accessories?.position === 0 ? 'UP' : 'DOWN'), 'FLAPS: ' + (controls?.flaps?.position === 0 ? 'UP' : controls?.flaps?.position === 1 ? '1 / 2' : 'FULL')]
        },
        {
          title: 'CHK',
          leftButtons: [
            { key: 'CHECKLIST', label: 'CHECKLIST', states: ['Start', 'Taxi', 'Takeoff', 'Cruise', 'Landing'], stateIndex: 0 },
          ],
          rightButtons: [
          ],
          lines: []
        },
        {
          title: 'WPN',
          leftButtons: [
            { key: 'MASTER', label: 'MASTER', states: ['OFF', 'ON', 'SIM'], stateIndex: 0 },
            {
              key: 'SELECT',
              label: 'SELECT',
              states: ['NEXT'],
              stateIndex: 0,
              onClick: ({ page }) => {
                const mode = getWpnModeFromOptions();
                const modeLoadout = getWpnModeLoadout(mode);
                selectNextWpnWeapon(mode, modeLoadout, 0);
              },
              show: () => controls?.gear?.position === 1 && geofs?.animation?.values?.haglFeet > 50
            },
            {
              key: 'CONFIG',
              label: 'CONFIG',
              states: ['A/A', 'L/R A/A', 'A/G', 'L/R A/G', 'L/R', 'MIN', 'CLEAN'],
              stateIndex: 0,
              show: () => controls?.gear?.position === 0 && !geofs?.animation?.values?.enginesOn
            }
          ],
          rightButtons: [
            { key: 'MODE', label: 'MODE', states: ['NAV', 'A/A', 'A/G', 'JETTISON'], stateIndex: 0 },
            {
              key: 'FIRE',
              label: 'FIRE',
              states: ['N/A'],
              stateIndex: 0,
              onClick: ({ page }) => {
                const mode = getWpnModeFromOptions();
                const modeLoadout = getWpnModeLoadout(mode);
                fireSelectedWpnWeapon(mode, modeLoadout);
              },
              show: () => controls?.gear?.position === 1 && geofs?.animation?.values?.haglFeet > 50 && getF18Option('WPN', 'MASTER', 'OFF') !== 'OFF' && getF18Option('WPN', 'MODE', 'NAV') != 'JETTISON'
            },
            {
              key: 'JETTISON',
              label: 'JETTISON',
              states: ['N/A'],
              stateIndex: 0,
              onClick: ({ page }) => {
                const mode = getWpnModeFromOptions();
                const modeLoadout = getWpnModeLoadout(mode);
                jettisonSelectedWpnWeapon(mode, modeLoadout);
              },
              show: () => controls?.gear?.position === 1 && geofs?.animation?.values?.haglFeet > 50 && getF18Option('WPN', 'MASTER', 'OFF') !== 'OFF' && getF18Option('WPN', 'MODE', 'NAV') == 'JETTISON'
            },
            {
              key: 'REARM',
              label: 'REARM',
              states: ['START'],
              stateIndex: 0,
              onClick: ({ page }) => {
                // The armament to load in the wpnLoadout.
                const config = getF18Option('WPN', 'CONFIG', 'A/A');

                // Start the rearming process, which will gradually fill the wpnLoadout based on the selected config.
                startWpnRearm(config);
              },
              show: () => controls?.gear?.position === 0 && !geofs?.animation?.values?.enginesOn && getF18Option('WPN', 'MASTER', 'OFF') === 'OFF'
            }
          ],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            if (!ctx) return;

            updateWpnRearmState();

            const selectedMode = getWpnModeFromOptions();
            const modeLoadout = getWpnModeLoadout(selectedMode);
            if (!modeLoadout) return;
            const selectedWeapon = ensureWpnSelectedWeapon(selectedMode, modeLoadout);

            const fireButton = renderContext?.page?.rightButtons?.find((b) => b?.key === 'FIRE');
            if (fireButton) {
              fireButton.states = [getSelectedWpnLoadDisplay(selectedMode, modeLoadout)];
              fireButton.stateIndex = 0;
            }
            const jettisonButton = renderContext?.page?.rightButtons?.find((b) => b?.key === 'JETTISON');
            if (jettisonButton) {
              jettisonButton.states = [getSelectedWpnLoadDisplay(selectedMode, modeLoadout)];
              jettisonButton.stateIndex = 0;
            }

            const color = renderContext?.color ?? '#00ff66';
            const left = modeLoadout?.left ?? {};
            const right = modeLoadout?.right ?? {};
            const gunRounds = Number.isFinite(modeLoadout?.gun) ? modeLoadout.gun : '--';

            const drawDiamond = (x, y, size) => {
              ctx.beginPath();
              ctx.moveTo(x, y - size);
              ctx.lineTo(x + size, y);
              ctx.lineTo(x, y + size);
              ctx.lineTo(x - size, y);
              ctx.closePath();
              ctx.stroke();
            };

            const drawStation = (x, y, station, options = {}) => {
              const quantity = Number.isFinite(station?.quantity) ? String(station.quantity) : '--';
              const display = station?.display ?? '--';
              const showDiamond = options.showDiamond !== false;
              const boxedQuantity = options.boxedQuantity === true;

              if (showDiamond) {
                drawDiamond(x, y - h * 0.036, w * 0.012);
              }

              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.font = `bold ${Math.round(h * 0.042)}px monospace`;

              if (boxedQuantity) {
                const boxW = w * 0.078;
                const boxH = h * 0.044;
                const by = y - boxH * 0.5 + h * 0.003;
                ctx.strokeRect(x - boxW * 0.5, by + 1, boxW, boxH);
              }

              ctx.fillText(quantity, x, y + 4);
              ctx.fillText(display, x, y + h * 0.045 + 4);
            };

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = Math.max(1.4, w * 0.003);

            const yOffset = h * 0.11;

            const cx = w * 0.5;

            // Wing contour
            const leftRootX = w * 0.44;
            const rightRootX = w * 0.56;
            const topY = h * 0.20 + yOffset;
            const midY = h * 0.31 + yOffset;
            const breakY = h * 0.40 + yOffset;
            const tipY = h * 0.54 + yOffset;
            const leftBreakX = w * 0.31;
            const rightBreakX = w * 0.69;
            const leftTipX = w * 0.09;
            const rightTipX = w * 0.91;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(h * 0.048)}px monospace`;
            
            if (selectedWeapon?.station === 'gun') {
              const boxW = w * 0.12;
              const boxH = h * 0.06;
              ctx.strokeRect(cx - boxW * 0.5, topY - boxH * 0.5, boxW, boxH);
            }
            
            ctx.fillText(String(gunRounds), cx, topY);
            ctx.beginPath();
            ctx.moveTo(leftRootX, topY);
            ctx.lineTo(leftRootX, midY);
            ctx.lineTo(leftBreakX, breakY);
            ctx.lineTo(leftTipX, tipY);
            ctx.moveTo(rightRootX, topY);
            ctx.lineTo(rightRootX, midY);
            ctx.lineTo(rightBreakX, breakY);
            ctx.lineTo(rightTipX, tipY);
            ctx.stroke();

            ctx.font = `bold ${Math.round(h * 0.055)}px monospace`;
            ctx.fillText('FUEL', cx, h * 0.35 + yOffset);

            if (getF18Option('WPN', 'MASTER', 'OFF') !== 'OFF') {
              ctx.fillText('ARM', cx, h * 0.47 + yOffset);
            }

            // Stations left wing (wingtip -> hardpoint1 -> hardpoint2)
            ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
            drawStation(w * 0.06, h * 0.50 + yOffset, left?.wingtip, {
              showDiamond: false,
              boxedQuantity: selectedWeapon?.side === 'left' && selectedWeapon?.station === 'wingtip'
            });
            drawStation(w * 0.18, h * 0.54 + yOffset, left?.hardpoint1, {
              boxedQuantity: selectedWeapon?.side === 'left' && selectedWeapon?.station === 'hardpoint1'
            });
            drawStation(w * 0.29, h * 0.47 + yOffset, left?.hardpoint2, {
              boxedQuantity: selectedWeapon?.side === 'left' && selectedWeapon?.station === 'hardpoint2'
            });

            // Stations right wing (hardpoint2 -> hardpoint1 -> wingtip)
            drawStation(w * 0.71, h * 0.47 + yOffset, right?.hardpoint2, {
              boxedQuantity: selectedWeapon?.side === 'right' && selectedWeapon?.station === 'hardpoint2'
            });
            drawStation(w * 0.82, h * 0.54 + yOffset, right?.hardpoint1, {
              boxedQuantity: selectedWeapon?.side === 'right' && selectedWeapon?.station === 'hardpoint1'
            });
            drawStation(w * 0.94, h * 0.50 + yOffset, right?.wingtip, {
              showDiamond: false,
              boxedQuantity: selectedWeapon?.side === 'right' && selectedWeapon?.station === 'wingtip'
            });

            if (isWpnFireFlashVisible()) {
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.font = `bold ${Math.round(h * 0.12)}px monospace`;
              ctx.fillStyle = '#ff0000';
              ctx.fillText(getWpnActionFlashLabel(), cx, h * 0.72);
              ctx.fillStyle = color;
            }

            // Rearming state: show a progress bar until rearming is complete.
            // If not rearming, show a simple line: "Rearm with engine off on ground."
            const rearmTextY = h * 0.84;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (wpnRearmState.active) {
              const progress = Math.max(0, Math.min(1, wpnRearmState.progress ?? 0));
              const pct = Math.round(progress * 100);
              const barW = w * 0.50;
              const barH = h * 0.03;
              const barX = cx - barW * 0.5;
              const barY = h * 0.875;

              ctx.font = `bold ${Math.round(h * 0.034)}px monospace`;
              ctx.fillText(`REARMING ${wpnRearmState.config} ${pct}%`, cx, rearmTextY);

              ctx.strokeRect(barX, barY, barW, barH);
              ctx.fillRect(barX, barY, barW * progress, barH);
            } else {
              ctx.font = `bold ${Math.round(h * 0.03)}px monospace`;
              ctx.fillText('Rearm with Engine OFF, Master OFF on ground.', cx, rearmTextY);
            }

            ctx.restore();
          }
        }
      ];
    }

    getCurrentPage() {
      return this.pages[this.pageIndex] ?? this.pages[0];
    }

    nextPage() {
      this.pageIndex = (this.pageIndex + 1) % this.pages.length;
    }

    prevPage() {
      this.pageIndex = (this.pageIndex - 1 + this.pages.length) % this.pages.length;
    }

    setPage(index) {
      if (index >= 0 && index < this.pages.length) {
        this.pageIndex = index;
      }
    }

    getButtonStorageKey(page, button, index, side) {
      const preferred = button?.key || button?.label || `${side}${index + 1}`;
      return buildF18OptionKey(page?.title ?? 'PAGE', preferred);
    }

    loadFromStorage() {
      try {
        const stored = readF18Options();

        for (let pageIndex = 0; pageIndex < this.pages.length; pageIndex++) {
          const page = this.pages[pageIndex];
          if (!page) continue;

          for (let i = 0; i < (page.leftButtons?.length ?? 0); i++) {
            const btn = page.leftButtons[i];
            if (!btn || !btn.states?.length) continue;
            const optionKey = this.getButtonStorageKey(page, btn, i, 'L');
            const storedState = stored[optionKey];
            if (storedState == null) continue;

            const exactIndex = btn.states.findIndex((s) => s === storedState);
            if (exactIndex >= 0) {
              btn.stateIndex = exactIndex;
              continue;
            }

            const ciIndex = btn.states.findIndex((s) => String(s).toUpperCase() === String(storedState).toUpperCase());
            if (ciIndex >= 0) {
              btn.stateIndex = ciIndex;
            }
          }

          for (let i = 0; i < (page.rightButtons?.length ?? 0); i++) {
            const btn = page.rightButtons[i];
            if (!btn || !btn.states?.length) continue;
            const optionKey = this.getButtonStorageKey(page, btn, i, 'R');
            const storedState = stored[optionKey];
            if (storedState == null) continue;

            const exactIndex = btn.states.findIndex((s) => s === storedState);
            if (exactIndex >= 0) {
              btn.stateIndex = exactIndex;
              continue;
            }

            const ciIndex = btn.states.findIndex((s) => String(s).toUpperCase() === String(storedState).toUpperCase());
            if (ciIndex >= 0) {
              btn.stateIndex = ciIndex;
            }
          }
        }
      } catch (e) {
        // Ignore malformed storage.
      }
    }

    saveToStorage() {
      try {
        const data = {};

        for (let pageIndex = 0; pageIndex < this.pages.length; pageIndex++) {
          const page = this.pages[pageIndex];
          if (!page) continue;

          for (let i = 0; i < (page.leftButtons?.length ?? 0); i++) {
            const btn = page.leftButtons[i];
            if (!btn || !btn.states?.length) continue;
            const optionKey = this.getButtonStorageKey(page, btn, i, 'L');
            const stateValue = btn.states[btn.stateIndex] ?? btn.states[0];
            data[optionKey] = stateValue;
          }

          for (let i = 0; i < (page.rightButtons?.length ?? 0); i++) {
            const btn = page.rightButtons[i];
            if (!btn || !btn.states?.length) continue;
            const optionKey = this.getButtonStorageKey(page, btn, i, 'R');
            const stateValue = btn.states[btn.stateIndex] ?? btn.states[0];
            data[optionKey] = stateValue;
          }
        }

        window.localStorage?.setItem?.(F18_OPTIONS_STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        // Ignore storage write issues.
      }
    }

    toggleButton(side, index) {
      const page = this.getCurrentPage();
      const list = side === 'left' ? page.leftButtons : page.rightButtons;
      const btn = list?.[index];
      if (!btn || !btn.states?.length) return;

      if (typeof btn.onClick === 'function') {
        try {
          btn.onClick({
            page,
            side,
            index,
            button: btn,
            uiState: this
          });
        } catch (e) {
          // Ignore button callback errors to keep MFD responsive.
        }
      }

      btn.stateIndex = (btn.stateIndex + 1) % btn.states.length;
      this.saveToStorage();
    }

    isButtonVisible(button, page) {
      if (!button) return false;
      if (typeof button.show !== 'function') return true;
      try {
        return Boolean(button.show({ page, button, uiState: this }));
      } catch (e) {
        return false;
      }
    }

    getVisibleButtonEntries(side, page = this.getCurrentPage()) {
      const list = side === 'left' ? page?.leftButtons : page?.rightButtons;
      if (!Array.isArray(list)) return [];

      const entries = [];
      for (let i = 0; i < list.length; i++) {
        const button = list[i];
        if (this.isButtonVisible(button, page)) {
          entries.push({ button, actualIndex: i });
        }
      }
      return entries;
    }

    toggleButtonBySlot(side, slotIndex) {
      const page = this.getCurrentPage();
      const visibleEntries = this.getVisibleButtonEntries(side, page);
      const entry = visibleEntries?.[slotIndex];
      if (!entry) return;
      this.toggleButton(side, entry.actualIndex);
    }

    getStateLabel(button, page) {
      if (page?.title === 'WPN' && (button?.key === 'FIRE' || button?.key === 'JETTISON')) {
        const mode = getWpnModeFromOptions();
        const modeLoadout = getWpnModeLoadout(mode);
        return getSelectedWpnLoadDisplay(mode, modeLoadout);
      }
      return button?.states?.[button.stateIndex] ?? '';
    }

    getLayout(w, h) {
      const frame = {
        left: 0,
        top: 0,
        width: w,
        height: h
      };

      const tabY = frame.top + h * 0.022;
      const tabW = w * 0.14;
      const tabH = h * 0.06;
      const tabGap = w * 0.03;
      const tabsTotalW = this.pages.length * tabW + (this.pages.length - 1) * tabGap;
      const tabStartX = frame.left + (frame.width - tabsTotalW) * 0.5;

      const tabs = this.pages.map((p, i) => ({
        index: i,
        title: p.title,
        x: tabStartX + i * (tabW + tabGap) - w * 0.012,
        y: tabY - h * 0.01,
        w: tabW + w * 0.024,
        h: tabH + h * 0.02
      }));

      const leftButtons = [];
      const rightButtons = [];
      const rowStartY = frame.top + h * 0.14;
      const rowStep = h * 0.155;
      const rowH = h * 0.08;

      for (let i = 0; i < 4; i++) {
        const y = rowStartY + i * rowStep;
        leftButtons.push({ index: i, x: frame.left + w * 0.028, y, w: w * 0.40, h: rowH });
        rightButtons.push({ index: i, x: frame.left + frame.width - w * 0.428, y, w: w * 0.40, h: rowH });
      }

      return { frame, tabs, leftButtons, rightButtons };
    }

    handleLocalClick(nx, ny) {
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false;

      const w = 512;
      const h = 512;
      const x = nx * w;
      const y = ny * h;
      const page = this.getCurrentPage();
      const layout = this.getLayout(w, h);

      for (const tab of layout.tabs) {
        if (x >= tab.x && x <= tab.x + tab.w && y >= tab.y && y <= tab.y + tab.h) {
          this.setPage(tab.index);
          return true;
        }
      }

      for (const slot of layout.leftButtons) {
        if (slot.index < this.getVisibleButtonEntries('left', page).length
          && x >= slot.x && x <= slot.x + slot.w
          && y >= slot.y && y <= slot.y + slot.h) {
          this.toggleButtonBySlot('left', slot.index);
          return true;
        }
      }

      for (const slot of layout.rightButtons) {
        if (slot.index < this.getVisibleButtonEntries('right', page).length
          && x >= slot.x && x <= slot.x + slot.w
          && y >= slot.y && y <= slot.y + slot.h) {
          this.toggleButtonBySlot('right', slot.index);
          return true;
        }
      }

      return false;
    }

    render(renderer) {
      const ctx = renderer.canvasAPI.context;
      const w = renderer.canvasAPI.canvas.width;
      const h = renderer.canvasAPI.canvas.height;
      const page = this.getCurrentPage();
      const layout = this.getLayout(w, h);
      const color = getF18OptionValue('HUD', 'COLOR', '#00ff66') ?? '#00ff66';
      renderer.canvasAPI.clear();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(layout.frame.left, layout.frame.top, layout.frame.width, layout.frame.height);

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(h * 0.045)}px monospace`;

      for (const tab of layout.tabs) {
        ctx.fillText(tab.title, tab.x + tab.w / 2, tab.y + tab.h / 2);
        if (tab.index === this.pageIndex) {
          ctx.strokeRect(tab.x - 4, tab.y - 2, tab.w + 8, tab.h + 4);
        }
      }

      ctx.textAlign = 'left';
      ctx.font = `bold ${Math.round(h * 0.045)}px monospace`;

      const visibleLeftButtons = this.getVisibleButtonEntries('left', page);
      const visibleRightButtons = this.getVisibleButtonEntries('right', page);

      for (let i = 0; i < visibleLeftButtons.length && i < layout.leftButtons.length; i++) {
        const slot = layout.leftButtons[i];
        const btn = visibleLeftButtons[i].button;
        const label = btn.label;
        const state = this.getStateLabel(btn, page);
        ctx.fillText(`${label}   ${state}`, slot.x + 2, slot.y + slot.h * 0.55);
      }

      for (let i = 0; i < visibleRightButtons.length && i < layout.rightButtons.length; i++) {
        const slot = layout.rightButtons[i];
        const btn = visibleRightButtons[i].button;
        const label = btn.label;
        const state = this.getStateLabel(btn, page);
        ctx.fillText(`${label}   ${state}`, slot.x + 2, slot.y + slot.h * 0.55);
      }

      if (Array.isArray(page.lines) && page.lines.length) {
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(h * 0.05)}px monospace`;
        page.lines.forEach((line, i) => {
          ctx.fillText(line, w * 0.5, h * (0.72 + i * 0.07));
        });
      }

      if (typeof page.render === 'function') {
        try {
          page.render(renderer, {
            ctx,
            w,
            h,
            page,
            layout,
            uiState: this,
            color
          });
        } catch (e) {
          // Ignore page render callback errors to keep MFD responsive.
        }
      }
    }
  }

  function getHudColorFromStoredOptions() {
    return getF18OptionValue('HUD', 'COLOR', '#00ff00') ?? '#00ff00';
  }

  function ensureRightMfdRendererFunction() {
    if (!window.instruments?.renderers) return false;
    if (window.instruments.renderers[RIGHT_MFD_RENDERER_NAME]) return true;

    window.instruments.renderers[RIGHT_MFD_RENDERER_NAME] = function (renderer) {
      const uiState = window.__f18MfdUiState;

      if (uiState?.render) {
        uiState.render(renderer);
        return;
      }

      const ctx = renderer.canvasAPI.context;
      const w = renderer.canvasAPI.canvas.width;
      const h = renderer.canvasAPI.canvas.height;
      renderer.canvasAPI.clear('#000000');
      ctx.fillStyle = getF18OptionValue('HUD', 'COLOR', '#00ff00') ?? '#00ff00';
      ctx.font = `bold ${Math.round(h * 0.18)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MFD INIT', w / 2, h / 2);
    };

    return true;
  }

  function renderRightMfdTopButton(renderer) {
    const ctx = renderer.canvasAPI.context;
    const w = renderer.canvasAPI.canvas.width;
    const h = renderer.canvasAPI.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const outerSize = Math.min(w, h) * RIGHT_MFD_TOP_BUTTON_VISUAL_SCALE;
    const outerRadius = outerSize * 0.20;
    const innerInset = outerSize * 0.24;
    const innerSize = outerSize - innerInset * 2;
    const innerRadius = innerSize * 0.36;

    renderer.canvasAPI.clear('#000000');

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const outerX = cx - outerSize / 2;
    const outerY = cy - outerSize / 2;

    ctx.beginPath();
    ctx.roundRect(outerX, outerY, outerSize, outerSize, outerRadius);
    ctx.fillStyle = '#222120';
    ctx.fill();

    ctx.lineWidth = Math.max(2, outerSize * 0.045);
    ctx.strokeStyle = '#0f0f0e';
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(outerX + innerInset, outerY + innerInset, innerSize, innerSize, innerRadius);
    ctx.fillStyle = '#3a3835';
    ctx.fill();

    ctx.lineWidth = Math.max(1.2, outerSize * 0.018);
    ctx.strokeStyle = '#2f2d2a';
    ctx.stroke();

    ctx.restore();
  }

  function ensureRightMfdTopButtonRendererFunction() {
    if (!window.instruments?.renderers) return false;
    if (window.instruments.renderers[RIGHT_MFD_TOP_BUTTON_RENDERER_NAME]) return true;

    window.instruments.renderers[RIGHT_MFD_TOP_BUTTON_RENDERER_NAME] = function (renderer) {
      renderRightMfdTopButton(renderer);
    };

    return true;
  }

  function ensureRightMfdIncludeDefinition() {
    if (!window.geofs) return false;
    window.geofs.includes = window.geofs.includes || {};
    if (window.geofs.includes[RIGHT_MFD_INCLUDE_KEY]) return true;

    window.geofs.includes[RIGHT_MFD_INCLUDE_KEY] = [{
      model: {
        url: 'models/gauges/glassPanel/glassPanel.gltf',
        shader: {
          name: 'glassPanel',
          textures: {
            diffuse: ''
          }
        }
      },
      renderer: {
        name: RIGHT_MFD_RENDERER_NAME,
        width: 512,
        height: 512,
        images: { }
      },
      animations: [{
        type: 'render',
        value: 'geofsTime'
      }],
      shadows: 'SHADOWS_NONE'
    }];

    return true;
  }

  function getRightMfdTopButtonIncludeKey(partName) {
    return `${RIGHT_MFD_TOP_BUTTON_INCLUDE_KEY_BASE}-${partName}`;
  }

  function getRightMfdTopButtonPartName(index) {
    return `${RIGHT_MFD_TOP_BUTTON_PART_NAME_BASE}${index}`;
  }

  function getRightMfdTopButtonNodeName(index) {
    return `${RIGHT_MFD_TOP_BUTTON_PART_NAME_BASE}${index}`;
  }

  function getRightMfdLeftButtonPartName(index) {
    return `${RIGHT_MFD_LEFT_BUTTON_PART_NAME_BASE}${index}`;
  }

  function getRightMfdLeftButtonNodeName(index) {
    return `${RIGHT_MFD_LEFT_BUTTON_PART_NAME_BASE}${index}`;
  }

  function getRightMfdRightButtonPartName(index) {
    return `${RIGHT_MFD_RIGHT_BUTTON_PART_NAME_BASE}${index}`;
  }

  function getRightMfdRightButtonNodeName(index) {
    return `${RIGHT_MFD_RIGHT_BUTTON_PART_NAME_BASE}${index}`;
  }

  function getRightMfdTopButtonModelUrl(partName) {
    return `models/gauges/glassPanel/glassPanel.gltf?v=topbutton-${encodeURIComponent(partName)}`;
  }

  function ensureRightMfdTopButtonIncludeDefinition(partName) {
    if (!window.geofs) return false;
    window.geofs.includes = window.geofs.includes || {};
    const includeKey = getRightMfdTopButtonIncludeKey(partName);
    if (window.geofs.includes[includeKey]) return true;

    window.geofs.includes[includeKey] = [{
      model: {
        url: getRightMfdTopButtonModelUrl(partName),
        shader: {
          name: 'glassPanel',
          textures: {
            diffuse: ''
          }
        }
      },
      renderer: {
        name: RIGHT_MFD_TOP_BUTTON_RENDERER_NAME,
        width: 512,
        height: 512,
        images: { }
      },
      animations: [{
        type: 'render',
        value: 'geofsTime'
      }],
      shadows: 'SHADOWS_NONE'
    }];

    return true;
  }

  function installRightMfdTopButtons() {
    const aircraft = window.geofs?.aircraft?.instance;
    if (!aircraft?.addParts) return false;
    if (!ensureRightMfdTopButtonRendererFunction()) return false;
    if (!aircraft.parts?.[RIGHT_MFD_PART_NAME]) return false;

    const partsToAdd = [];
    for (let i = 0; i < RIGHT_MFD_TOP_BUTTON_COUNT; i++) {
      const partName = getRightMfdTopButtonPartName(i);
      if (aircraft.parts?.[partName]) continue;
      if (!ensureRightMfdTopButtonIncludeDefinition(partName)) return false;

      partsToAdd.push({
        name: partName,
        include: getRightMfdTopButtonIncludeKey(partName),
        parent: RIGHT_MFD_PART_NAME,
        position: [RIGHT_MFD_TOP_BUTTON_START_X + i * RIGHT_MFD_TOP_BUTTON_STEP_X, RIGHT_MFD_TOP_BUTTON_Y, RIGHT_MFD_TOP_BUTTON_Z],
        scale: [0.047, 0.047, 0.047],
        shadows: 'SHADOWS_NONE'
      });
    }

    if (partsToAdd.length) {
      aircraft.addParts(partsToAdd);
    }

    const registerTopButtonPickNode = (index) => {
      const partName = getRightMfdTopButtonPartName(index);
      const nodeName = getRightMfdTopButtonNodeName(index);
      const part = aircraft.parts?.[partName];
      if (!part) return false;

      const model = part?.object3d?.model?._model;
      const nodesByName = model?._nodesByName;
      const glassNode = nodesByName?.glassPanel;
      if (!glassNode) return false;

      glassNode.name = nodeName;
      nodesByName[nodeName] = glassNode;
      return true;
    };

    for (let i = 0; i < RIGHT_MFD_TOP_BUTTON_COUNT; i++) {
      const partName = getRightMfdTopButtonPartName(i);
      if (!aircraft.parts?.[partName]) return false;

      if (!registerTopButtonPickNode(i)) {
        const buttonPart = aircraft.parts?.[partName];
        buttonPart?.['3dmodel']?.readyPromise?.then?.(() => {
          registerTopButtonPickNode(i);
        });
      }
    }

    return true;
  }

  function installRightMfdLeftButtons() {
    const aircraft = window.geofs?.aircraft?.instance;
    if (!aircraft?.addParts) return false;
    if (!ensureRightMfdTopButtonRendererFunction()) return false;
    if (!aircraft.parts?.[RIGHT_MFD_PART_NAME]) return false;

    const partsToAdd = [];
    for (let i = 0; i < RIGHT_MFD_LEFT_BUTTON_COUNT; i++) {
      const partName = getRightMfdLeftButtonPartName(i);
      if (aircraft.parts?.[partName]) continue;
      if (!ensureRightMfdTopButtonIncludeDefinition(partName)) return false;

      partsToAdd.push({
        name: partName,
        include: getRightMfdTopButtonIncludeKey(partName),
        parent: RIGHT_MFD_PART_NAME,
        position: [RIGHT_MFD_LEFT_BUTTON_X, RIGHT_MFD_LEFT_BUTTON_Y, RIGHT_MFD_LEFT_BUTTON_START_Z - i * RIGHT_MFD_LEFT_BUTTON_STEP_Z],
        scale: [0.047, 0.047, 0.047],
        shadows: 'SHADOWS_NONE'
      });
    }

    if (partsToAdd.length) {
      aircraft.addParts(partsToAdd);
    }

    const registerLeftButtonPickNode = (index) => {
      const partName = getRightMfdLeftButtonPartName(index);
      const nodeName = getRightMfdLeftButtonNodeName(index);
      const part = aircraft.parts?.[partName];
      if (!part) return false;

      const model = part?.object3d?.model?._model;
      const nodesByName = model?._nodesByName;
      const glassNode = nodesByName?.glassPanel;
      if (!glassNode) return false;

      glassNode.name = nodeName;
      nodesByName[nodeName] = glassNode;
      return true;
    };

    for (let i = 0; i < RIGHT_MFD_LEFT_BUTTON_COUNT; i++) {
      const partName = getRightMfdLeftButtonPartName(i);
      if (!aircraft.parts?.[partName]) return false;

      if (!registerLeftButtonPickNode(i)) {
        const buttonPart = aircraft.parts?.[partName];
        buttonPart?.['3dmodel']?.readyPromise?.then?.(() => {
          registerLeftButtonPickNode(i);
        });
      }
    }

    return true;
  }

  function installRightMfdRightButtons() {
    const aircraft = window.geofs?.aircraft?.instance;
    if (!aircraft?.addParts) return false;
    if (!ensureRightMfdTopButtonRendererFunction()) return false;
    if (!aircraft.parts?.[RIGHT_MFD_PART_NAME]) return false;

    const partsToAdd = [];
    for (let i = 0; i < RIGHT_MFD_RIGHT_BUTTON_COUNT; i++) {
      const partName = getRightMfdRightButtonPartName(i);
      if (aircraft.parts?.[partName]) continue;
      if (!ensureRightMfdTopButtonIncludeDefinition(partName)) return false;

      partsToAdd.push({
        name: partName,
        include: getRightMfdTopButtonIncludeKey(partName),
        parent: RIGHT_MFD_PART_NAME,
        position: [RIGHT_MFD_RIGHT_BUTTON_X, RIGHT_MFD_RIGHT_BUTTON_Y, RIGHT_MFD_RIGHT_BUTTON_START_Z - i * RIGHT_MFD_RIGHT_BUTTON_STEP_Z],
        scale: [0.047, 0.047, 0.047],
        shadows: 'SHADOWS_NONE'
      });
    }

    if (partsToAdd.length) {
      aircraft.addParts(partsToAdd);
    }

    const registerRightButtonPickNode = (index) => {
      const partName = getRightMfdRightButtonPartName(index);
      const nodeName = getRightMfdRightButtonNodeName(index);
      const part = aircraft.parts?.[partName];
      if (!part) return false;

      const model = part?.object3d?.model?._model;
      const nodesByName = model?._nodesByName;
      const glassNode = nodesByName?.glassPanel;
      if (!glassNode) return false;

      glassNode.name = nodeName;
      nodesByName[nodeName] = glassNode;
      return true;
    };

    for (let i = 0; i < RIGHT_MFD_RIGHT_BUTTON_COUNT; i++) {
      const partName = getRightMfdRightButtonPartName(i);
      if (!aircraft.parts?.[partName]) return false;

      if (!registerRightButtonPickNode(i)) {
        const buttonPart = aircraft.parts?.[partName];
        buttonPart?.['3dmodel']?.readyPromise?.then?.(() => {
          registerRightButtonPickNode(i);
        });
      }
    }

    return true;
  }

  function installRightMfdUsingGeoFsParts() {
    if (window.__f18RightMfdPart) {
      const existingPart = window.geofs?.aircraft?.instance?.parts?.[RIGHT_MFD_PART_NAME];
      if (!existingPart) {
        delete window.__f18RightMfdPart;
      } else {
        return true;
      }
    }
    if (!isF18Active()) {
      return false;
    }

    const aircraft = window.geofs?.aircraft?.instance;
    if (!aircraft?.addParts) {
      return false;
    }
    if (!ensureRightMfdRendererFunction()) {
      return false;
    }
    if (!ensureRightMfdIncludeDefinition()) {
      return false;
    }

    const hudPart = getHudPartDefinition();
    if (!hudPart) return false;

    aircraft.addParts([{
      name: RIGHT_MFD_PART_NAME,
      include: RIGHT_MFD_INCLUDE_KEY,
      parent: hudPart.parent || 'root',
      position: [ 0.2167, 6.158, 0.584],
      rotation: [RIGHT_MFD_TILT_DEG, 0, 0],
      scale: [0.29, 0.29, 0.285],
      points: {
        topLeft: [-RIGHT_MFD_CLICK_HALF_WIDTH, 0, RIGHT_MFD_CLICK_HALF_HEIGHT],
        topRight: [RIGHT_MFD_CLICK_HALF_WIDTH, 0, RIGHT_MFD_CLICK_HALF_HEIGHT],
        bottomLeft: [-RIGHT_MFD_CLICK_HALF_WIDTH, 0, -RIGHT_MFD_CLICK_HALF_HEIGHT],
        bottomRight: [RIGHT_MFD_CLICK_HALF_WIDTH, 0, -RIGHT_MFD_CLICK_HALF_HEIGHT]
      }
    }]);

    if (!aircraft.parts?.[RIGHT_MFD_PART_NAME]) return false;

    const rightMfdPart = aircraft.parts[RIGHT_MFD_PART_NAME];
    const registerPickNode = () => {
      const model = rightMfdPart?.object3d?.model?._model;
      const nodesByName = model?._nodesByName;
      const glassNode = nodesByName?.glassPanel;
      if (!glassNode) return false;

      glassNode.name = RIGHT_MFD_PART_NAME;
      nodesByName[RIGHT_MFD_PART_NAME] = glassNode;
      return true;
    };

    if (!registerPickNode()) {
      rightMfdPart?.['3dmodel']?.readyPromise?.then?.(() => {
        registerPickNode();
      });
    }

    installRightMfdTopButtons();
    installRightMfdLeftButtons();
    installRightMfdRightButtons();

    window.__f18RightMfdPart = {
      remove() {
        const ac = window.geofs?.aircraft?.instance;
        for (let i = 0; i < RIGHT_MFD_TOP_BUTTON_COUNT; i++) {
          const topButtonPartName = getRightMfdTopButtonPartName(i);
          const topButtonPart = ac?.parts?.[topButtonPartName];
          if (!topButtonPart) continue;

          const topButtonParent = topButtonPart.object3d?.getParent?.();
          if (topButtonParent?._children) {
            const topButtonIdx = topButtonParent._children.indexOf(topButtonPart.object3d);
            if (topButtonIdx >= 0) topButtonParent._children.splice(topButtonIdx, 1);
          }
          topButtonPart.object3d?.destroy?.();
          topButtonPart.rendererInstance?.destroy?.();
          topButtonPart['3dmodel']?.destroy?.();
          delete ac.parts[topButtonPartName];
        }

        for (let i = 0; i < RIGHT_MFD_LEFT_BUTTON_COUNT; i++) {
          const leftButtonPartName = getRightMfdLeftButtonPartName(i);
          const leftButtonPart = ac?.parts?.[leftButtonPartName];
          if (!leftButtonPart) continue;

          const leftButtonParent = leftButtonPart.object3d?.getParent?.();
          if (leftButtonParent?._children) {
            const leftButtonIdx = leftButtonParent._children.indexOf(leftButtonPart.object3d);
            if (leftButtonIdx >= 0) leftButtonParent._children.splice(leftButtonIdx, 1);
          }
          leftButtonPart.object3d?.destroy?.();
          leftButtonPart.rendererInstance?.destroy?.();
          leftButtonPart['3dmodel']?.destroy?.();
          delete ac.parts[leftButtonPartName];
        }

        for (let i = 0; i < RIGHT_MFD_RIGHT_BUTTON_COUNT; i++) {
          const rightButtonPartName = getRightMfdRightButtonPartName(i);
          const rightButtonPart = ac?.parts?.[rightButtonPartName];
          if (!rightButtonPart) continue;

          const rightButtonParent = rightButtonPart.object3d?.getParent?.();
          if (rightButtonParent?._children) {
            const rightButtonIdx = rightButtonParent._children.indexOf(rightButtonPart.object3d);
            if (rightButtonIdx >= 0) rightButtonParent._children.splice(rightButtonIdx, 1);
          }
          rightButtonPart.object3d?.destroy?.();
          rightButtonPart.rendererInstance?.destroy?.();
          rightButtonPart['3dmodel']?.destroy?.();
          delete ac.parts[rightButtonPartName];
        }

        const part = ac?.parts?.[RIGHT_MFD_PART_NAME];
        if (part) {
          const parent = part.object3d?.getParent?.();
          if (parent?._children) {
            const idx = parent._children.indexOf(part.object3d);
            if (idx >= 0) parent._children.splice(idx, 1);
          }
          part.object3d?.destroy?.();
          part.rendererInstance?.destroy?.();
          part['3dmodel']?.destroy?.();
          delete ac.parts[RIGHT_MFD_PART_NAME];
        }
        delete window.__f18RightMfdPart;
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
    ctx.fillStyle = currentHudColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`α ${aoa.toFixed(1)}`, w * 0.716, h * 0.93);
    ctx.textAlign = previousAlign;
    ctx.textBaseline = previousBaseline;
  }

  function drawBoresight(ctx, cx, symbolCy, pixelsPerDeg, w, h) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = currentHudColor;
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
    ctx.strokeStyle = currentHudColor;
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
    ctx.fillStyle = currentHudColor;
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

    ctx.strokeStyle = currentHudColor;
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

    ctx.strokeStyle = currentHudColor;
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
    const boxY = h * 0.295;
    const boxW = w * 0.118;
    const boxH = h * 0.064;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = currentHudColor;
    ctx.lineWidth = Math.max(1.2, w * 0.0028);
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = currentHudColor;
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
    const boxY = h * 0.295;
    const boxW = w * 0.138;
    const boxH = h * 0.064;

    const altRounded = Math.max(0, Math.round(alt));
    const thousands = Math.floor(altRounded / 1000);
    const hundreds = altRounded % 1000;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = currentHudColor;
    ctx.lineWidth = Math.max(1.2, w * 0.0028);
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    const rightX = boxX + boxW - w * 0.012;
    const centerY = boxY + boxH / 2 + 1;
    const smallText = String(hundreds).padStart(3, '0');

    ctx.fillStyle = currentHudColor;
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
    const y1 = h * 0.405;
    const y2 = h * 0.457;
    const y3 = h * 0.509;
    const y4 = h * 0.561;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = currentHudColor;
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
      const sepY = h * 0.596;
      ctx.beginPath();
      ctx.moveTo(x, sepY);
      ctx.lineTo(w * 0.265, sepY);
      ctx.strokeStyle = currentHudColor;
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

  function drawRightReadouts(ctx, vsi, radioAlt, trimDisplay, navUnit, w, h, wpnHudStatus) {
    const x = w * 0.730;
    const yTop = h * 0.260;
    const yBottom = h * 0.405;
    const yTrim = h * 0.457;
    const yWpn1 = h * 0.509;
    const yWpn2 = h * 0.561;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = currentHudColor;
    ctx.font = `${Math.round(h * 0.036)}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(` ${vsi >= 0 ? ' ' : ''}${vsi}`, x, yTop);

    if (radioAlt <= 10000) {
      ctx.fillText(`R ${Math.round(radioAlt)}`, x, yBottom);
    }

    ctx.fillText(trimDisplay, x, yTrim);

    if (wpnHudStatus) {
      ctx.fillText(wpnHudStatus.line1, x, yWpn1);
      ctx.fillText(wpnHudStatus.line2, x, yWpn2);
    }

    if (navUnit != null) {
      const sepY = h * 0.596;
      ctx.beginPath();
      ctx.moveTo(x, sepY);
      ctx.lineTo(w * 0.85, sepY);
      ctx.strokeStyle = currentHudColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const rowStep = h * 0.046;
      let rowY = sepY + h * 0.038;
      ctx.font = `${Math.round(h * 0.032)}px monospace`;

      const dme = navUnit?.DME ?? '';
      const bearing = Number.isFinite(navUnit?.bearing) ? Math.round(navUnit.bearing) : '';
      const course = Number.isFinite(navUnit?.course) ? Math.round(navUnit.course) : '';
      const timeToSignal = navUnit?.timeToSignal ?? '';

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
    ctx.strokeStyle = currentHudColor;
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

        ctx.fillStyle = currentHudColor;
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
      ctx.fillStyle = currentHudColor;
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
    ctx.strokeStyle = currentHudColor;
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
    const wpnMaster = getF18Option('WPN', 'MASTER', 'OFF');
    const wpnMode = getWpnModeFromOptions();
    const wpnModeLoadout = getWpnModeLoadout(wpnMode);
    const wpnHudStatus = wpnMaster !== 'OFF'
      ? {
          line1: `${wpnMaster === 'SIM' ? 'SIM' : 'ARM'} ${wpnMode}`,
          line2: getSelectedWpnQuantityLine(wpnMode, wpnModeLoadout)
        }
      : null;
    const hudColor = getHudColorFromStoredOptions();
    const hudLevel = getF18Option('HUD', 'LEVEL', 'FULL');
    currentHudColor = hudColor;

    updateWpnRearmState();

    if (currentG > maxG) {
      maxG = currentG;
    }

    // Canvas leeg maken met echte transparantie (voorkomt volle groene plaat).
    o.save();
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, w, h);
    o.restore();

    // Achtergrond overlay (GeoFS origineel gebruikt e.images.background; hier weglaten
    // want we willen een glazen HUD zonder achtergrond-sprite).

    o.fillStyle = hudColor;
    o.strokeStyle = hudColor;
    o.lineWidth = 2;
    o.font = `20px sans-serif`;

    // --- Kompasband bovenaan ---
    if (hudLevel == 'FULL') {
        drawTopHeadingScale(o, renderer, hdg, navUnit, w, h);
    }

    // --- Speed + Altitude boxed readouts (meer naar binnen) ---
    drawSpeedBox(o, kias, w, h);
    drawAltitudeBox(o, alt, w, h);

    // --- Readouts links/rechts rond de boxes ---
    if (hudLevel !== 'MIN') {
        drawLeftReadouts(o, mach, currentG, aoa, maxG, autopilot, w, h);
      drawRightReadouts(o, vsi, radioAlt, trimDisplay, navUnit, w, h, wpnHudStatus);
    }

    // --- Attitude-symbologie (pitch ladder, boresight, FPV, AoA) ---
    if (camera && ac?.htr) {
      const cx = w / 2;
      const cy = h / 2;
      const clipCy = cy;

      const { pixelsPerDeg, pixelsPerDegX, cameraOffsetPx } = computeHudGeometry(w, h);
      const symbolCy = cy - cameraOffsetPx;

      updateFpvState(ac.llaLocation, ac);
      if (hudLevel == 'FULL') {
         drawBoresight(o, cx, symbolCy, pixelsPerDeg, w, h);
      }
      drawPitchLadder(o, camera, ac, cx, clipCy, symbolCy, pixelsPerDeg, w, h);

      const fpvPos = computeFpvScreenPosition(camera, cx, symbolCy, pixelsPerDeg, pixelsPerDegX);
      const fpvDrawn = drawFpv(o, fpvPos, cx, clipCy, w, h);
      if (hudLevel !== 'MIN') {
        drawIlsDeviationCues(o, fpvDrawn, w, h);
      }
      const isGearDown = window.controls?.gear?.position < 0.5;
      drawAoaBracket(o, fpvDrawn, cx, clipCy, pixelsPerDeg, w, h, aoa, isGearDown);
    }

    if (isWpnFireFlashVisible()) {
      o.save();
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.fillStyle = currentHudColor;
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.font = `${Math.round(h * 0.15)}px monospace`;
      o.fillText(getWpnActionFlashLabel(), w * 0.5, h * 0.52);
      o.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Class-based plugin structuur
  // ---------------------------------------------------------------------------

  class F18HudModule {
    constructor() {
      this.originalRenderer = null;
      this.installed = false;
    }

    install() {
      if (this.installed) {
        return true;
      }

      const renderers = window.instruments?.renderers;
      if (!renderers?.genericHUD) {
        return false;
      }

      this.originalRenderer = renderers.genericHUD;
      const self = this;
      renderers.genericHUD = function (renderer) {
        if (!isF18Active()) {
          return self.originalRenderer.call(this, renderer);
        }
        renderF18Hud(renderer);
      };

      this.installed = true;
      return true;
    }

    ensureLoaded() {
      if (!this.install()) {
        return false;
      }
      return installCameraControls();
    }

    restore() {
      if (this.originalRenderer && window.instruments?.renderers) {
        window.instruments.renderers.genericHUD = this.originalRenderer;
      }
      this.originalRenderer = null;
      this.installed = false;

      if (window.__f18HudCameraControls) {
        window.__f18HudCameraControls.remove();
      }
    }
  }

  class F18MfdModule {
    constructor() {
      this.nodeClickHandlerInstalled = false;
      this.onNodeClickBound = this.onNodeClick.bind(this);
    }

    hasRequiredNodeClickHandlers() {
      const handlers = window.controls?.nodeClickHandlers;
      if (!handlers) return false;

      if (handlers[RIGHT_MFD_PART_NAME] !== this.onNodeClickBound) return false;
      if (handlers[RIGHT_MFD_PICK_NODE_NAME] !== this.onNodeClickBound) return false;

      for (let i = 0; i < RIGHT_MFD_TOP_BUTTON_COUNT; i++) {
        if (handlers[getRightMfdTopButtonNodeName(i)] !== this.onNodeClickBound) return false;
      }
      for (let i = 0; i < RIGHT_MFD_LEFT_BUTTON_COUNT; i++) {
        if (handlers[getRightMfdLeftButtonNodeName(i)] !== this.onNodeClickBound) return false;
      }
      for (let i = 0; i < RIGHT_MFD_RIGHT_BUTTON_COUNT; i++) {
        if (handlers[getRightMfdRightButtonNodeName(i)] !== this.onNodeClickBound) return false;
      }

      return true;
    }

    ensureLoaded() {
      if (!window.__f18MfdUiState) {
        window.__f18MfdUiState = new F18MfdUiState();
      }

      const ready = installRightMfdUsingGeoFsParts();
      if (!ready) {
        return false;
      }

      if (this.nodeClickHandlerInstalled && !this.hasRequiredNodeClickHandlers()) {
        this.nodeClickHandlerInstalled = false;
      }

      this.installNodeClickHandler();
      return true;
    }

    installNodeClickHandler() {
      const controlsApi = window.controls;
      if (!controlsApi?.addNodeClickHandler || this.nodeClickHandlerInstalled) {
        return;
      }

      controlsApi.addNodeClickHandler(RIGHT_MFD_PART_NAME, this.onNodeClickBound);
      controlsApi.addNodeClickHandler(RIGHT_MFD_PICK_NODE_NAME, this.onNodeClickBound);
      for (let i = 0; i < RIGHT_MFD_TOP_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(getRightMfdTopButtonNodeName(i), this.onNodeClickBound);
      }
      for (let i = 0; i < RIGHT_MFD_LEFT_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(getRightMfdLeftButtonNodeName(i), this.onNodeClickBound);
      }
      for (let i = 0; i < RIGHT_MFD_RIGHT_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(getRightMfdRightButtonNodeName(i), this.onNodeClickBound);
      }
      this.nodeClickHandlerInstalled = true;
    }

    removeNodeClickHandler() {
      const controlsApi = window.controls;
      if (!this.nodeClickHandlerInstalled || !controlsApi?.nodeClickHandlers) {
        return;
      }

      delete controlsApi.nodeClickHandlers[RIGHT_MFD_PART_NAME];
      delete controlsApi.nodeClickHandlers[RIGHT_MFD_PICK_NODE_NAME];
      for (let i = 0; i < RIGHT_MFD_TOP_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[getRightMfdTopButtonNodeName(i)];
      }
      for (let i = 0; i < RIGHT_MFD_LEFT_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[getRightMfdLeftButtonNodeName(i)];
      }
      for (let i = 0; i < RIGHT_MFD_RIGHT_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[getRightMfdRightButtonNodeName(i)];
      }
      this.nodeClickHandlerInstalled = false;
    }

    // Projects a single corner of the MFD part to screen space.
    // cornerLocal: [x, y, z] in the part's own local frame (unscaled).
    // partObj: the Object3D of the MFD part.
    // Returns { x, y } in screen pixels (y=0 at top), or null if not on screen.
    projectMfdCorner(cornerLocal, partObj, aircraftLla) {
      // partObj.worldPosition is the part centre in aircraft-root-local XYZ (metres, ENU-ish).
      // It is computed by GeoFS's compute() WITHOUT multiplying by the part's own scale,
      // so it correctly represents the physical position of the part.
      //
      // partObj._scale is the part's own scale ([0.28, 0.28, 0.28] for our MFD part).
      // We scale the local corner by this and rotate it by partObj.worldRotation,
      // then add to partObj.worldPosition to get the corner in aircraft-root-local XYZ.
      //
      // This avoids the bug in setVectorWorldPosition(_points[n]) which multiplies the
      // entire accumulated worldPosition by worldScale, pushing corners behind the camera.

      const partPos = partObj.worldPosition;
      const partRot = partObj.worldRotation;
      const sx = partObj._scale?.[0] ?? 1;
      const sy = partObj._scale?.[1] ?? 1;
      const sz = partObj._scale?.[2] ?? 1;
      if (!partPos || !partRot) return null;

      const scaled = [cornerLocal[0] * sx, cornerLocal[1] * sy, cornerLocal[2] * sz];
      const rotated = (typeof M33 !== 'undefined') ? M33.transform(partRot, scaled) : scaled;
      const cornerWorld = [partPos[0] + rotated[0], partPos[1] + rotated[1], partPos[2] + rotated[2]];

      const xyzToLla = window.geofs?.api?.xyz2lla;
      const projector = window.geofs?.api?.getScreenCoordFromLla;
      if (!xyzToLla || !projector) return null;

      const delta = xyzToLla(cornerWorld, aircraftLla);
      if (!delta) return null;
      const absLla = [aircraftLla[0] + delta[0], aircraftLla[1] + delta[1], aircraftLla[2] + delta[2]];

      const screen = projector(absLla);
      if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;

      return { x: screen.x, y: screen.y };
    }

    getProjectedMfdBounds() {
      const aircraft = window.geofs?.aircraft?.instance;
      const part = aircraft?.parts?.[RIGHT_MFD_PART_NAME];
      const partObj = part?.object3d;
      const aircraftLla = aircraft?.llaLocation;
      if (!partObj || !aircraftLla) return null;

      const halfW = RIGHT_MFD_CLICK_HALF_WIDTH;
      const halfH = RIGHT_MFD_CLICK_HALF_HEIGHT;
      const localCorners = [
        [-halfW, 0,  halfH],  // topLeft
        [ halfW, 0,  halfH],  // topRight
        [-halfW, 0, -halfH],  // bottomLeft
        [ halfW, 0, -halfH],  // bottomRight
      ];

      const projected = localCorners.map(c => this.projectMfdCorner(c, partObj, aircraftLla));
      if (projected.some(p => p === null)) return null;

      const [topLeft, topRight, bottomLeft, bottomRight] = projected;

      const xs = projected.map(p => p.x);
      const ys = projected.map(p => p.y);
      const left   = Math.min(...xs);
      const right  = Math.max(...xs);
      const top    = Math.min(...ys);
      const bottom = Math.max(...ys);

      if (!Number.isFinite(left) || !Number.isFinite(right) ||
          !Number.isFinite(top)  || !Number.isFinite(bottom)) return null;

      return {
        left,
        top,
        width: right - left,
        height: bottom - top,
        corners: { topLeft, topRight, bottomLeft, bottomRight }
      };
    }

    pointInTriangle(p, a, b, c) {
      const area = (u, v, w) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y);
      const s1 = area(p, a, b);
      const s2 = area(p, b, c);
      const s3 = area(p, c, a);
      const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
      const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
      return !(hasNeg && hasPos);
    }

    pointInProjectedQuad(x, y, corners) {
      const p = { x, y };
      const { topLeft, topRight, bottomLeft, bottomRight } = corners;
      return this.pointInTriangle(p, topLeft, topRight, bottomRight)
        || this.pointInTriangle(p, topLeft, bottomRight, bottomLeft);
    }

    mapScreenToLocalBilinear(x, y, corners, bounds) {
      const p00 = corners.topLeft;
      const p10 = corners.topRight;
      const p01 = corners.bottomLeft;
      const p11 = corners.bottomRight;

      let u = bounds.width > 0 ? (x - bounds.left) / bounds.width : 0.5;
      let v = bounds.height > 0 ? (y - bounds.top) / bounds.height : 0.5;

      u = Math.max(0, Math.min(1, u));
      v = Math.max(0, Math.min(1, v));

      const ax = p10.x - p00.x;
      const ay = p10.y - p00.y;
      const bx = p01.x - p00.x;
      const by = p01.y - p00.y;
      const cx = p11.x - p10.x - p01.x + p00.x;
      const cy = p11.y - p10.y - p01.y + p00.y;

      for (let i = 0; i < 8; i++) {
        const fx = p00.x + ax * u + bx * v + cx * u * v - x;
        const fy = p00.y + ay * u + by * v + cy * u * v - y;

        const dfxdu = ax + cx * v;
        const dfxdv = bx + cx * u;
        const dfydu = ay + cy * v;
        const dfydv = by + cy * u;

        const det = dfxdu * dfydv - dfxdv * dfydu;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-9) {
          break;
        }

        const du = (-fx * dfydv + fy * dfxdv) / det;
        const dv = (fx * dfydu - fy * dfxdu) / det;

        u += du;
        v += dv;

        if (Math.abs(du) + Math.abs(dv) < 1e-6) {
          break;
        }
      }

      if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
      return { u, v };
    }

    getClickScreenCoords() {
      const mouse = window.controls?.mouse;
      if (!mouse) return null;

      const rawX = mouse.lastX ?? mouse.originalX;
      const rawY = mouse.lastY ?? mouse.originalY;
      const oX = mouse.oX ?? 0;
      const oY = mouse.oY ?? 0;
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;

      return {
        x: rawX - oX,
        y: rawY - oY
      };
    }

    getTopButtonIndexFromScreenCoords(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;

      const aircraft = window.geofs?.aircraft?.instance;
      const aircraftLla = aircraft?.llaLocation;
      if (!aircraft || !aircraftLla) return -1;

      const halfW = RIGHT_MFD_CLICK_HALF_WIDTH * RIGHT_MFD_TOP_BUTTON_VISUAL_SCALE;
      const halfH = RIGHT_MFD_CLICK_HALF_HEIGHT * RIGHT_MFD_TOP_BUTTON_VISUAL_SCALE;
      const localCorners = [
        [-halfW, 0, halfH],
        [halfW, 0, halfH],
        [-halfW, 0, -halfH],
        [halfW, 0, -halfH]
      ];

      for (let i = 0; i < RIGHT_MFD_TOP_BUTTON_COUNT; i++) {
        const partName = getRightMfdTopButtonPartName(i);
        const partObj = aircraft.parts?.[partName]?.object3d;
        if (!partObj) continue;

        const projected = localCorners.map((corner) => this.projectMfdCorner(corner, partObj, aircraftLla));
        if (projected.some((p) => p === null)) continue;

        const [topLeft, topRight, bottomLeft, bottomRight] = projected;
        const inside = this.pointInProjectedQuad(x, y, { topLeft, topRight, bottomLeft, bottomRight });
        if (inside) {
          return i;
        }
      }

      return -1;
    }

    getLeftButtonIndexFromScreenCoords(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;

      const aircraft = window.geofs?.aircraft?.instance;
      const aircraftLla = aircraft?.llaLocation;
      if (!aircraft || !aircraftLla) return -1;

      const halfW = RIGHT_MFD_CLICK_HALF_WIDTH * RIGHT_MFD_TOP_BUTTON_VISUAL_SCALE;
      const halfH = RIGHT_MFD_CLICK_HALF_HEIGHT * RIGHT_MFD_TOP_BUTTON_VISUAL_SCALE;
      const localCorners = [
        [-halfW, 0, halfH],
        [halfW, 0, halfH],
        [-halfW, 0, -halfH],
        [halfW, 0, -halfH]
      ];

      for (let i = 0; i < RIGHT_MFD_LEFT_BUTTON_COUNT; i++) {
        const partName = getRightMfdLeftButtonPartName(i);
        const partObj = aircraft.parts?.[partName]?.object3d;
        if (!partObj) continue;

        const projected = localCorners.map((corner) => this.projectMfdCorner(corner, partObj, aircraftLla));
        if (projected.some((p) => p === null)) continue;

        const [topLeft, topRight, bottomLeft, bottomRight] = projected;
        const inside = this.pointInProjectedQuad(x, y, { topLeft, topRight, bottomLeft, bottomRight });
        if (inside) {
          return i;
        }
      }

      return -1;
    }

    getRightButtonIndexFromScreenCoords(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;

      const aircraft = window.geofs?.aircraft?.instance;
      const aircraftLla = aircraft?.llaLocation;
      if (!aircraft || !aircraftLla) return -1;

      const halfW = RIGHT_MFD_CLICK_HALF_WIDTH * RIGHT_MFD_TOP_BUTTON_VISUAL_SCALE;
      const halfH = RIGHT_MFD_CLICK_HALF_HEIGHT * RIGHT_MFD_TOP_BUTTON_VISUAL_SCALE;
      const localCorners = [
        [-halfW, 0, halfH],
        [halfW, 0, halfH],
        [-halfW, 0, -halfH],
        [halfW, 0, -halfH]
      ];

      for (let i = 0; i < RIGHT_MFD_RIGHT_BUTTON_COUNT; i++) {
        const partName = getRightMfdRightButtonPartName(i);
        const partObj = aircraft.parts?.[partName]?.object3d;
        if (!partObj) continue;

        const projected = localCorners.map((corner) => this.projectMfdCorner(corner, partObj, aircraftLla));
        if (projected.some((p) => p === null)) continue;

        const [topLeft, topRight, bottomLeft, bottomRight] = projected;
        const inside = this.pointInProjectedQuad(x, y, { topLeft, topRight, bottomLeft, bottomRight });
        if (inside) {
          return i;
        }
      }

      return -1;
    }

    onNodeClick(nodeName) {
      if (!isF18Active()) {
        return;
      }
      if (window.geofs?.camera?.currentModeName !== 'cockpit') {
        return;
      }

      const topButtonIndex = (() => {
        for (let i = 0; i < RIGHT_MFD_TOP_BUTTON_COUNT; i++) {
          if (nodeName === getRightMfdTopButtonNodeName(i)) return i;
        }
        return -1;
      })();

      if (topButtonIndex >= 0) {
        const uiState = window.__f18MfdUiState;
        uiState?.setPage?.(topButtonIndex);
        return;
      }

      const leftButtonIndex = (() => {
        for (let i = 0; i < RIGHT_MFD_LEFT_BUTTON_COUNT; i++) {
          if (nodeName === getRightMfdLeftButtonNodeName(i)) return i;
        }
        return -1;
      })();

      if (leftButtonIndex >= 0) {
        const uiState = window.__f18MfdUiState;
        uiState?.toggleButtonBySlot?.('left', leftButtonIndex);
        return;
      }

      const rightButtonIndex = (() => {
        for (let i = 0; i < RIGHT_MFD_RIGHT_BUTTON_COUNT; i++) {
          if (nodeName === getRightMfdRightButtonNodeName(i)) return i;
        }
        return -1;
      })();

      if (rightButtonIndex >= 0) {
        const uiState = window.__f18MfdUiState;
        uiState?.toggleButtonBySlot?.('right', rightButtonIndex);
        return;
      }

      if (nodeName === RIGHT_MFD_PICK_NODE_NAME) {
        const click = this.getClickScreenCoords();
        const pickedTopButtonIndex = this.getTopButtonIndexFromScreenCoords(click?.x, click?.y);
        if (pickedTopButtonIndex >= 0) {
          const uiState = window.__f18MfdUiState;
          uiState?.setPage?.(pickedTopButtonIndex);
          return;
        }

        const pickedLeftButtonIndex = this.getLeftButtonIndexFromScreenCoords(click?.x, click?.y);
        if (pickedLeftButtonIndex >= 0) {
          const uiState = window.__f18MfdUiState;
          uiState?.toggleButtonBySlot?.('left', pickedLeftButtonIndex);
          return;
        }

        const pickedRightButtonIndex = this.getRightButtonIndexFromScreenCoords(click?.x, click?.y);
        if (pickedRightButtonIndex >= 0) {
          const uiState = window.__f18MfdUiState;
          uiState?.toggleButtonBySlot?.('right', pickedRightButtonIndex);
          return;
        }
      }

      if (nodeName !== RIGHT_MFD_PART_NAME && nodeName !== RIGHT_MFD_PICK_NODE_NAME) {
        return;
      }

      const uiState = window.__f18MfdUiState;
      uiState?.nextPage?.();
    }

    restore() {
      this.removeNodeClickHandler();
      if (window.__f18RightMfdPart) {
        window.__f18RightMfdPart.remove();
      }
      delete window.__f18MfdUiState;
    }
  }

  class F18MainPlugin {
    constructor() {
      this.hudModule = new F18HudModule();
      this.mfdModule = new F18MfdModule();
      this.timer = null;
      this.cameraWatchTimer = null;
      this.cameraWatchTicks = 0;
      this.lastMfdRecoveryTick = -999;
    }

    startCameraWatch() {
      if (this.cameraWatchTimer) {
        return;
      }

      this.cameraWatchTimer = setInterval(() => {
        this.cameraWatchTicks += 1;
        const mode = window.geofs?.camera?.currentModeName;
        const aircraft = window.geofs?.aircraft?.instance;
        const hasMfdRef = Boolean(window.__f18RightMfdPart);
        const hasMfdPart = Boolean(aircraft?.parts?.[RIGHT_MFD_PART_NAME]);

        if (mode === 'cockpit' && !hasMfdPart && (this.cameraWatchTicks - this.lastMfdRecoveryTick) >= 4) {
          this.lastMfdRecoveryTick = this.cameraWatchTicks;

          if (hasMfdRef) {
            delete window.__f18RightMfdPart;
          }

          this.mfdModule.ensureLoaded();
        }
      }, 250);
    }

    stopCameraWatch() {
      if (!this.cameraWatchTimer) {
        return;
      }
      clearInterval(this.cameraWatchTimer);
      this.cameraWatchTimer = null;
    }

    tryInstall() {
      const hudReady = this.hudModule.ensureLoaded();
      const mfdReady = this.mfdModule.ensureLoaded();
      return Boolean(hudReady && mfdReady);
    }

    start() {
      if (this.timer) {
        return;
      }
      this.startCameraWatch();

      this.timer = setInterval(() => {
        if (this.tryInstall()) {
          clearInterval(this.timer);
          this.timer = null;
        }
      }, 400);
    }

    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      stopWpnGunFireTimer();
      this.stopCameraWatch();
      this.mfdModule.restore();
      this.hudModule.restore();
    }
  }

  if (window.__f18MainPlugin?.stop) {
    window.__f18MainPlugin.stop();
  }

  window.__f18MainPlugin = new F18MainPlugin();
  window.__f18MainPlugin.start();
})();
