// ==UserScript==
// @name         GeoFS F-18 Addon
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      1.7.0
// @description  Improves the cockpit with a new HUD and custom MFDs, adjustable seat height and more.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @match        https://*.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.7.0';
  const F18_AIRCRAFT_ID = '27';

  const FLIGHT_RECORDER_MIN_VERSION = '1.2.0';
  const RAD_TO_DEG = 180 / Math.PI;
  const CAMERA_TO_HUD_DISTANCE_M = 0.92;
  const F18_OPTIONS_STORAGE_KEY = 'F18Options';
  const F18_WPN_STATE_STORAGE_KEY = 'F18WpnState';
  const DEFAULT_COLOR = '#00ff00';
  let currentHudColor = DEFAULT_COLOR;
  const addonRuntime = {
    checklistModule: null,
    mapModule: null,
    navModule: null,
    communicationModule: null,
    mfdUiStates: Object.create(null),
    mfdPagesCatalog: null,
    mfdRuntimeRefs: Object.create(null),
    mainPlugin: null
  };

  class F18MainPlugin {
    // Creates and wires all runtime modules used by the addon.
    constructor() {
      this.helperModule = new HelperModule();
      this.hudModule = new F18HudModule();
      this.cameraModule = new CameraModule(this.helperModule);
      this.fmcModule = new FMCModule();
      this.controlModule = new ControlModule(this.helperModule);
      this.mapModule = new MapModule();
      addonRuntime.mapModule = this.mapModule;
      this.navModule = new NavModule();
      addonRuntime.navModule = this.navModule;
      this.communicationModule = new CommunicationModule();
      addonRuntime.communicationModule = this.communicationModule;
      this.mfdModules = [];
      this.mfdPickNodeHandlerInstalled = false;
      this.onMfdPickNodeClickBound = this.onMfdPickNodeClick.bind(this);
      this.runNodeBridgeInstalled = false;
      this.originalRunNodeClickHandlers = null;
      this.timer = null;
      this.cameraWatchTimer = null;
      this.cameraWatchTicks = 0;
      this.lastMfdRecoveryTick = -999;

      this.addMfd({
        name: 'LEFT',
        position: [-0.2160, 6.158, 0.584],
        rotation: [8, 0, 0],
        scale: [0.29, 0.29, 0.285],
        defaultPageTitle: 'NAV'
      });

      this.addMfd({
        name: 'RIGHT',
        position: [0.2167, 6.158, 0.584],
        rotation: [8, 0, 0],
        scale: [0.29, 0.29, 0.285],
        defaultPageTitle: 'SYS'
      });

      this.addMfd({
        name: 'CENTER',
        position: [-0.003, 6.085, 0.335],
        rotation: [23.5, 0, 0],
        scale: [0.335, 0.335, 0.335],
        defaultPageTitle: 'CHK'
      });
    }

    // Adds a new MFD module instance to the active plugin.
    addMfd(config) {
      const module = new MfdModule(config);
      this.mfdModules.push(module);
      return module;
    }

    // Resolves the MFD instance closest to a screen click position.
    getMfdAtScreenPoint(x, y) {
      let targetModule = null;
      let bestScore = Infinity;

      for (const mfdModule of this.mfdModules) {
        const score = mfdModule.getPickScore(x, y);
        if (score < bestScore) {
          bestScore = score;
          targetModule = mfdModule;
        }
      }

      return Number.isFinite(bestScore) ? targetModule : null;
    }

    // Routes pick-node clicks to the correct MFD interaction handler.
    onMfdPickNodeClick(nodeName) {
      if (nodeName !== 'glassPanel') {
        for (const mfdModule of this.mfdModules) {
          if (mfdModule.onNodeClick(nodeName)) {
            return;
          }
        }
        return;
      }

      const click = this.helperModule.getClickScreenCoords();
      if (!click) return;

      const targetModule = this.getMfdAtScreenPoint(click.x, click.y);
      targetModule?.handlePickClick(click);
    }

    // Installs the global glassPanel click handler used by MFD picking.
    ensureGlobalMfdPickNodeHandler() {
      const controlsApi = window.controls;
      if (!controlsApi?.addNodeClickHandler) return false;
      controlsApi.addNodeClickHandler('glassPanel', this.onMfdPickNodeClickBound);
      this.mfdPickNodeHandlerInstalled = true;
      return true;
    }

    // Wraps GeoFS node click dispatch so MFD fallback picking remains active.
    ensureRunNodeClickBridge() {
      const controlsApi = window.controls;
      if (!controlsApi?.runNodeClickHandlers) return false;
      if (this.runNodeBridgeInstalled) return true;

      this.originalRunNodeClickHandlers = controlsApi.runNodeClickHandlers.bind(controlsApi);
      controlsApi.runNodeClickHandlers = (nodeName) => {
        this.originalRunNodeClickHandlers?.(nodeName);

        // Fallback only: avoid double-processing nodes that already have a direct handler.
        if (controlsApi?.nodeClickHandlers?.[nodeName]) {
          return;
        }

        this.onMfdPickNodeClick(nodeName);
      };

      this.runNodeBridgeInstalled = true;
      return true;
    }

    removeGlobalMfdPickNodeHandler() {
      const controlsApi = window.controls;
      if (!this.mfdPickNodeHandlerInstalled || !controlsApi?.nodeClickHandlers) return;
      delete controlsApi.nodeClickHandlers.glassPanel;
      this.mfdPickNodeHandlerInstalled = false;
    }

    removeRunNodeClickBridge() {
      const controlsApi = window.controls;
      if (!this.runNodeBridgeInstalled || !controlsApi) return;
      if (this.originalRunNodeClickHandlers) {
        controlsApi.runNodeClickHandlers = this.originalRunNodeClickHandlers;
      }
      this.originalRunNodeClickHandlers = null;
      this.runNodeBridgeInstalled = false;
    }

    startCameraWatch() {
      if (this.cameraWatchTimer) {
        return;
      }

      this.cameraWatchTimer = setInterval(() => {
        this.cameraWatchTicks += 1;

        // Self-heal camera modes when GeoFS reinitializes camera definitions
        // after aircraft/model loading has completed.
        this.cameraModule.ensureLoaded();

        const mode = window.geofs?.camera?.currentModeName;
        const aircraft = window.geofs?.aircraft?.instance;
        for (const mfdModule of this.mfdModules) {
          const hasMfdRef = Boolean(addonRuntime.mfdRuntimeRefs[mfdModule.slotName]);
          const hasMfdPart = Boolean(aircraft?.parts?.[mfdModule.partName]);

          if (mode === 'cockpit' && !hasMfdPart && (this.cameraWatchTicks - this.lastMfdRecoveryTick) >= 4) {
            this.lastMfdRecoveryTick = this.cameraWatchTicks;

            if (hasMfdRef) {
              delete addonRuntime.mfdRuntimeRefs[mfdModule.slotName];
            }

            mfdModule.ensureLoaded();
          }
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
      const cameraReady = this.cameraModule.ensureLoaded();
      const fmcReady = this.fmcModule.ensureLoaded();
      const controlsReady = this.controlModule.ensureLoaded();
      const communicationReady = this.communicationModule.ensureLoaded();
      const mfdReady = this.mfdModules.every((mfdModule) => mfdModule.ensureLoaded());
      const pickNodeReady = this.ensureGlobalMfdPickNodeHandler();
      const nodeBridgeReady = this.ensureRunNodeClickBridge();
      return Boolean(hudReady && cameraReady && fmcReady && controlsReady && communicationReady && mfdReady && pickNodeReady && nodeBridgeReady);
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
      this.removeGlobalMfdPickNodeHandler();
      this.removeRunNodeClickBridge();
      this.mfdModules.forEach((mfdModule) => mfdModule.restore());
      this.communicationModule.restore();
      this.controlModule.restore();
      this.fmcModule.restore();
      this.cameraModule.restore();
      this.hudModule.restore();
    }
  }

  class WeaponModule {
    static LOADOUT_BY_CONFIG = {
    'A/A': {
        gun: 412,
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
        gun: 412,
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
        gun: 412,
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
        gun: 412,
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
        gun: 412,
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
    };

    static STATION_RENDER_ORDER = [
      { side: 'center', station: 'gun' },
      { side: 'left', station: 'wingtip' },
      { side: 'left', station: 'hardpoint1' },
      { side: 'left', station: 'hardpoint2' },
      { side: 'right', station: 'hardpoint2' },
      { side: 'right', station: 'hardpoint1' },
      { side: 'right', station: 'wingtip' }
    ];

    static FIRE_BLINK_INTERVAL_MS = 500;
    static FIRE_BLINK_PHASES = 4;
    static GUN_FIRE_RATE_RPS = 66;
    static GUN_ROUNDS_PER_BURST = 100;
    static GUN_FIRE_TICK_MS = Math.max(1, Math.round(1000 / WeaponModule.GUN_FIRE_RATE_RPS));
    static REARM_DURATION_MS = 60_000;
  }

  const wpnSelectedWeaponByMode = {};
  const wpnLoadoutTemplates = JSON.parse(JSON.stringify(WeaponModule.LOADOUT_BY_CONFIG));
  let wpnCurrentLoadout = JSON.parse(JSON.stringify(
    wpnLoadoutTemplates?.['A/A']
    ?? Object.values(wpnLoadoutTemplates ?? {})[0]
    ?? {}
  ));
  const wpnRearmState = {
    active: false,
    startTime: 0,
    progress: 0,
    durationMs: WeaponModule.REARM_DURATION_MS,
    config: 'A/A',
    status: 'IDLE',
    lastSavedPercent: -1
  };

  const wpnGunFireState = {
    timerId: null,
    mode: null,
    roundsRemainingInBurst: 0
  };

  function parseSemver(version) {
    const [major, minor, patch] = version.split('.').map(Number);
    return {
      major,
      minor,
      patch
    };
  }

  function isSemverAtLeast(version, minimumVersion) {
    const a = parseSemver(version);
    const b = parseSemver(minimumVersion);
    if (a.major !== b.major) return a.major > b.major;
    if (a.minor !== b.minor) return a.minor > b.minor;
    return a.patch >= b.patch;
  }

  function isFlightRecorderCompatible() {
    return isSemverAtLeast(window.FlightRecorder?.api.getVersion() ?? '0.0.0', FLIGHT_RECORDER_MIN_VERSION);
  }

  function getFlightRecorderMfdStatus() {
    const installed = Boolean(window.FlightRecorder?.api);
    const version = window.FlightRecorder?.api.getVersion();
    const compatible = isFlightRecorderCompatible();
    if (!installed || !compatible) {
      return {
        installed,
        compatible: false,
        version,
        recordingState: 'OFF',
        playbackState: 'STOPPED',
        message: 'Install Flight Recorder v1.2.0 or higher'
      };
    }

    return {
      installed,
      compatible: true,
      version,
      recordingState: window.FlightRecorder?.api.recording.getState().state,
      playbackState: window.FlightRecorder?.api.playback.getState().state,
      message: ''
    };
  }

  function toggleFlightRecorderRecordingFromMfd() {
    if (!isFlightRecorderCompatible()) return false;

    const currentState = window.FlightRecorder?.api.recording.getState().state;
    if (currentState === 'RECORDING') {
      window.FlightRecorder?.api.recording.stop();
    } else {
      window.FlightRecorder?.api.recording.start();
    }
    return true;
  }

  function controlFlightRecorderPlaybackFromMfd(action) {
    if (!isFlightRecorderCompatible()) return false;

    if (action === 'START') {
      window.FlightRecorder?.api.playback.start();
      return true;
    }
    if (action === 'PAUSE') {
      window.FlightRecorder?.api.playback.pause();
      return true;
    }
    if (action === 'STOP') {
      window.FlightRecorder?.api.playback.stop();
      return true;
    }
    return false;
  }

  function deepCloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getWpnModeFromOptions() {
    const mode = getOption('WPN', 'MODE', 'NAV');
    if (mode === 'A/A') return 'A/A';
    if (mode === 'A/G') return 'A/G';
    if (mode === 'JETTISON') return 'JETTISON';
    return 'NAV';
  }

  function isModeCompatibleStation(mode, stationName, stationData) {
    if (mode === 'JETTISON') {
      return stationName !== 'gun';
    }
    if (stationName === 'gun') {
      return mode !== 'NAV';
    }
    if (mode === 'NAV') return false;
    const stationType = stationData.type;
    if (!stationType) return true;
    return stationType === mode;
  }

  function saveWpnStateToStorage() {
    const payload = {
      config: getOption('WPN', 'CONFIG', 'A/A'),
      loadout: wpnCurrentLoadout,
      selected: wpnSelectedWeaponByMode
    };
    window.localStorage.setItem(F18_WPN_STATE_STORAGE_KEY, JSON.stringify(payload));
  }

  function loadWpnStateFromStorage() {
    const raw = window.localStorage.getItem(F18_WPN_STATE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const storedLoadout = parsed.loadout;
    const baseTemplate = deepCloneJson(wpnLoadoutTemplates['A/A']);

    baseTemplate.gun = storedLoadout.gun;
    for (const sideKey of ['left', 'right']) {
      for (const stationKey of Object.keys(baseTemplate[sideKey])) {
        const stationTemplate = baseTemplate[sideKey][stationKey];
        const stationStored = storedLoadout[sideKey][stationKey];
        stationTemplate.quantity = stationStored.quantity;
        stationTemplate.load = stationStored.load;
        stationTemplate.display = stationStored.display;
        stationTemplate.type = stationStored.type;
      }
    }

    wpnCurrentLoadout = baseTemplate;

    const storedSelected = parsed.selected;
    for (const key of Object.keys(wpnSelectedWeaponByMode)) {
      delete wpnSelectedWeaponByMode[key];
    }
    for (const modeKey of Object.keys(storedSelected)) {
      const selected = storedSelected[modeKey];
      wpnSelectedWeaponByMode[modeKey] = {
        side: selected.side,
        station: selected.station
      };
    }

    wpnRearmState.config = parsed.config;
  }

  loadWpnStateFromStorage();

  function resolveWpnTemplateConfig(config) {
    if (wpnLoadoutTemplates[config]) return config;
    if (wpnLoadoutTemplates['A/A']) return 'A/A';
    const first = Object.keys(wpnLoadoutTemplates)[0];
    return first;
  }

  function getRearmTemplateByMode(config) {
    const resolvedConfig = resolveWpnTemplateConfig(config);
    const sourceTemplate = wpnLoadoutTemplates[resolvedConfig];
    if (!sourceTemplate) return null;

    return JSON.parse(JSON.stringify(sourceTemplate));
  }

  function zeroCurrentWpnLoadout() {
    if (!wpnCurrentLoadout) return;

    wpnCurrentLoadout.gun = 0;
    for (const sideKey of ['left', 'right']) {
      const sideStations = wpnCurrentLoadout[sideKey];
      for (const stationKey of Object.keys(sideStations)) {
        if (!Number.isFinite(sideStations[stationKey].quantity)) continue;
        sideStations[stationKey].quantity = 0;
      }
    }
  }

  function applyWpnRearmProgress(targetByMode, progress) {
    const p = Math.max(0, Math.min(1, progress));
    if (!wpnCurrentLoadout || !targetByMode) return;

    wpnCurrentLoadout.gun = Math.floor(targetByMode.gun * p);

    for (const sideKey of ['left', 'right']) {
      wpnCurrentLoadout[sideKey] = wpnCurrentLoadout[sideKey] ?? {};
      const targetSide = targetByMode[sideKey] ?? {};

      for (const stationKey of Object.keys(targetSide)) {
        const targetStation = targetSide[stationKey] ?? {};
        wpnCurrentLoadout[sideKey][stationKey] = wpnCurrentLoadout[sideKey][stationKey] ?? {};

        wpnCurrentLoadout[sideKey][stationKey].load = targetStation.load;
        wpnCurrentLoadout[sideKey][stationKey].display = targetStation.display;
        wpnCurrentLoadout[sideKey][stationKey].type = targetStation.type;

        const targetQuantity = Number.isFinite(targetStation.quantity) ? targetStation.quantity : 0;
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
    for (const modeKey of Object.keys(wpnSelectedWeaponByMode)) {
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
    const duration = Math.max(1, Number.isFinite(wpnRearmState.durationMs) ? wpnRearmState.durationMs : WeaponModule.REARM_DURATION_MS);
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
    const currentGun = modeLoadout.gun;

    if (currentGun <= 0) {
      stopWpnGunFireTimer();
      selectNextWpnWeapon(mode, modeLoadout, 0);
      saveWpnStateToStorage();
      return;
    }

    const updatedGun = currentGun - 1;
    modeLoadout.gun = updatedGun;

    wpnGunFireState.roundsRemainingInBurst -= 1;

    if (updatedGun <= 0) {
      stopWpnGunFireTimer();
      selectNextWpnWeapon(mode, modeLoadout, 0);
      saveWpnStateToStorage();
      return;
    }

    if (wpnGunFireState.roundsRemainingInBurst <= 0) {
      stopWpnGunFireTimer();
      saveWpnStateToStorage();
      return;
    }

    wpnGunFireState.timerId = setTimeout(processWpnGunFireTick, WeaponModule.GUN_FIRE_TICK_MS);
  }

  function ensureWpnGunFireTimerRunning() {
    if (wpnGunFireState.timerId) return;
    wpnGunFireState.timerId = setTimeout(processWpnGunFireTick, WeaponModule.GUN_FIRE_TICK_MS);
  }

  function startWpnGunFire(mode, modeLoadout) {
    if (!modeLoadout || !Number.isFinite(modeLoadout.gun) || modeLoadout.gun <= 0) {
      return false;
    }

    const wasIdle = !wpnGunFireState.timerId;

    wpnGunFireState.mode = mode;

    wpnGunFireState.roundsRemainingInBurst += WeaponModule.GUN_ROUNDS_PER_BURST;
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
    const totalDuration = WeaponModule.FIRE_BLINK_INTERVAL_MS * WeaponModule.FIRE_BLINK_PHASES;
    if (elapsed >= totalDuration) {
      wpnFireFlash.startTime = 0;
      wpnFireFlash.label = 'FIRE';
      return false;
    }

    const phase = Math.floor(elapsed / WeaponModule.FIRE_BLINK_INTERVAL_MS);
    return phase % 2 === 0;
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
      ? Math.max(0, WeaponModule.STATION_RENDER_ORDER.findIndex((s) => s.side === current.side && s.station === current.station))
      : -1;

    for (let step = 1; step <= WeaponModule.STATION_RENDER_ORDER.length; step++) {
      const index = (currentIndex + step) % WeaponModule.STATION_RENDER_ORDER.length;
      const candidate = WeaponModule.STATION_RENDER_ORDER[index];
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

    const selectedIndex = WeaponModule.STATION_RENDER_ORDER.findIndex((s) => s.side === selected.side && s.station === selected.station);
    if (selectedIndex < 0) return false;

    for (let step = 1; step <= WeaponModule.STATION_RENDER_ORDER.length; step++) {
      const index = (selectedIndex + step) % WeaponModule.STATION_RENDER_ORDER.length;
      const candidate = WeaponModule.STATION_RENDER_ORDER[index];
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

  const optionKeyCache = Object.create(null);
  let optionStoreCache = null;

  function getCachedOptionKey(pageTitle, buttonKey) {
    const pageToken = normalizeOptionToken(pageTitle);
    const buttonToken = normalizeOptionToken(buttonKey);
    const cacheId = `${pageToken}\u0000${buttonToken}`;
    let optionKey = optionKeyCache[cacheId];
    if (optionKey) return optionKey;

    optionKey = `${pageToken}.${buttonToken}`;
    optionKeyCache[cacheId] = optionKey;
    return optionKey;
  }

  function buildOptionKey(pageTitle, buttonKey) {
    return getCachedOptionKey(pageTitle, buttonKey);
  }

  function readOptions() {
    if (optionStoreCache) {
      return optionStoreCache;
    }

    const raw = window.localStorage.getItem(F18_OPTIONS_STORAGE_KEY);
    if (!raw) {
      optionStoreCache = {};
      return optionStoreCache;
    }

    optionStoreCache = JSON.parse(raw);
    return optionStoreCache;
  }

  function getOption(pageTitle, buttonKey, fallback = null) {
    const options = readOptions();
    const optionKey = buildOptionKey(pageTitle, buttonKey);
    return options[optionKey] ?? fallback;
  }

  function writeOptions(options) {
    const payload = options ?? {};
    optionStoreCache = payload;
    window.localStorage.setItem(F18_OPTIONS_STORAGE_KEY, JSON.stringify(payload));
    return true;
  }

  function setOption(pageTitle, buttonKey, value) {
      const options = readOptions();
      const optionKey = getCachedOptionKey(pageTitle, buttonKey);
      options[optionKey] = value;
      writeOptions(options);
  }

  function getOptionValue(pageTitle, buttonKey, fallback = null) {
    const selectedState = getOption(pageTitle, buttonKey, null);
    const pages = addonRuntime.mfdPagesCatalog
      ?? Object.values(addonRuntime.mfdUiStates)[0]?.pages;
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
      stateIndex = button.states.findIndex((s) => s === selectedState);
    }

    if (stateIndex < 0 && Number.isInteger(button.stateIndex)) {
      stateIndex = button.stateIndex;
    }

    if (stateIndex >= 0 && stateIndex < button.values.length) {
      return button.values[stateIndex];
    }

    return selectedState ?? fallback;
  }

  function getMfdBrightnessFactor() {
    const brightMode = getOption('HUD', 'BRIGHT', 'NORM');
    if (brightMode === 'DAY') return 1.0;
    if (brightMode === 'NIGHT') return 0.3;
    return 0.6; // NORM
  }

  function applyBrightnessToHexColor(color, factor) {
    const value = String(color ?? '').trim();
    const hex = value.startsWith('#') ? value.slice(1) : value;
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      return color;
    }

    const clampChannel = (channel) => Math.max(0, Math.min(255, Math.round(channel * factor)));
    const r = clampChannel(parseInt(hex.slice(0, 2), 16));
    const g = clampChannel(parseInt(hex.slice(2, 4), 16));
    const b = clampChannel(parseInt(hex.slice(4, 6), 16));

    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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

  // Maximum positieve G since script start.
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

  // Selects the next/previous flightplan waypoint relative to current selection.
  function stepSelectedFlightPlanWaypoint(step = 1) {
    const direction = Number(step) >= 0 ? 1 : -1;
    const flightPlan = window.geofs?.flightPlan;
    const waypointArray = flightPlan?.waypointArray;

    if (!Array.isArray(waypointArray) || waypointArray.length === 0) return;
    if (typeof flightPlan?.selectWaypoint !== 'function') return;

    const currentIndex = waypointArray.findIndex((waypoint) => waypoint?.selected === true);
    const baseIndex = currentIndex >= 0
      ? currentIndex
      : (direction > 0 ? -1 : 0);
    const nextIndex = (baseIndex + direction + waypointArray.length) % waypointArray.length;

    flightPlan.selectWaypoint(nextIndex);
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
    const baseZ = mode?.position?.[2] ?? CameraModule.DEFAULT_HUD_CAMERA_Z;
    const offsetZ = mode?.offsets?.current?.[2] ?? 0;
    return baseZ + offsetZ;
  }

  function adjustHudCameraZ(deltaZ) {
    const mode = window.geofs?.camera?.modes?.[1];
    if (!mode?.position) return;
    if (!Number.isFinite(mode.position[2])) {
      mode.position[2] = CameraModule.DEFAULT_HUD_CAMERA_Z;
    }
    mode.position[2] += deltaZ;
  }

  class HelperModule {
    // Creates helper state for runtime UI controls.
    constructor() {
      this.padControls = new Map();
    }

    // Returns normalized screen click coordinates from the GeoFS mouse state.
    static getClickScreenCoords() {
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

    // Returns normalized screen click coordinates from the current frame.
    getClickScreenCoords() {
      return HelperModule.getClickScreenCoords();
    }

    // Gets the main GeoFS pad container element.
    getPadsContainer() {
      return document.querySelector('.geofs-pads-container');
    }

    // Builds a styled control-pad button element.
    createPadButton(options) {
      const cfg = options ?? {};
      const label = String(cfg.label ?? 'BTN');
      const id = String(cfg.id ?? '');
      const onClick = typeof cfg.onClick === 'function' ? cfg.onClick : () => {};

      const outer = document.createElement('div');
      if (id) outer.id = id;
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

      if (cfg?.outerStyle && typeof cfg.outerStyle === 'object') {
        Object.assign(outer.style, cfg.outerStyle);
      }
      if (cfg?.innerStyle && typeof cfg.innerStyle === 'object') {
        Object.assign(inner.style, cfg.innerStyle);
      }

      outer.appendChild(inner);
      outer.addEventListener('click', onClick);
      return outer;
    }

    // Inserts or replaces a pad control element in the GeoFS UI.
    installPadControl(options) {
      const cfg = options ?? {};
      const id = String(cfg.id ?? '').trim();
      const element = cfg.element;
      const prepend = cfg.prepend !== false;

      if (!id || !element) return false;

      const padsContainer = this.getPadsContainer();
      if (!padsContainer) return false;

      this.removePadControl(id);

      if (prepend) {
        padsContainer.prepend(element);
      } else {
        padsContainer.appendChild(element);
      }

      this.padControls.set(id, element);
      return true;
    }

    // Removes a previously installed pad control by id.
    removePadControl(id) {
      const key = String(id ?? '').trim();
      if (!key) return;

      const element = this.padControls.get(key) ?? document.getElementById(key);
      if (element) {
        element.remove();
      }
      this.padControls.delete(key);
    }
  }

  class ChecklistModule {
    constructor() {
      this.types = ['PROC', 'EMER', 'OPS', 'FLP'];
      this.checklistsByType = Object.create(null);
      this.currentIndexByType = Object.create(null);

      for (const type of this.types) {
        this.checklistsByType[type] = [];
        this.currentIndexByType[type] = 0;
      }
    }

    getTypeList(type) {
      const list = this.checklistsByType[type];
      if (!Array.isArray(list)) {
        throw new Error(`Unsupported checklist type: ${type}`);
      }
      return list;
    }

    ensureItemStates(checklist) {
      const states = checklist.itemCompleted;
      if (!Array.isArray(states) || states.length !== checklist.items.length) {
        throw new Error('Checklist itemCompleted must be an array matching items length');
      }
      return states;
    }

    addChecklist(definition) {
      const type = definition.type;
      const list = this.getTypeList(type);

      const title = String(definition?.title ?? '').trim();
      if (!title) return false;

      const items = Array.isArray(definition?.items)
        ? definition.items.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [];

      const id = String(definition?.id ?? `${type}-${list.length + 1}`);
      const checklist = {
        id,
        type,
        title,
        items,
        itemCompleted: Array.isArray(definition?.itemCompleted)
          ? definition.itemCompleted.slice(0, items.length)
          : new Array(items.length).fill(false),
        completed: Boolean(definition?.completed)
      };

      this.ensureItemStates(checklist);
      if (checklist.completed && checklist.itemCompleted.length) {
        checklist.itemCompleted = checklist.itemCompleted.map(() => true);
      }

      list.push(checklist);

      const idx = this.currentIndexByType[type] ?? 0;
      this.currentIndexByType[type] = Math.max(0, Math.min(idx, list.length - 1));
      return true;
    }

    getChecklists(type) {
      return this.getTypeList(type);
    }

    getCurrentIndex(type) {
      const list = this.getChecklists(type);
      if (!list.length) return 0;
      const idx = Number(this.currentIndexByType[type]);
      if (!Number.isFinite(idx)) return 0;
      return Math.max(0, Math.min(list.length - 1, Math.floor(idx)));
    }

    setCurrentIndex(type, index) {
      const list = this.getChecklists(type);
      if (!list.length) {
        this.currentIndexByType[type] = 0;
        return 0;
      }
      const idx = Number(index);
      const clamped = Number.isFinite(idx)
        ? Math.max(0, Math.min(list.length - 1, Math.floor(idx)))
        : 0;
      this.currentIndexByType[type] = clamped;
      return clamped;
    }

    nextChecklist(type) {
      const list = this.getChecklists(type);
      if (!list.length) return null;
      const next = (this.getCurrentIndex(type) + 1) % list.length;
      this.currentIndexByType[type] = next;
      return list[next];
    }

    prevChecklist(type) {
      const list = this.getChecklists(type);
      if (!list.length) return null;
      const next = (this.getCurrentIndex(type) - 1 + list.length) % list.length;
      this.currentIndexByType[type] = next;
      return list[next];
    }

    getCurrentChecklist(type) {
      const list = this.getChecklists(type);
      if (!list.length) return null;
      return list[this.getCurrentIndex(type)] ?? null;
    }

    hasNextChecklist(type) {
      const list = this.getChecklists(type);
      if (!list.length) return false;
      return this.getCurrentIndex(type) < (list.length - 1);
    }

    nextChecklistNoWrap(type) {
      const list = this.getChecklists(type);
      if (!list.length) return null;

      const current = this.getCurrentIndex(type);
      if (current >= list.length - 1) {
        return list[current] ?? null;
      }

      const next = current + 1;
      this.currentIndexByType[type] = next;
      return list[next] ?? null;
    }

    setCurrentCompleted(type, completed) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return false;
      const nextCompleted = Boolean(completed);
      checklist.completed = nextCompleted;

      const states = this.ensureItemStates(checklist);
      for (let i = 0; i < states.length; i++) {
        states[i] = nextCompleted;
      }

      return true;
    }

    toggleCurrentCompleted(type) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return false;
      return this.setCurrentCompleted(type, !checklist.completed);
    }

    getCurrentItemCompleted(type) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return [];
      return this.ensureItemStates(checklist);
    }

    markNextCurrentItem(type) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return false;

      const states = this.ensureItemStates(checklist);
      const nextItemIndex = states.findIndex((value) => !value);
      if (nextItemIndex < 0) {
        if (states.length) {
          checklist.completed = true;
        }
        return false;
      }

      states[nextItemIndex] = true;
      checklist.completed = states.length > 0 && states.every(Boolean);
      return true;
    }

    resetCurrent(type) {
      return this.setCurrentCompleted(type, false);
    }

    resetType(type) {
      const list = this.getChecklists(type);
      for (const checklist of list) {
        checklist.completed = false;
        this.ensureItemStates(checklist).fill(false);
      }
      this.currentIndexByType[type] = 0;
      return true;
    }
  }

  function createDefaultChecklistModule() {
    const module = new ChecklistModule();
    module.addChecklist({
      type: 'PROC',
      title: 'Engine Start',
      items: ['Parking Brake ON', 'Flight Plan LOADED', 'Briefing CHECKED', 'Master Arm OFF', 'Radar OFF', 'Weapon Config SELECTED', 'Rearming FINISHED', 'Area CLEAR', 'Engine ON', 'Instruments CHECK'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Before Taxi',
      items: ['Ladder UP', 'Tailhook UP', 'Fuel Probe CLOSED', 'Wings LOCKED', 'Flaps MAN', 'Canopy AS DESIRED', 'Recording AS DESIRED', 'Taxi REQUESTED'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Taxi / Before Takeoff',
      items: ['Taxi Clearance GRANTED', 'Parking Brake OFF', 'Flaps ONE', 'HUD Bright/LVL AS DESIRED', 'Trim SET T/O', 'Canopy CLOSED', 'Spoiler UP', 'Brakes CHECK', 'Flight Controls CHECK', 'Instruments CHECK', 'Takeoff Clearance REQUESTED'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Takeoff',
      items: ['Takeoff Clearance GRANTED', 'Runway CLEAR', 'Runway ALIGNED', 'Flaps ONE CHECK','Brakes ON', 'Engine 30%', 'Brakes RELEASED', 'Engine 100%', 'Speed 175 KN', 'Climb POSITIVE', 'Gear UP'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Climb',
      items: ['Flaps AUTO', 'Attitude SET', 'Trim SET', 'Radar AS DESIRED'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Cruise',
      items: ['Altitude AS BRIEFED', 'Speed AS BRIEFED', 'Trim SET', 'HUD Brightness AS DESIRED', 'HUD Level AS DESIRED'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Descent',
      items: ['Trim SET'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Before landing',
      items: ['Master Arm OFF', 'TODO'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Landing',
      items: ['TODO'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Taxi',
      items: ['TODO'],
      completed: false
    });
    module.addChecklist({
      type: 'PROC',
      title: 'Shutdown',
      items: ['TODO'],
      completed: false
    });
    module.addChecklist({
      type: 'EMER',
      title: 'Engine Fire',
      items: ['Throttle IDLE', 'Engine OFF', 'Divert NEAREST', 'Descent GLIDE', 'Airspeed SET OPTIMAL', 'Radio MAYDAY', 'Land ASAP'],
      completed: false
    });
    module.addChecklist({
      type: 'OPS',
      title: 'IFF Codebook',
      items: ['Say \'IFF [CS] - Code [NO.]\'', 'Respond with \'IFF [Code]\'', '┌─────────────────────┐', '│  01: 457 │  02: 701 │ ', '│  03: 337 │  04: 241 │ ', '│  05: 612 │  06: 135 │ ', '│  07: 402 │  08: 984 │ ', '│  09: 264 │  10: 753 │ ', '│  11: 755 │  12: 588 │ ', '│  13: 284 │  14: 000 │ ',, '└─────────────────────┘'],
      completed: false
    });
    module.addChecklist({
      type: 'OPS',
      title: 'Targeting Pod - A/G',
      items: ['Flightplan OPEN', 'Target MARK AS WAYPOINT', 'Entry INGRESS FROM SOUTH', 'Heading 0°', 'Flightplan SELECT TARGET WP', 'MFD SWITCH TO TGP', 'MODE/FREQ AS DESIRED', 'FOV WIDE', 'View ADJUST', 'FOV NARROW'],
      completed: false
    });
    module.addChecklist({
      type: 'OPS',
      title: 'Targeting Pod - A/A',
      items: ['MFD SWITCH TO RDR', 'Radar ON', 'Foo AS DESIRED', 'MFD SWITCH TO NAV', 'A/C SELECT', 'MFD SWITCH TO TGP', 'Entry INGRESS FROM SOUTH', 'Heading 0°', 'Lock SET TO TRK', 'MODE / FOV AS DESIRED'],
      completed: false
    });
    module.addChecklist({
      type: 'OPS',
      title: 'Formation (Re)join',
      items: ['Lock TARGET', 'Closure > 1 nm - +60knots', 'Closure 6000 ft - 60 knots', 'Closure 2000 ft - 40 knots', 'Closure 500 ft - 20 knots', 'Visual Contact', 'Take position'],
      completed: false
    });
    module.addChecklist({
      type: 'OPS',
      title: 'Overhead Break (Landing)',
      items: ['TODO'],
      completed: false
    });
    module.addChecklist({
      type: 'FLP',
      title: 'Briefing - Flight',
      items: ['Flight Callsign BA', 'Start Time 1300Z', 'Start Taxi 1305Z', 'Start T/O 1310Z', 'End Time 1400Z'],
      completed: false
    });
    module.addChecklist({
      type: 'FLP',
      title: 'Briefing - Positions',
      items: ['#1 - BigE', '#2 - Natrium', '#3 - Merpati', '#4 - Sonic'],
      completed: false
    });
    module.addChecklist({
      type: 'FLP',
      title: 'Briefing - Enroute',
      items: ['ALT FL10', 'SPD 300 knots', 'Route as planned'],
      completed: false
    });
    module.addChecklist({
      type: 'FLP',
      title: 'Briefing - Landing',
      items: ['Primary KNPA', 'Alternate KPNS', 'Runway 25L', 'Pattern OVERHEAD BREAK', 'Formation DELTA', 'ALT Entry 200ft', 'SPD Entry 300 kn', 'Pitch int. 3s', 'Downwind 200 kn'],
      completed: false
    });
    return module;
  }

  function getChecklistModule() {
    if (!addonRuntime.checklistModule) {
      addonRuntime.checklistModule = createDefaultChecklistModule();
    }
    return addonRuntime.checklistModule;
  }

  class NavModule {
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
      return getOptionValue('RDR', 'FOO', 'SHOW');
    }

    // Returns true when contacts with callsign FOO should be hidden.
    shouldHideFooContacts() {
      return this.getFooVisibilityMode() === 'HIDE';
    }

    // Returns true when a callsign equals FOO (case-insensitive).
    isFooCallsign(callsign) {
      return String(callsign ?? '').trim().toUpperCase() === 'FOO';
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
  }

  function getNavModule() {
    if (addonRuntime.mainPlugin?.navModule) {
      addonRuntime.navModule = addonRuntime.mainPlugin.navModule;
    }
    if (!addonRuntime.navModule) {
      addonRuntime.navModule = new NavModule();
    }
    return addonRuntime.navModule;
  }

  class MapModule {
    static RANGE_OPTIONS_NM = [1, 2.5, 5, 10, 20, 40, 80, 160];
    static MARK_STATES = ['', 'FRIEND', 'CIVILIAN', 'UNKNOWN', 'FOO'];
    static SHOW_STATES = ['ALL', 'UNM', 'FRIEND', 'CIVILIAN', 'UNKNOWN', 'FOO'];
    static VIEW_MODES = ['A/C F/W', 'A/C CNT', 'A/C N', 'TGT', 'TGT N'];
    static TRAFFIC_STALE_TIMEOUT_MS = 10000;

    constructor() {
      this.selectedTrafficUid = null;
      this.trafficSelectionCleared = false;
      this.trafficMarksByUid = Object.create(null);
      this.showFilter = 'ALL';
      this.trafficContactsByUid = Object.create(null);
    }

    // Returns the configured NAV range in NM.
    getRangeNm() {
      const raw = Number(getOptionValue('NAV', 'RANGE', 40));
      return this.normalizeRangeNm(raw);
    }

    // Clamps a raw range to the nearest configured NAV range value.
    normalizeRangeNm(rawRange) {
      return Number(rawRange);
    }

    // Stores a normalized NAV range value.
    setRangeNm(rawRange) {
      const range = this.normalizeRangeNm(rawRange);
      setOption('NAV', 'RANGE', String(range));
      return range;
    }

    // Steps NAV range up (+1) or down (-1) through configured range options.
    stepRange(step = 0) {
      const direction = Number(step) >= 0 ? 1 : -1;
      const current = this.getRangeNm();
      const options = MapModule.RANGE_OPTIONS_NM;
      const idx = Math.max(0, options.indexOf(current));
      const nextIndex = clampValue(idx + direction, 0, options.length - 1);
      return this.setRangeNm(options[nextIndex]);
    }

    // Returns true when radar-driven traffic should be active.
    isRadarEnabled() {
      return getOptionValue('RDR', 'RADAR', 'OFF') === 'ON';
    }

    // Normalizes one NAV MAP view mode.
    normalizeViewMode(value) {
      return value;
    }

    // Gets currently active NAV MAP view mode.
    getViewMode() {
      const value = getOptionValue('NAV', 'VIEW', 'A/C F/W');
      return this.normalizeViewMode(value);
    }

    // Sets NAV MAP view mode.
    setViewMode(value) {
      const mode = this.normalizeViewMode(value);
      setOption('NAV', 'VIEW', mode);
      return mode;
    }

    // Cycles NAV MAP view mode.
    cycleViewMode() {
      const modes = MapModule.VIEW_MODES;
      const current = this.getViewMode();
      const idx = Math.max(0, modes.indexOf(current));
      const next = modes[(idx + 1) % modes.length];
      return this.setViewMode(next);
    }

    // Returns frame configuration for NAV MAP projection.
    getMapViewFrame(scene, selectedTraffic = null) {
      const mode = this.getViewMode();
      const ownship = scene?.ownship;
      const ownHeading = Number(ownship?.heading) || 0;

      const selectedLat = Number(selectedTraffic?.lat);
      const selectedLon = Number(selectedTraffic?.lon);
      const hasSelectedPosition = Number.isFinite(selectedLat) && Number.isFinite(selectedLon);

      let centerLat = Number(ownship?.lat);
      let centerLon = Number(ownship?.lon);
      let anchor = 'forward';
      let upHeadingDeg = ownHeading;

      if (mode === 'A/C CNT') {
        anchor = 'center';
      } else if (mode === 'A/C N') {
        anchor = 'center';
        upHeadingDeg = 0;
      } else if (mode === 'TGT') {
        anchor = 'center';
        if (hasSelectedPosition) {
          centerLat = selectedLat;
          centerLon = selectedLon;
        }
      } else if (mode === 'TGT N') {
        anchor = 'center';
        upHeadingDeg = 0;
        if (hasSelectedPosition) {
          centerLat = selectedLat;
          centerLon = selectedLon;
        }
      }

      if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
        return null;
      }

      return {
        mode,
        anchor,
        centerLat,
        centerLon,
        upHeadingDeg
      };
    }

    // Projects one lat/lon point to the active NAV MAP frame.
    projectToMapViewFrame(frame, lat, lon) {
      if (!frame) return null;
      const targetLat = Number(lat);
      const targetLon = Number(lon);
      if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return null;

      const relativeNm = this.toRelativeNm({ lat: frame.centerLat, lon: frame.centerLon }, targetLat, targetLon);
      if (!relativeNm) return null;
      return this.toHeadingFrame(relativeNm, frame.upHeadingDeg);
    }

    // Returns ownship geodetic position and heading.
    getOwnshipState() {
      const lla = window.geofs?.aircraft?.instance?.llaLocation;
      if (!Array.isArray(lla) || !Number.isFinite(lla[0]) || !Number.isFinite(lla[1])) {
        return null;
      }

      const heading = Number(window.geofs?.animation?.values?.heading);
      return {
        lat: Number(lla[0]) || 0,
        lon: Number(lla[1]) || 0,
        alt: Number(lla[2]) || 0,
        heading: Number.isFinite(heading) ? heading : 0
      };
    }

    // Normalizes heading to [0..359].
    normalizeHeadingDeg(value) {
      const deg = Number(value);
      if (!Number.isFinite(deg)) return null;
      return ((Math.round(deg) % 360) + 360) % 360;
    }

    // Converts target lat/lon to north/east offsets (NM) from ownship.
    toRelativeNm(ownship, targetLat, targetLon) {
      if (!ownship || !Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
        return null;
      }

      const latAvgRad = ((ownship.lat + targetLat) * 0.5) * (Math.PI / 180);
      const northMeters = (targetLat - ownship.lat) * 110540;
      const eastMeters = (targetLon - ownship.lon) * 111320 * Math.cos(latAvgRad);

      return {
        northNm: northMeters / 1852,
        eastNm: eastMeters / 1852
      };
    }

    // Converts north/east offsets to heading-relative forward/right offsets (NM).
    toHeadingFrame(relativeNm, headingDeg) {
      if (!relativeNm) return null;
      const hdgRad = (Number(headingDeg) || 0) * (Math.PI / 180);
      const sinH = Math.sin(hdgRad);
      const cosH = Math.cos(hdgRad);

      return {
        forwardNm: relativeNm.northNm * cosH + relativeNm.eastNm * sinH,
        rightNm: -relativeNm.northNm * sinH + relativeNm.eastNm * cosH
      };
    }

    // Returns visible multiplayer aircraft in heading-relative coordinates.
    getTrafficContacts(ownship) {
      if (!ownship) return [];
      const users = Object.values(window.multiplayer?.visibleUsers ?? {});
      const navModule = getNavModule();
      const nowMs = Date.now();

      for (const user of users) {
        if (!navModule.isTrafficContactVisible(user?.callsign ?? user?.cs)) continue;

        const co = user?.lastUpdate?.co;
        if (!Array.isArray(co) || !Number.isFinite(co[0]) || !Number.isFinite(co[1])) continue;

        const uid = String(user?.id ?? user?.uid ?? '').trim();
        if (!uid) continue;

        this.trafficContactsByUid[uid] = {
          uid,
          aircraftName: String(user?.aircraftName ?? '').trim(),
          callsign: String(user?.callsign ?? user?.cs ?? '').trim(),
          lat: Number(co[0]) || 0,
          lon: Number(co[1]) || 0,
          alt: Number(co[2]) || 0,
          speedKts: Number.isFinite(Number(user?.lastUpdate?.st?.as)) ? Math.round(Number(user.lastUpdate.st.as)) : null,
          headingDeg: this.normalizeHeadingDeg(co[3]),
          trackDeg: this.normalizeHeadingDeg(co[3]),
          lastSeenMs: nowMs
        };
      }

      const result = [];

      for (const uid of Object.keys(this.trafficContactsByUid)) {
        const cached = this.trafficContactsByUid[uid];
        if (!cached) continue;

        const ageMs = nowMs - Number(cached.lastSeenMs || 0);
        if (!Number.isFinite(ageMs) || ageMs > MapModule.TRAFFIC_STALE_TIMEOUT_MS) {
          delete this.trafficContactsByUid[uid];
          if (String(this.selectedTrafficUid ?? '') === String(uid)) {
            this.selectedTrafficUid = null;
            this.trafficSelectionCleared = true;
          }
          continue;
        }

        const relNm = this.toRelativeNm(ownship, Number(cached.lat), Number(cached.lon));
        const frameNm = this.toHeadingFrame(relNm, ownship.heading);
        if (!frameNm) continue;

        result.push({
          uid: cached.uid,
          aircraftName: cached.aircraftName,
          callsign: cached.callsign,
          lat: cached.lat,
          lon: cached.lon,
          alt: cached.alt,
          altFeet: Number.isFinite(Number(cached.alt)) ? Math.round(Number(cached.alt) * 3.28084) : null,
          speedKts: cached.speedKts,
          headingDeg: cached.headingDeg,
          trackDeg: cached.trackDeg,
          ...frameNm
        });
      }

      result.sort((a, b) => {
        const ta = this.getTrafficSortToken(a);
        const tb = this.getTrafficSortToken(b);
        return ta.localeCompare(tb);
      });

      return result;
    }

    // Builds a deterministic traffic key.
    getTrafficKey(contact) {
      return String(contact?.uid || contact?.callsign || `${contact?.lat ?? ''}:${contact?.lon ?? ''}`);
    }

    // Normalizes one mark/show token.
    normalizeMarkToken(value, fallback = '') {
      return value || fallback;
    }

    // Returns a deterministic contact number for one aircraft.
    getContactNumber(contact) {
      const key = this.getTrafficKey(contact);
      if (!key) return 0;

      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = ((hash * 33) + key.charCodeAt(i)) >>> 0;
      }
      return (hash % 99) + 1;
    }

    // Token used to keep traffic ordering stable.
    getTrafficSortToken(contact) {
      const number = this.getContactNumber(contact);
      return `${String(number).padStart(3, '0')}:${this.getTrafficKey(contact)}`;
    }

    // Returns selected traffic uid (falls back to first visible contact).
    getSelectedTrafficUid(contacts = []) {
      const list = Array.isArray(contacts) ? contacts : [];
      if (!list.length) {
        this.selectedTrafficUid = null;
        return null;
      }

      const hasCurrent = this.selectedTrafficUid && list.some((c) => String(c?.uid) === String(this.selectedTrafficUid));
      if (hasCurrent) return this.selectedTrafficUid;

      if (this.trafficSelectionCleared) {
        return null;
      }

      this.selectedTrafficUid = list[0]?.uid ? String(list[0].uid) : null;
      return this.selectedTrafficUid;
    }

    // Returns mark state for a contact uid.
    getTrafficMark(uid) {
      const key = String(uid ?? '');
      if (!key) return '';
      return this.normalizeMarkToken(this.trafficMarksByUid[key], '');
    }

    // Sets mark state for one contact uid.
    setTrafficMark(uid, markState) {
      const key = String(uid ?? '');
      if (!key) return '';
      const normalized = this.normalizeMarkToken(markState, '');
      if (!normalized) {
        delete this.trafficMarksByUid[key];
        return '';
      }
      this.trafficMarksByUid[key] = normalized;
      return normalized;
    }

    // Cycles mark state for currently selected traffic target.
    cycleSelectedTrafficMark() {
      const scene = this.getSceneData();
      const contacts = this.getTrafficInRange(this.getFilteredTraffic(scene?.traffic ?? []), scene?.rangeNm);
      const uid = this.getSelectedTrafficUid(contacts);
      if (!uid) return '';

      const current = this.getTrafficMark(uid);
      const states = MapModule.MARK_STATES;
      const idx = Math.max(0, states.indexOf(current));
      const next = states[(idx + 1) % states.length] ?? '';
      return this.setTrafficMark(uid, next);
    }

    // Returns selected traffic mark state.
    getSelectedTrafficMark() {
      const scene = this.getSceneData();
      const contacts = this.getTrafficInRange(this.getFilteredTraffic(scene?.traffic ?? []), scene?.rangeNm);
      const uid = this.getSelectedTrafficUid(contacts);
      if (!uid) return '';
      return this.getTrafficMark(uid);
    }

    // Gets color for one traffic contact based on mark state.
    getTrafficColor(contact) {
      const mark = this.getTrafficMark(contact?.uid);
      if (mark === 'FRIEND') return '#3da2ff';
      if (mark === 'CIVILIAN') return '#33ff66';
      if (mark === 'UNKNOWN') return '#ffff33';
      if (mark === 'FOO') return '#ff3333';
      return '#ffffff';
    }

    // Gets currently active traffic show filter.
    getShowFilter() {
      return this.normalizeMarkToken(this.showFilter, 'ALL') || 'ALL';
    }

    // Sets traffic show filter.
    setShowFilter(value) {
      this.showFilter = this.normalizeMarkToken(value, 'ALL') || 'ALL';
      return this.showFilter;
    }

    // Cycles traffic show filter.
    cycleShowFilter() {
      const states = MapModule.SHOW_STATES;
      const current = this.getShowFilter();
      const idx = Math.max(0, states.indexOf(current));
      const next = states[(idx + 1) % states.length] ?? 'ALL';
      return this.setShowFilter(next);
    }

    // Returns true when one traffic contact matches current show filter.
    // Optionally keeps currently selected traffic visible independent of filter.
    matchesShowFilter(contact, includeSelected = true) {
      const uid = String(contact?.uid ?? '');
      if (includeSelected && uid && uid === String(this.selectedTrafficUid ?? '')) {
        return true;
      }

      const filter = this.getShowFilter();
      if (filter === 'ALL') return true;
      if (filter === 'UNM') return this.getTrafficMark(uid) === '';
      return this.getTrafficMark(uid) === filter;
    }

    // Returns traffic contacts filtered by show mode.
    // By default the current selection remains visible while selected.
    getFilteredTraffic(contacts = [], includeSelected = true) {
      const list = Array.isArray(contacts) ? contacts : [];
      return list.filter((contact) => this.matchesShowFilter(contact, includeSelected));
    }

    // Returns only traffic contacts inside the active NAV range.
    getTrafficInRange(contacts = [], rangeNm = this.getRangeNm()) {
      const list = Array.isArray(contacts) ? contacts : [];
      const maxRange = Math.max(0.1, Number(rangeNm) || 0);
      return list.filter((contact) => {
        const forward = Number(contact?.forwardNm);
        const right = Number(contact?.rightNm);
        if (!Number.isFinite(forward) || !Number.isFinite(right)) return false;
        return Math.hypot(forward, right) <= maxRange;
      });
    }

    // Steps selected traffic target by direction (+1 next, -1 previous).
    stepSelectedTraffic(step = 1) {
      const direction = Number(step) >= 0 ? 1 : -1;
      const scene = this.getSceneData();
      const contacts = this.getTrafficInRange(this.getFilteredTraffic(scene?.traffic ?? []), scene?.rangeNm);
      if (!contacts.length) {
        this.selectedTrafficUid = null;
        this.trafficSelectionCleared = false;
        return null;
      }

      this.trafficSelectionCleared = false;

      const currentUid = this.getSelectedTrafficUid(contacts);
      const currentIndex = Math.max(0, contacts.findIndex((c) => String(c?.uid) === String(currentUid)));
      const nextIndex = (currentIndex + direction + contacts.length) % contacts.length;
      this.selectedTrafficUid = String(contacts[nextIndex]?.uid ?? '');
      return this.selectedTrafficUid || null;
    }

    // Clears selected traffic target.
    clearSelectedTraffic() {
      this.selectedTrafficUid = null;
      this.trafficSelectionCleared = true;
      return null;
    }

    // Returns flightplan waypoints in heading-relative coordinates.
    getFlightPlanWaypoints(ownship) {
      if (!ownship) return [];
      const waypoints = window.geofs?.flightPlan?.waypointArray;
      if (!Array.isArray(waypoints)) return [];

      const result = [];
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const lat = Number(wp?.lat ?? wp?.navaid?.lat);
        const lon = Number(wp?.lon ?? wp?.navaid?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const relNm = this.toRelativeNm(ownship, lat, lon);
        const frameNm = this.toHeadingFrame(relNm, ownship.heading);
        if (!frameNm) continue;

        const ident = String(wp?.navaid?.ident ?? wp?.navaid?.icao ?? wp?.ident ?? wp?.navaid?.name ?? `WP${i + 1}`).trim();
        result.push({
          index: i,
          ident,
          selected: Boolean(wp?.selected),
          type: String(wp?.navaid?.type ?? wp?.type ?? '').trim(),
          lat,
          lon,
          ...frameNm
        });
      }

      return result;
    }

    // Returns aggregated MAP/HSI scene data for rendering.
    // Traffic collection can be disabled to avoid multiplayer checks.
    getSceneData(options = {}) {
      const includeTraffic = options?.includeTraffic != null
        ? Boolean(options.includeTraffic)
        : this.isRadarEnabled();
      const ownship = this.getOwnshipState();
      if (!ownship) {
        return {
          ownship: null,
          rangeNm: this.getRangeNm(),
          traffic: [],
          waypoints: []
        };
      }

      return {
        ownship,
        rangeNm: this.getRangeNm(),
        traffic: includeTraffic ? this.getTrafficContacts(ownship) : [],
        waypoints: this.getFlightPlanWaypoints(ownship)
      };
    }
  }

  function getMapModule() {
    if (addonRuntime.mainPlugin?.mapModule) {
      addonRuntime.mapModule = addonRuntime.mainPlugin.mapModule;
    }
    if (!addonRuntime.mapModule) {
      addonRuntime.mapModule = new MapModule();
    }
    return addonRuntime.mapModule;
  }

  class CommunicationModule {
    static HISTORY_LIMIT = 120;
    static HUD_MESSAGE_VISIBLE_MS = 10000;
    static VOICE_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3];

    // Initializes communication state and hook references.
    constructor() {
      this.installed = false;
      this.multiplayerRef = null;
      this.originalUpdateCallback = null;
      this.wrappedUpdateCallback = null;
      this.messages = [];
      this.hudMessage = null;
      this.lastVoiceMode = 'NONE';
      this.voiceEnabledAtServerTime = null;
      this.voiceEnabledAtLocalMs = 0;
    }

    // Installs the multiplayer update hook used for incoming chat messages.
    ensureLoaded() {
      if (this.installed) return true;
      return this.installMultiplayerHook();
    }

    // Restores multiplayer callbacks and clears volatile communication state.
    restore() {
      this.uninstallMultiplayerHook();
      this.hudMessage = null;
      this.lastVoiceMode = 'NONE';
      this.voiceEnabledAtServerTime = null;
      this.voiceEnabledAtLocalMs = 0;
      this.installed = false;
    }

    // Installs a safe wrapper around multiplayer.updateCallback.
    installMultiplayerHook() {
      const multiplayerRef = window.multiplayer;
      if (!multiplayerRef || typeof multiplayerRef.updateCallback !== 'function') return false;

      if (this.wrappedUpdateCallback && multiplayerRef.updateCallback === this.wrappedUpdateCallback) {
        this.installed = true;
        return true;
      }

      const original = multiplayerRef.updateCallback;
      const self = this;
      this.originalUpdateCallback = original;
      this.multiplayerRef = multiplayerRef;
      this.wrappedUpdateCallback = function (payload) {
        self.onMultiplayerUpdatePayload(payload);
        return original.apply(this, arguments);
      };

      multiplayerRef.updateCallback = this.wrappedUpdateCallback;
      this.installed = true;
      return true;
    }

    // Restores the original multiplayer.updateCallback.
    uninstallMultiplayerHook() {
      if (!this.multiplayerRef) {
        this.originalUpdateCallback = null;
        this.wrappedUpdateCallback = null;
        return;
      }

      if (this.wrappedUpdateCallback && this.multiplayerRef.updateCallback === this.wrappedUpdateCallback) {
        this.multiplayerRef.updateCallback = this.originalUpdateCallback;
      }

      this.originalUpdateCallback = null;
      this.wrappedUpdateCallback = null;
      this.multiplayerRef = null;
    }

    // Returns the configured communication profile.
    getProfile() {
      return {
        group: String(getOption('COMM', 'GROUP', '') ?? ''),
        flight: String(getOption('COMM', 'FLIGHT', '') ?? ''),
        wingman: String(getOption('COMM', 'WINGMAN', '') ?? '')
      };
    }

    // Stores the configured communication group token.
    setGroup(value) {
      setOption('COMM', 'GROUP', value);
      return value;
    }

    // Stores the configured communication flight token.
    setFlight(value) {
      setOption('COMM', 'FLIGHT', value);
      return value;
    }

    // Stores the configured wingman token.
    setWingman(value) {
      setOption('COMM', 'WINGMAN', value);
      return value;
    }

    // Stores multiple communication profile filters in one call.
    setProfile(profile = {}) {
      return {
        group: this.setGroup(profile.group),
        flight: this.setFlight(profile.flight),
        wingman: this.setWingman(profile.wingman)
      };
    }

    // Reads the configured voice synthesis language.
    getVoiceLanguage() {
      return String(getOption('COMM', 'VOICE_LANG', 'en-US') ?? 'en-US') || 'en-US';
    }

    // Stores the voice synthesis language.
    setVoiceLanguage(language) {
      setOption('COMM', 'VOICE_LANG', language);
      return language;
    }

    // Reads the configured speech rate.
    getVoiceRate() {
      return Number(getOptionValue('COMM', 'RATE', 1.5));
    }

    // Stores the configured speech rate.
    setVoiceRate(rate) {
      setOption('COMM', 'RATE', String(rate));
      return rate;
    }

    // Decodes URL-encoded multiplayer chat text.
    decodeChatText(value) {
      return decodeURIComponent(value.replace(/\+/g, '%20'));
    }

    // Extracts the spoken callsign by removing all bracketed tags.
    getSpokenCallsign(callsign) {
      const withoutTags = callsign.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      return withoutTags || 'UNKNOWN';
    }

    // Resolves profile match flags for one callsign.
    resolveMatches(callsign) {
      const profile = this.getProfile();

      const groupMatch = Boolean(profile.group && callsign.includes(`[${profile.group}]`));
      const flightMatch = Boolean(profile.flight && callsign.includes(`[${profile.flight}]`));
      const wingmanMatch = Boolean(profile.wingman && callsign.includes(profile.wingman));
      const allMatch = !groupMatch && !flightMatch && !wingmanMatch;

      return {
        groupMatch,
        flightMatch,
        wingmanMatch,
        allMatch
      };
    }

    // Checks if a message matches a selected communication mode.
    matchesMode(mode, entry) {
      if (mode === 'NONE') return false;
      if (mode === 'ALL') return !!entry?.allMatch;
      if (mode === 'GROUP') return !!entry?.groupMatch;
      if (mode === 'FLIGHT') return !!entry?.flightMatch;
      if (mode === 'WINGMAN') return !!entry?.wingmanMatch;
      return false;
    }


    // Returns a short category tag for a classified chat message.
    getCategoryTag(entry) {
      if (entry?.wingmanMatch) return 'WINGMAN';
      if (entry?.flightMatch) return 'FLIGHT';
      if (entry?.groupMatch) return 'GROUP';
      return 'ALL';
    }

    // Returns the callsign color used on the COMM MFD message list.
    getMfdCallsignColor(entry) {
      if (entry?.category === 'GROUP') return '#ff4444';
      if (entry?.category === 'FLIGHT') return '#3da2ff';
      if (entry?.category === 'WINGMAN') return '#33ff66';
      return '#ffffff';
    }

    // Trims a line to a fixed character budget.
    trimLine(text, maxChars = 72) {
      const value = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!value) return '';
      if (value.length <= maxChars) return value;
      return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
    }

    // Handles raw payloads from GeoFS multiplayer updates.
    onMultiplayerUpdatePayload(payload) {
      const messages = Array.isArray(payload?.chatMessages) ? payload.chatMessages : [];
      if (!messages.length) return;

      for (const message of messages) {
        this.processIncomingMessage(message, payload);
      }
    }

    // Updates the voice activation anchor used to suppress old messages.
    refreshVoiceActivationWindow(voiceMode, payloadServerTime) {
      const mode = String(voiceMode ?? 'NONE');
      const previousMode = this.lastVoiceMode;

      if (mode !== 'NONE' && previousMode === 'NONE') {
        const serverTime = Number(payloadServerTime);
        this.voiceEnabledAtServerTime = Number.isFinite(serverTime) ? serverTime : null;
        this.voiceEnabledAtLocalMs = Date.now();
      }

      if (mode === 'NONE') {
        this.voiceEnabledAtServerTime = null;
        this.voiceEnabledAtLocalMs = 0;
      }

      this.lastVoiceMode = mode;
    }

    // Returns true when a message arrived after voice mode was enabled.
    isMessageNewForVoice(entry) {
      if (Number.isFinite(this.voiceEnabledAtServerTime) && Number.isFinite(entry?.serverTime)) {
        return entry.serverTime > this.voiceEnabledAtServerTime;
      }
      if (Number.isFinite(this.voiceEnabledAtLocalMs) && this.voiceEnabledAtLocalMs > 0) {
        return Number(entry?.timestampMs) > this.voiceEnabledAtLocalMs;
      }
      return false;
    }

    // Processes one incoming chat message and dispatches side effects.
    processIncomingMessage(message, payload) {
      const callsign = message?.cs || 'UNKNOWN';
      const text = this.decodeChatText(message?.msg ?? '').trim();
      if (!text) return;

      const matches = this.resolveMatches(callsign);
      const entry = {
        uid: String(message?.uid ?? ''),
        acid: Number(message?.acid),
        callsign,
        message: text,
        serverTime: Number(payload?.serverTime) || null,
        timestampMs: Date.now(),
        category: this.getCategoryTag(matches),
        ...matches
      };

      this.messages.push(entry);
      if (this.messages.length > CommunicationModule.HISTORY_LIMIT) {
        this.messages.splice(0, this.messages.length - CommunicationModule.HISTORY_LIMIT);
      }

      const voiceMode = getOptionValue('COMM', 'VOICE', 'NONE');
      this.refreshVoiceActivationWindow(voiceMode, payload?.serverTime);
      if (this.matchesMode(voiceMode, entry) && this.isMessageNewForVoice(entry)) {
        this.speakMessage(entry);
      }

      const hudMode = getOptionValue('COMM', 'HUD', 'NONE');
      if (this.matchesMode(hudMode, entry)) {
        const formatted = [
          `[${entry.category}]`,
          this.trimLine(entry.callsign, 44),
          this.trimLine(entry.message, 88)
        ].join('\n');
        this.hudMessage = {
          text: formatted,
          expiresAtMs: Date.now() + CommunicationModule.HUD_MESSAGE_VISIBLE_MS
        };
      }
    }

    // Speaks one chat message using the browser speech synthesis API.
    speakMessage(entry) {
      const synth = window.speechSynthesis;
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return false;

      const spokenCallsign = this.getSpokenCallsign(entry.callsign);
      const utterance = new window.SpeechSynthesisUtterance(`${spokenCallsign}. ${entry.message}`);
      utterance.lang = this.getVoiceLanguage();
      utterance.rate = this.getVoiceRate();
      synth.speak(utterance);
      return true;
    }

    // Returns the latest messages for the selected communication mode.
    getMessagesByMode(mode = 'ALL', limit = 5) {
      const modeToken = String(mode ?? 'ALL').toUpperCase();
      const max = Math.max(1, Math.min(50, Number(limit) || 5));
      const filtered = modeToken === 'ANY'
        ? this.messages.slice()
        : this.messages.filter((entry) => this.matchesMode(modeToken, entry));
      return filtered.slice(Math.max(0, filtered.length - max));
    }

    // Returns the active HUD overlay text while its visibility timer is valid.
    getHudOverlayText() {
      if (!this.hudMessage?.text) return null;
      if (!Number.isFinite(this.hudMessage.expiresAtMs) || Date.now() > this.hudMessage.expiresAtMs) {
        this.hudMessage = null;
        return null;
      }
      return this.hudMessage.text;
    }
  }

  // Returns the active communication module instance.
  function getCommunicationModule() {
    if (addonRuntime.mainPlugin?.communicationModule) {
      addonRuntime.communicationModule = addonRuntime.mainPlugin.communicationModule;
    }
    return addonRuntime.communicationModule;
  }

  class F18MfdUiState {
    constructor() {
      this.pageIndex = 0;
      this.pendingMfdExport = null;
      this.pages = this.createPages();
      this.ensureDefaultsInStorage();
    }

    queueMfdExport(pageTitle = 'MFD') {
      this.pendingMfdExport = pageTitle;
    }

    exportMfdCanvasToPng(canvas, pageTitle = 'MFD') {
      const pad2 = (value) => `${value}`.padStart(2, '0');
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
      const safeTitle = pageTitle.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'MFD';
      const filename = `${safeTitle}-MFD-${stamp}.png`;

      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = filename;
      link.click();
    }

    createPages() {
      return [
        {
          title: 'REC',
          leftButtons: [
            {
              key: 'STATE',
              label: 'REC',
              states: ['OFF'],
              stateIndex: 0,
              managedExternally: true,
              onClick: () => {
                toggleFlightRecorderRecordingFromMfd();
              }
            },
          ],
          rightButtons: [
            {
              key: 'PLAYBACK',
              label: 'START',
              states: ['START'],
              stateIndex: 0,
              managedExternally: true,
              combinedAction: true,
              combinedGroupLabel: 'PLAYBACK',
              onClick: () => {
                controlFlightRecorderPlaybackFromMfd('START');
              }
            },
            {
              key: 'PLAYBACK',
              label: 'PAUSE',
              states: ['PAUSE'],
              stateIndex: 0,
              managedExternally: true,
              combinedAction: true,
              combinedGroupLabel: 'PLAYBACK',
              onClick: () => {
                controlFlightRecorderPlaybackFromMfd('PAUSE');
              }
            },
            {
              key: 'PLAYBACK',
              label: 'STOP',
              states: ['STOP'],
              stateIndex: 0,
              managedExternally: true,
              combinedAction: true,
              combinedGroupLabel: 'PLAYBACK',
              onClick: () => {
                controlFlightRecorderPlaybackFromMfd('STOP');
              }
            },
          ],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            const status = getFlightRecorderMfdStatus();
            const cx = w * 0.5;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (!status.compatible) {
              ctx.font = `bold ${Math.round(h * 0.042)}px monospace`;
              ctx.fillText('Install Flight Recorder', cx, h * 0.58);
              ctx.fillText('v1.2.0 or higher', cx, h * 0.66);
              ctx.restore();
              return;
            }

            ctx.font = `bold ${Math.round(h * 0.042)}px monospace`;
            ctx.fillText(`FR v${status.version ?? 'unknown'}`, cx, h * 0.56);
            ctx.fillText(`REC ${status.recordingState}`, cx, h * 0.64);
            ctx.fillText(`PLAY ${status.playbackState}`, cx, h * 0.72);
            ctx.restore();
          }
        },
        {
          title: 'HUD',
          leftButtons: [
            {
              key: 'HUD',
              label: 'HUD',
              states: ['F-18', 'DEFAULT'],
              stateIndex: 0,
              onClick: ({ nextState }) => {
                addonRuntime.mainPlugin?.hudModule?.setMode?.(nextState);
              }
            },
            { key: 'BRIGHT', label: 'BRT', states: ['NORM', 'DAY', 'NIGHT'], stateIndex: 0 },
            { key: 'LEVEL', label: 'LVL', states: ['FULL', 'DECLUTTERED', 'MIN'], stateIndex: 0 },
            {
              key: 'MAX_G',
              label: 'MAXG',
              states: ['RESET'],
              stateIndex: 0,
              onClick: () => {
                const currentLoadFactor = window.geofs?.animation?.values?.loadFactor;
                maxG = Number.isFinite(currentLoadFactor) ? currentLoadFactor : 1;
              }
            },
          ],
          rightButtons: [
            { key: 'COLOR', label: 'COLOR', states: ['GREEN', 'WHITE', 'BLUE', 'RED'], values: ['#00FF00', '#FFFFFF', '#00fffb', '#FF0000'], stateIndex: 0 },
          ],
          lines: []
        },
        {
          title: 'SYS',
          leftButtons: [
            { key: 'FLAPS', label: 'FLAP', states: ['MAN', 'AUTO'], stateIndex: 0 },
            { key: 'NA', label: '', states: [''], stateIndex: 0 },
            { key: 'SPEEDBRAKE', label: 'SPLR', states: ['MAX', '25%', '50%', '75%'], stateIndex: 0 },
          ],
          rightButtons: [
            { key: 'REFUELING', label: 'FUEL', states: ['CLOSED', 'OPEN'], stateIndex: 0 }
          ],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            drawGearAndFlapIndicators(ctx, w, h, color, { target: 'mfd' });
          }
        },
        {
          title: 'CHK',
          leftButtons: [
            {
              key: 'PREV',
              label: 'PREV',
              states: [''],
              stateIndex: 0,
              managedExternally: true,
              onClick: () => {
                const type = getOption('CHK', 'TYPE', 'PROC');
                getChecklistModule().prevChecklist(type);
              }
            },
            { key: 'N/A1', label: '', states: [''], stateIndex: 0 },
            { key: 'ALL', label: 'SHOW', states: ['ONE', 'ALL'], stateIndex: 0 },
            { key: 'N/A2', label: '', states: [''], stateIndex: 0 },
            {
              key: 'TYPE',
              label: 'TYPE',
              states: ['PROC', 'EMER', 'OPS', 'FLP'],
              stateIndex: 0,
              onClick: ({ nextState }) => {
                setOption('CHK', 'ALL', 'ALL'); // Show all checklists of this type when switching type.
                getChecklistModule().setCurrentIndex(nextState, 0);
              }
            },
          ],
          rightButtons: [
            {
              key: 'NEXT',
              label: 'NEXT',
              states: [''],
              stateIndex: 0,
              managedExternally: true,
              onClick: () => {
                const type = getOption('CHK', 'TYPE', 'PROC');
                getChecklistModule().nextChecklist(type);
              }
            },
            { key: 'N/A3', label: '', states: [''], stateIndex: 0 },
            { key: 'N/A31', label: '', states: [''], show: () => { return getOption('CHK', 'ALL', 'ONE') !== 'ONE'; }, stateIndex: 0 },
            {
              key: 'CHECK_ITEM',
              label: 'CHK',
              states: [''],
              stateIndex: 0,
              managedExternally: true,
              show: () => { return getOption('CHK', 'ALL', 'ONE') === 'ONE'; },
              onClick: () => {
                const type = getOption('CHK', 'TYPE', 'PROC');
                getChecklistModule().markNextCurrentItem(type);
              }
            },
            {
              key: 'RESET',
              label: 'RST',
              states: [''],
              stateIndex: 0,
              managedExternally: true,
              onClick: () => {
                const isAllMode = getOption('CHK', 'ALL', 'ONE') === 'ALL';
                const type = getOption('CHK', 'TYPE', 'PROC');
                const checklistModule = getChecklistModule();

                if (isAllMode) {
                  checklistModule.resetType(type);
                  return;
                }

                checklistModule.resetCurrent(type);
              }
            },
            {
              key: 'COMPLETE',
              label: 'DONE',
              states: [''],
              stateIndex: 0,
              managedExternally: true,
              onClick: () => {
                const isAllMode = getOption('CHK', 'ALL', 'ONE') === 'ALL';
                const type = getOption('CHK', 'TYPE', 'PROC');
                const checklistModule = getChecklistModule();

                if (isAllMode) {
                  checklistModule.toggleCurrentCompleted(type);
                  checklistModule.nextChecklistNoWrap(type);
                  return;
                }

                // Single checklist mode: DONE should always set completed=true,
                // then advance to next checklist if available (no wrap-around).
                checklistModule.setCurrentCompleted(type, true);
                checklistModule.nextChecklistNoWrap(type);
              }
            },
          ],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            const checklistModule = getChecklistModule();
            const selectedType = getOption('CHK', 'TYPE', 'PROC');
            const showAll = getOption('CHK', 'ALL', 'ONE') === 'ALL';
            const checklists = checklistModule.getChecklists(selectedType);

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.textBaseline = 'middle';
            const contentX = w * 0.22;
            const textPx = Math.round(h * 0.045);

            ctx.textAlign = 'left';
            ctx.font = `bold ${textPx}px monospace`;
            ctx.fillText(`TYPE ${selectedType}  MODE ${showAll ? 'ALL' : 'ONE'}`, contentX, h * 0.16);

            if (!checklists.length) {
              ctx.font = `bold ${textPx}px monospace`;
              ctx.fillText('NO CHECKLISTS', contentX, h * 0.24);
              ctx.restore();
              return;
            }

            if (showAll) {
              const startX = contentX;
              const startY = h * 0.22;
              const rowStep = h * 0.062;
              const boxSize = h * 0.032;

              ctx.textAlign = 'left';
              ctx.font = `bold ${textPx}px monospace`;

              for (let i = 0; i < checklists.length; i++) {
                const rowY = startY + i * rowStep;
                if (rowY > h * 0.88) break;

                const checklist = checklists[i];
                ctx.strokeRect(startX, rowY - boxSize * 0.5, boxSize, boxSize);
                if (checklist?.completed) {
                  ctx.fillRect(startX + 2, rowY - boxSize * 0.5 + 2, Math.max(0, boxSize - 4), Math.max(0, boxSize - 4));
                }

                const currentMark = i === checklistModule.getCurrentIndex(selectedType) ? '>' : ' ';
                ctx.fillText(`${currentMark} ${checklist?.title ?? `Checklist ${i + 1}`}`, startX + boxSize + w * 0.02, rowY);
              }
            } else {
              const current = checklistModule.getCurrentChecklist(selectedType);
              const completedTag = current?.completed ? '[X]' : '[ ]';

              ctx.textAlign = 'left';
              ctx.font = `bold ${textPx}px monospace`;
              ctx.fillText(`${completedTag} ${current?.title ?? 'Checklist'}`, contentX, h * 0.24);

              ctx.textAlign = 'left';
              ctx.font = `bold ${textPx}px monospace`;
              const items = Array.isArray(current?.items) ? current.items : [];
              const itemCompleted = checklistModule.getCurrentItemCompleted(selectedType);
              let y = h * 0.295;
              for (let i = 0; i < items.length; i++) {
                if (y > h * 0.88) break;
                const marker = itemCompleted[i] ? 'v' : '-';
                ctx.fillText(`${marker} ${items[i]}`, contentX, y);
                y += h * 0.055;
              }
            }

            ctx.restore();
          }
        },
        {
          title: 'WPN',
          leftButtons: [
            { key: 'MASTER', label: 'MSTR', states: ['OFF', 'ON', 'SIM'], stateIndex: 0 },
            {
              key: 'SELECT',
              label: 'SEL',
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
              label: 'CFG',
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
              show: () => controls?.gear?.position === 1 && geofs?.animation?.values?.haglFeet > 50 && getOption('WPN', 'MASTER', 'OFF') !== 'OFF' && getOption('WPN', 'MODE', 'NAV') != 'JETTISON'
            },
            {
              key: 'JETTISON',
              label: 'JETT',
              states: ['N/A'],
              stateIndex: 0,
              onClick: ({ page }) => {
                const mode = getWpnModeFromOptions();
                const modeLoadout = getWpnModeLoadout(mode);
                jettisonSelectedWpnWeapon(mode, modeLoadout);
              },
              show: () => controls?.gear?.position === 1 && geofs?.animation?.values?.haglFeet > 50 && getOption('WPN', 'MODE', 'NAV') == 'JETTISON'
            },
            {
              key: 'REARM',
              label: 'ARM',
              states: ['START'],
              stateIndex: 0,
              onClick: ({ page }) => {
                // The armament to load in the wpnLoadout.
                const config = getOption('WPN', 'CONFIG', 'A/A');

                // Start the rearming process, which will gradually fill the wpnLoadout based on the selected config.
                startWpnRearm(config);
              },
              show: () => controls?.gear?.position === 0 && !geofs?.animation?.values?.enginesOn && getOption('WPN', 'MASTER', 'OFF') === 'OFF'
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

            if (getOption('WPN', 'MASTER', 'OFF') !== 'OFF') {
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
        },
        {
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
              show() { return getOption('NAV', 'DISPLAY', 'HSI') === 'MAP'; },
              onClick: () => {
                getMapModule().cycleSelectedTrafficMark();
              }
            },
            {
              key: 'SHOW',
              label: 'SHOW',
              states: ['', 'FRND', 'CIV', 'UNKN', 'FOO'],
              values: ['', 'FRIEND', 'CIVILIAN', 'UNKNOWN', 'FOO'],
              stateIndex: 0,
              managedExternally: true,
              show() { return getOption('NAV', 'DISPLAY', 'HSI') === 'MAP'; },
              onClick: () => {
                getMapModule().cycleShowFilter();
              }
            },
            {
              key: 'VIEW',
              label: 'VW',
              states: ['A/C F/W', 'A/C CNT', 'A/C N', 'TGT', 'TGT N'],
              stateIndex: 0,
              managedExternally: true,
              show: () => getOption('NAV', 'DISPLAY', 'HSI') === 'MAP',
              onClick: () => {
                getMapModule().cycleViewMode();
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
              show() { return getOption('NAV', 'DISPLAY', 'HSI') === 'HSI'; },
              onClick: () => {
                stepSelectedFlightPlanWaypoint(1);
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
              show() { return getOption('NAV', 'DISPLAY', 'HSI') === 'HSI'; },
              onClick: () => {
                stepSelectedFlightPlanWaypoint(-1);
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
                getMapModule().stepRange(1);
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
                getMapModule().stepRange(-1);
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
                getMapModule().stepSelectedTraffic(1);
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
                getMapModule().stepSelectedTraffic(-1);
              }
            },
            {
              key: 'CLEAR',
              label: 'CLR',
              states: [''],
              stateIndex: 0,
              managedExternally: true,
              onClick: () => {
                getMapModule().clearSelectedTraffic();
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

            addonRuntime.navRdrRuntime = addonRuntime.navRdrRuntime || { bootStartMs: 0 };

            const engOn = Boolean(window.geofs?.animation?.values?.enginesOn);
            if (!engOn) {
              addonRuntime.navRdrRuntime.bootStartMs = 0;
            } else if (!addonRuntime.navRdrRuntime.bootStartMs) {
              addonRuntime.navRdrRuntime.bootStartMs = Date.now();
            }

            const elapsedMs = engOn ? (Date.now() - addonRuntime.navRdrRuntime.bootStartMs) : 0;
            const bootReady = engOn && elapsedMs >= 4000;

            const contentX = w * 0.19;
            const contentY = h * 0.13;
            const contentW = w * 0.62;
            const contentH = h * 0.74;

            const mode = getOptionValue('NAV', 'DISPLAY', 'HSI');
            const declutterLevel = getOptionValue('NAV', 'DECLUTTER', 'OFF');
            const radarEnabled = getOptionValue('RDR', 'RADAR', 'OFF') === 'ON';

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

            const mapModule = getMapModule();
            const scene = mapModule.getSceneData();
            const rangeNm = Math.max(1, Number(scene?.rangeNm) || 40);
            const shouldShowTraffic = radarEnabled && declutterLevel !== 'L2';
            if (!shouldShowTraffic) {
              mapModule.clearSelectedTraffic();
            }
            const visibleTraffic = shouldShowTraffic ? mapModule.getFilteredTraffic(scene?.traffic ?? []) : [];
            const selectedTrafficUid = shouldShowTraffic ? mapModule.getSelectedTrafficUid(visibleTraffic) : null;
            const selectedTraffic = visibleTraffic.find((c) => String(c?.uid ?? '') === String(selectedTrafficUid ?? '')) ?? null;
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

            const drawTrafficContact = (x, y, contact, upHeadingDeg = Number(scene?.ownship?.heading) || 0) => {
              const isSelected = String(contact?.uid ?? '') === String(selectedTrafficUid ?? '');
              const trafficColor = mapModule.getTrafficColor(contact);

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

              const number = mapModule.getContactNumber(contact);
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
              const selectedNumber = mapModule.getContactNumber(selectedTraffic);

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
              const navReadouts = getNavModule().getReadouts();
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

              // Fictitious compass ring: dots + labels only (no outer circle), labels always upright.
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
                const courseOffsetPx = clampValue(5 * navCourseDeviation, -100, 100) * (w / 512);

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

              // Clip all NAV objects to HSI circle.
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
              const mapViewFrame = mapModule.getMapViewFrame(scene, selectedTraffic);
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
                const projected = mapModule.projectToMapViewFrame(mapViewFrame, point?.[latKey], point?.[lonKey]);
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
        },
        {
          title: 'RDR',
          leftButtons: [
            {
              key: 'RADAR',
              label: 'RDR',
              states: ['OFF', 'ON'],
              stateIndex: 0,
              onClick: ({ nextState }) => {
                if (String(nextState ?? '').toUpperCase() !== 'ON') return;
                addonRuntime.navRdrRuntime = addonRuntime.navRdrRuntime || { bootStartMs: 0 };
                addonRuntime.navRdrRuntime.bootStartMs = Date.now();
              }
            },
            {
              key: 'FOO',
              label: 'FOO',
              states: ['SHOW', 'HIDE'],
              stateIndex: 0
            }
          ],
          rightButtons: [
            { key: 'RNG', label: 'RNG', states: ['20', '40', '80'], values: [20, 40, 80], stateIndex: 1 }
          ],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            addonRuntime.navRdrRuntime = addonRuntime.navRdrRuntime || { bootStartMs: 0 };

            const engOn = Boolean(window.geofs?.animation?.values?.enginesOn);
            if (!engOn) {
              addonRuntime.navRdrRuntime.bootStartMs = 0;
            } else if (!addonRuntime.navRdrRuntime.bootStartMs) {
              addonRuntime.navRdrRuntime.bootStartMs = Date.now();
            }

            const elapsedMs = engOn ? (Date.now() - addonRuntime.navRdrRuntime.bootStartMs) : 0;
            const bootReady = engOn && elapsedMs >= 5000;

            const contentX = w * 0.19;
            const contentY = h * 0.13;
            const contentW = w * 0.62;
            const contentH = h * 0.74;

            const rangeNmRaw = Number(getOptionValue('RDR', 'RNG', 40));
            const rangeNm = Number.isFinite(rangeNmRaw) && rangeNmRaw > 0 ? rangeNmRaw : 40;
            const radarEnabled = getOptionValue('RDR', 'RADAR', 'OFF') === 'ON';

            const distanceMeters = (a, b) => {
              const distanceFn = window.geofs?.utils?.distanceInMeters;
              if (typeof distanceFn === 'function') {
                return Number(distanceFn(a, b)) || 0;
              }
              if (!Array.isArray(a) || !Array.isArray(b)) return 0;
              const latAvgRad = (((Number(a[0]) || 0) + ((Number(b[0]) || 0))) * 0.5) * (Math.PI / 180);
              const dx = (((Number(b[1]) || 0) - ((Number(a[1]) || 0))) * 111320) * Math.cos(latAvgRad);
              const dy = (((Number(b[0]) || 0) - ((Number(a[0]) || 0))) * 110540);
              const dz = ((Number(b[2]) || 0) - (Number(a[2]) || 0));
              return Math.sqrt(dx * dx + dy * dy + dz * dz);
            };

            const bearingDeg = (a, b) => {
              const bearingFn = window.geofs?.utils?.bearingInDegrees;
              if (typeof bearingFn === 'function') {
                return Number(bearingFn(a, b)) || 0;
              }
              if (!Array.isArray(a) || !Array.isArray(b)) return 0;
              const lat1 = (Number(a[0]) || 0) * Math.PI / 180;
              const lat2 = (Number(b[0]) || 0) * Math.PI / 180;
              const dLon = (((Number(b[1]) || 0) - ((Number(a[1]) || 0))) * Math.PI / 180);
              const y = Math.sin(dLon) * Math.cos(lat2);
              const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
              return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
            };

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

            const myPos = window.geofs?.aircraft?.instance?.llaLocation;
            const myHeading = Number(window.geofs?.animation?.values?.heading) || 0;
            const navModule = getNavModule();
            const visibleUsers = navModule.filterMultiplayerContacts(Object.values(window.multiplayer?.visibleUsers ?? {}));

            const radarTop = contentY;
            const radarBottom = contentY + contentH;
            const radarHeight = Math.max(0, radarBottom - radarTop);
            const cx = contentX + contentW * 0.5;
            const cy = radarTop + radarHeight * 0.5;
            const radius = Math.max(200, Math.min(contentW * 0.5, radarHeight * 0.5));

            // Radar grid.
            ctx.strokeStyle = '#004422';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
            ctx.stroke();

            // Sweep line.
            const sweepAngle = ((Date.now() % 3000) / 3000) * Math.PI * 2;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(sweepAngle) * radius, cy + Math.sin(sweepAngle) * radius);
            ctx.stroke();

            // Targets.
            if (Array.isArray(myPos)) {
              for (const user of visibleUsers) {
                const co = user?.lastUpdate?.co;
                if (!Array.isArray(co) || co.length < 3) continue;

                const targetPos = [Number(co[0]) || 0, Number(co[1]) || 0, Number(co[2]) || 0];
                const distanceNm = distanceMeters(myPos, targetPos) / 1609.34;
                if (!Number.isFinite(distanceNm) || distanceNm <= 0 || distanceNm >= rangeNm) continue;

                const bearing = bearingDeg(myPos, targetPos);
                const relative = (bearing - myHeading - 90) * Math.PI / 180;
                const ratio = distanceNm / rangeNm;
                const px = cx + (ratio * radius) * Math.cos(relative);
                const py = cy + (ratio * radius) * Math.sin(relative);

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(px - 4, py - 4, 8, 8);
                ctx.font = `${Math.round(h * 0.020)}px monospace`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const altKft = Math.round(((Number(co[2]) || 0) * 3.28084) / 1000);
                ctx.fillText(String(altKft), px + 10, py);
              }
            }

            // Own ship.
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
          }
        },
        {
          title: 'COMM',
          leftButtons: [
            { key: 'SHOW', label: 'SHOW', states: ['MSG', 'CFG'], stateIndex: 0 },
            { key: 'N/A1', label: '', states: [''], stateIndex: 0 },
            { key: 'DISPLAY', label: 'DISP', states: ['NO', 'ALL', 'GRP', 'FLT', 'W/M'], values: ['NONE', 'ALL', 'GROUP', 'FLIGHT', 'WINGMAN'], stateIndex: 0, show: () => getOption('COMM', 'SHOW', 'MSG') === 'MSG' },
            { key: 'N/A2', label: '', states: [''], stateIndex: 0 },
            { key: 'HUD', label: 'HUD', states: ['NO', 'ALL', 'GRP', 'FLT', 'W/M'], values: ['NONE', 'ALL', 'GROUP', 'FLIGHT', 'WINGMAN'], stateIndex: 0, show: () => getOption('COMM', 'SHOW', 'MSG') === 'MSG' },
          ],
          rightButtons: [
            { key: 'VOICE', label: 'VOICE', states: ['NONE', 'ALL', 'GROUP', 'FLIGHT', 'WINGMAN'], stateIndex: 0, show: () => getOption('COMM', 'SHOW', 'MSG') === 'CFG' },
            { key: 'N/A3', label: '', states: [''], stateIndex: 0 },
            { key: 'RATE', label: 'RATE', states: ['0.75', '1', '1.25', '1.5', '2', '2.5', '3'], values: [0.75, 1, 1.25, 1.5, 2, 2.5, 3], stateIndex: 3, show: () => getOption('COMM', 'SHOW', 'MSG') === 'CFG' },
          ],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            const communicationModule = getCommunicationModule();
            const profile = communicationModule.getProfile();
            const voiceLanguage = communicationModule.getVoiceLanguage();
            const voiceRate = communicationModule.getVoiceRate();
            const voiceMode = getOptionValue('COMM', 'VOICE', 'NONE');
            const displayMode = getOptionValue('COMM', 'DISPLAY', 'NONE');
            const hudMode = getOptionValue('COMM', 'HUD', 'NONE');
            const showMode = getOption('COMM', 'SHOW', 'MSG');
            const mfdMessageMode = displayMode === 'ALL' ? 'ANY' : displayMode;

            const recentMessages = communicationModule.getMessagesByMode(mfdMessageMode, 5);

            const fmt = (value, withBrackets = false) => {
              const token = String(value ?? '').trim();
              if (!token) return '-';
              return withBrackets ? `[${token}]` : token;
            };
            const trimMessageLine = (text, maxChars = 64) => {
              return communicationModule.trimLine(text, maxChars);
            };
            const wrapFixed = (text, lineLen = 32, maxLines = 2) => {
              const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
              if (!cleaned) return [''];
              const lines = [];
              let cursor = 0;
              while (cursor < cleaned.length && lines.length < maxLines) {
                const remaining = cleaned.slice(cursor);
                if (remaining.length <= lineLen) {
                  lines.push(remaining);
                  cursor = cleaned.length;
                  break;
                }

                let cut = lineLen;
                const lastSpace = remaining.slice(0, lineLen + 1).lastIndexOf(' ');
                if (lastSpace > Math.floor(lineLen * 0.6)) {
                  cut = lastSpace;
                }

                lines.push(remaining.slice(0, cut).trim());
                cursor += cut;
                while (cleaned[cursor] === ' ') cursor += 1;
              }

              if (cursor < cleaned.length && lines.length) {
                const last = lines.length - 1;
                lines[last] = trimMessageLine(lines[last], lineLen);
              }

              return lines.slice(0, maxLines);
            };

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1.2, w * 0.0022);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            if (showMode === 'CFG') {
              const cfgX = w * 0.33;
              let y = h * 0.16;
              const cfgTextPx = Math.round(h * 0.045);
              const colorGroup = communicationModule.getMfdCallsignColor({ category: 'GROUP' });
              const colorFlight = communicationModule.getMfdCallsignColor({ category: 'FLIGHT' });
              const colorWingman = communicationModule.getMfdCallsignColor({ category: 'WINGMAN' });

              ctx.font = `bold ${cfgTextPx}px monospace`;
              ctx.fillStyle = color;
              ctx.fillText(`VOICE ${voiceMode}`, cfgX, y);
              y += h * 0.046;
              ctx.fillText(`DISP ${displayMode}`, cfgX, y);
              y += h * 0.046;
              ctx.fillText(`HUD ${hudMode}`, cfgX, y);

              y += h * 0.056;
              ctx.fillStyle = colorGroup;
              ctx.fillText(`GROUP ${fmt(profile.group, true)}`, cfgX, y);

              y += h * 0.046;
              ctx.fillStyle = colorFlight;
              ctx.fillText(`FLIGHT ${fmt(profile.flight, true)}`, cfgX, y);

              y += h * 0.046;
              ctx.fillStyle = colorWingman;
              ctx.fillText(`WINGMAN ${fmt(profile.wingman, false)}`, cfgX, y);

              y += h * 0.046;
              ctx.fillStyle = color;
              ctx.fillText(`LANG ${fmt(voiceLanguage, false)}`, cfgX, y);

              y += h * 0.046;
              ctx.fillText(`RATE ${fmt(String(voiceRate), false)}`, cfgX, y);
            } else {
              const panelX = w * 0.19;
              const panelW = w * 0.78;
              const rowH = h * 0.145;
              const rowTopMargin = h * 0.11;
              const rowBottomMargin = h * 0.11;
              const firstRowCenterY = rowTopMargin + rowH * 0.5;
              const lastRowCenterY = h - rowBottomMargin - rowH * 0.5;
              const rowStep = (lastRowCenterY - firstRowCenterY) / 4;
              const rowStartY = firstRowCenterY;

              const callsignFontPx = Math.round(h * 0.038);
              const messageFontPx = Math.round(h * 0.044);
              const msgLineStep = h * 0.040;

              for (let i = 0; i < 5; i++) {
                const rowY = rowStartY + i * rowStep;
                const rowTop = rowY - rowH * 0.48;

                const item = recentMessages[recentMessages.length - 1 - i] ?? null;
                const rowColor = item
                  ? (communicationModule?.getMfdCallsignColor?.(item) ?? '#ffffff')
                  : color;
                ctx.strokeStyle = rowColor;
                ctx.strokeRect(panelX, rowTop, panelW, rowH);

                if (!item) {
                  ctx.fillStyle = color;
                  ctx.font = `bold ${messageFontPx}px monospace`;
                  ctx.fillText('--', panelX + w * 0.012, rowY);
                  continue;
                }

                const callsignLine = trimMessageLine(`[${item.category}] ${item.callsign}`, 56);
                const wrappedMessageLines = wrapFixed(item.message, 35, 2);

                ctx.fillStyle = rowColor;
                ctx.font = `bold ${callsignFontPx}px monospace`;
                ctx.fillText(callsignLine, panelX + w * 0.012, rowY - h * 0.036);

                ctx.fillStyle = rowColor;
                ctx.font = `bold ${messageFontPx}px monospace`;
                ctx.fillText(wrappedMessageLines[0] ?? '', panelX + w * 0.012, rowY - h * 0.001);
                ctx.fillText(wrappedMessageLines[1] ?? '', panelX + w * 0.012, rowY - h * 0.001 + msgLineStep);
              }
            }

            ctx.restore();
          }
        },
        {
          title: 'ADI',
          leftButtons: [],
          rightButtons: [],
          lines: [],
          render: function (renderer, renderContext) {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? 512;
            const h = renderContext?.h ?? 512;
            const layout = renderContext?.layout;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            const pitch = Number(window.geofs?.animation?.values?.atilt) || 0;
            const roll = Number(window.geofs?.animation?.values?.aroll) || 0;
            const kias = Math.round(Number(window.geofs?.animation?.values?.kias) || 0);
            const alt = Math.round((Number(window.geofs?.animation?.values?.altitude) || 0) * 3.28084);
            const vsi = Math.round(Number(window.geofs?.animation?.values?.climbrate) || 0);

            const frame = layout?.frame ?? { left: 0, top: 0, width: w, height: h };

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            const cx = w * 0.5;
            const cy = h * 0.54;
            const radius = w * 0.31;
            const pScale = 8;

            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.clip();

            ctx.translate(cx, cy);
            ctx.rotate((roll * Math.PI) / 180);
            ctx.translate(0, -pitch * pScale);

            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 4; i < radius * 4; i += 8) {
              ctx.moveTo(-radius * 3, i);
              ctx.lineTo(radius * 3, i);
            }
            ctx.stroke();

            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-radius * 3, 0);
            ctx.lineTo(radius * 3, 0);
            ctx.stroke();

            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -radius * 5);
            ctx.lineTo(0, radius * 5);
            ctx.stroke();

            ctx.font = 'bold 20px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let p = -90; p <= 90; p += 10) {
              if (p === 0) continue;
              const py = -p * pScale;
              const lineW = (p % 20 === 0) ? 50 : 25;
              ctx.beginPath();
              ctx.moveTo(-lineW, py);
              ctx.lineTo(lineW, py);
              ctx.stroke();
              ctx.fillStyle = '#000000';
              ctx.fillRect(-18, py - 9, 36, 18);
              ctx.fillStyle = color;
              ctx.fillText(Math.abs(p), 0, py + 1);
            }
            ctx.restore();

            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();

            // Draw boresight symbol.
            const wx = cx;
            const wy = cy;
            const ww = w * 0.027;
            const wh = h * 0.016;
            const stub = w * 0.010;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(wx - ww, wy);
            ctx.lineTo(wx - ww * 0.55, wy + wh);
            ctx.lineTo(wx, wy - wh * 0.15);
            ctx.lineTo(wx + ww * 0.55, wy + wh);
            ctx.lineTo(wx + ww, wy);
            ctx.moveTo(wx - ww - stub, wy);
            ctx.lineTo(wx - ww, wy);
            ctx.moveTo(wx + ww, wy);
            ctx.lineTo(wx + ww + stub, wy);
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Draw speed and altitude boxes.
            const boxY = cy - radius - h * 0.012;
            const spdX = w * 0.18;
            const altX = w * 0.82;

            ctx.lineWidth = 2;
            ctx.strokeRect(spdX - 42, boxY - 20, 84, 40);
            ctx.font = 'bold 26px monospace';
            ctx.fillText(kias, spdX, boxY + 2);

            ctx.strokeRect(altX - 52, boxY - 22, 104, 44);
            const altRounded = Math.max(0, Math.round(alt));
            const thousands = Math.floor(altRounded / 1000);
            const hundredsText = String(altRounded % 1000).padStart(3, '0');
            const rightX = altX + 52 - w * 0.014;
            const altCenterY = boxY + 1;

            ctx.textAlign = 'right';
            ctx.font = 'bold 22px monospace';
            const hundredsWidth = ctx.measureText(hundredsText).width;
            ctx.fillText(hundredsText, rightX, altCenterY);
            ctx.font = 'bold 30px monospace';
            ctx.fillText(String(thousands), rightX - hundredsWidth - w * 0.006, altCenterY);

            // Draw vertical speed readout.
            const vsiText = `${vsi >= 0 ? ' ' : ''}${vsi}`;
            ctx.font = 'bold 24px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(vsiText, altX - w * 0.07, boxY - h * 0.08);

            ctx.restore();
          }
        },
       {
  title: 'TGP',
  leftButtons: [
    { key: 'STYLE',     label: 'STYLE', states: ['DAY', 'NIGHT', 'WHT'],                           stateIndex: 0 },
    { key: 'RANGE',     label: 'FOV',   states: ['0.1', '0.5','1', '2', '5', '10', '15', '20', '30', '45', '60', '90', '120'], stateIndex: 4 },
    { key: 'LOCK',      label: 'LOCK',  states: ['FREE', 'TRK', 'WPT'],                             stateIndex: 0 },
    { key: 'CAPTURE',   label: 'CPT',   states: [''], onClick: ({ page, uiState }) => {
      uiState.queueMfdExport(page.title);
    },                                                                                        stateIndex: 0 },
    { key: 'FREQUENCY', label: 'FREQ',  states: ['2', '3', '5', '10', '15', '30', '45', '60'], stateIndex: 3 },
  ],
  rightButtons: [
    {
      key: 'SLEW_UP', label: '↑', states: [''], stateIndex: 0,
      onClick: ({ page }) => page && page._updateSlew(0, 1)
    },
    {
      key: 'SLEW_DOWN', label: '↓', states: [''], stateIndex: 0,
      onClick: ({ page }) => page && page._updateSlew(0, -1)
    },
    {
      key: 'SLEW_LEFT', label: '←', states: [''], stateIndex: 0,
      onClick: ({ page }) => page && page._updateSlew(-1, 0)
    },
    {
      key: 'SLEW_RIGHT', label: '→', states: [''], stateIndex: 0,
      onClick: ({ page }) => page && page._updateSlew(1, 0)
    },
    {
      key: 'SLEW_STEP', label: 'STEP',
      states: ['0.01', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '5', '10'],
      stateIndex: 2,
    },
  ],

  _snap:            null,
  _tick:            0,
  _camYaw:          0,
  _camPitch:        -15,
  _relYaw:          0,
  _relPitch:        0,
  _lockMode:        'FREE',
  _activeMode:      'A/G',
  _targetWorldH:    0,
  _targetWorldP:    0,
  _targetLat:       null,
  _targetLon:       null,
  _targetAltM:      null,
  _targetNorthM:    0,
  _targetEastM:     0,
  _targetUpM:       0,
  _lockTargetKey:   null,
  _lockedCallsign:  'N/A',
  _lockedDist:      0,
  _targetAltFt:     0,
  _targetHdg:       0,
  _prevDist:        0,
  _prevDistTime:    0,
  _closureKts:      0,

  _WGS84_A:  6378137.0,
  _WGS84_E2: 0.00669437999014,

  _llaToEcef: function(latDeg, lonDeg, altM) {
    const lat    = latDeg * Math.PI / 180;
    const lon    = lonDeg * Math.PI / 180;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    const N = this._WGS84_A / Math.sqrt(1 - this._WGS84_E2 * sinLat * sinLat);
    return [
      (N + altM)                         * cosLat * cosLon,
      (N + altM)                         * cosLat * sinLon,
      (N * (1 - this._WGS84_E2) + altM)  * sinLat,
    ];
  },

  _ecefDeltaToNeu: function(refLatDeg, refLonDeg, dX, dY, dZ) {
    const lat    = refLatDeg * Math.PI / 180;
    const lon    = refLonDeg * Math.PI / 180;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);
    const dN = -sinLat * cosLon * dX  -  sinLat * sinLon * dY  +  cosLat * dZ;
    const dE = -sinLon          * dX  +  cosLon           * dY;
    const dU =  cosLat * cosLon * dX  +  cosLat * sinLon  * dY  +  sinLat * dZ;
    return [dN, dE, dU];
  },

  _updateSlew: function(x, y) {
    const stepBtn = this.rightButtons.find(b => b.key === 'SLEW_STEP');
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


  _updateLock: function() {
    if (this._lockMode === 'FREE') {
      this._lockTargetKey  = null;
      this._targetLat      = null;
      this._targetLon      = null;
      this._targetAltM     = null;
      this._targetNorthM   = 0;
      this._targetEastM    = 0;
      this._targetUpM      = 0;
      this._lockedDist     = 0;
      this._closureKts     = 0;
      return;
    }

    let tLat = null, tLon = null, tAltM = 0, cs = 'UNKNOWN', targetKey = null;

    if (this._lockMode === 'TRK') {
      const map     = typeof getMapModule === 'function' ? getMapModule() : null;
      const nav     = map?.getSceneData?.() ?? null;
      const traffic = map?.getFilteredTraffic?.(nav?.traffic ?? [], true) ?? [];
      const uid     = map?.getSelectedTrafficUid?.(traffic) ?? null;
      const target  = traffic.find(c => String(c?.uid ?? '') === String(uid ?? '')) ?? null;

      if (target) {
        tLat      = Number(target.lat);
        tLon      = Number(target.lon);
        tAltM     = Number(target.alt) || 0;
        cs        = target.callsign ?? target.cs ?? 'TRACK';
        targetKey = `TRK:${String(target.uid ?? uid ?? cs)}`;
        this._targetAltFt = Math.round(tAltM * 3.28084);
        this._targetHdg   = Number(target.heading ?? target.hdg ?? 0);
      }
    } else if (this._lockMode === 'WPT') {
      const waypointArray = window.geofs?.flightPlan?.waypointArray;
      const wp = Array.isArray(waypointArray) ? waypointArray.find(w => w?.selected) : null;
      if (wp) {
        tLat      = Number(wp.lat);
        tLon      = Number(wp.lon);
        tAltM     = (Number(wp.alt) || 0) * 0.3048;
        cs        = String(wp.ident ?? wp.name ?? wp.id ?? 'WPT');
        targetKey = `WPT:${cs}`;
        this._targetAltFt = Math.round(tAltM * 3.28084);
      }
    }

    const own = window.geofs?.aircraft?.instance?.llaLocation;

    if (tLat === null || tLon === null || !Number.isFinite(tLat) || !Number.isFinite(tLon) || !own) {
      this._lockTargetKey = null;
      this._targetLat     = null;
      this._targetLon     = null;
      this._targetAltM    = null;
      this._targetNorthM  = 0;
      this._targetEastM   = 0;
      this._targetUpM     = 0;
      this._lockedDist    = 0;
      this._closureKts    = 0;
      return;
    }

    if (targetKey && targetKey !== this._lockTargetKey) {
      this._lockTargetKey = targetKey;
      this._relYaw        = 0;
      this._relPitch      = 0;
      this._prevDist      = 0;
      this._prevDistTime  = 0;
      this._closureKts    = 0;
    }

    // WGS84 ECEF delta
    const ownEcef = this._llaToEcef(own[0], own[1], own[2]);
    const tgtEcef = this._llaToEcef(tLat,   tLon,   tAltM);
    const dX = tgtEcef[0] - ownEcef[0];
    const dY = tgtEcef[1] - ownEcef[1];
    const dZ = tgtEcef[2] - ownEcef[2];
    const [dN, dE, dU] = this._ecefDeltaToNeu(own[0], own[1], dX, dY, dZ);

    const distH  = Math.hypot(dN, dE);
    const dist3  = Math.hypot(distH, dU);
    const distNm = Math.round(dist3 / 1852 * 10) / 10;

    const now = Date.now();
    if (this._prevDistTime > 0 && this._lockTargetKey) {
      const dt = (now - this._prevDistTime) / 1000;
      if (dt > 0.05) {
        const closureMps = (this._prevDist - dist3) / dt;
        this._closureKts = Math.round(closureMps * 1.94384);
      }
    }
    this._prevDist     = dist3;
    this._prevDistTime = now;

    this._targetWorldH   = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
    this._targetWorldP   = Math.atan2(dU, distH) * 180 / Math.PI;
    this._targetLat      = tLat;
    this._targetLon      = tLon;
    this._targetAltM     = tAltM;
    this._targetNorthM   = dN;
    this._targetEastM    = dE;
    this._targetUpM      = dU;
    this._lockedCallsign = cs;
    this._lockedDist     = distNm;
  },

  render: function(renderer, renderContext) {
    const ctx   = renderContext?.ctx ?? renderer?.canvasAPI?.context;
    const w     = renderContext?.w   ?? 512;
    const h     = renderContext?.h   ?? 512;
    const color = renderContext?.color ?? '#00ff66';
    if (!ctx) return;

    if (!this._snap) this._snap = document.createElement('canvas');

    const page = renderContext?.page;
    if (!page) return;

    const getLeft = (key) => {
      const b = page.leftButtons.find(btn => btn.key === key);
      return b ? b.states[b.stateIndex] : null;
    };

    const imgMode    = getLeft('STYLE')     ?? 'DAY';
    const fovDeg     = Number(getLeft('RANGE') ?? 30);
    const fovRad     = fovDeg * Math.PI / 180;
    const frequency  = Number(getLeft('FREQUENCY') || 4);
    this._activeMode = getOption('WPN', 'MODE', 'A/G');
    this._lockMode   = getLeft('LOCK')      ?? 'FREE';

    const isLocked = this._lockMode === 'TRK' || this._lockMode === 'WPT';
    const isAA     = this._activeMode === 'A/A';

    this._updateLock();

    this._tick++;
    if (this._tick % frequency === 0) {
      const viewer = window.geofs?.api?.viewer;
      const mode1  = window.geofs?.camera?.modes?.[1];

      if (viewer?.scene && mode1) {
        const oPos  = [...mode1.position];
        const oOri  = [...mode1.orientation];
        const oFov  = mode1.FOV;
        const oCurr = mode1.orientations ? [...mode1.orientations.current] : [...oOri];
        const oLast = mode1.orientations ? [...mode1.orientations.last]    : [...oOri];

        const animVals  = window.geofs?.animation?.values ?? {};
        const acHeading = Number(animVals.heading360 ?? animVals.heading ?? 0);
        const acPitch   = -Number(animVals.atilt ?? 0);
        const acRoll    =  Number(animVals.aroll ?? 0);

        const normDeg = (a) => ((a % 360) + 540) % 360 - 180;
        let finalH, finalP, finalR;

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

            const hdgRad   =  acHeading * Math.PI / 180;
            const pitchRad =  acPitch   * Math.PI / 180;
            const rollRad  = -acRoll    * Math.PI / 180;

            const xH =  dN * Math.cos(hdgRad) + dE * Math.sin(hdgRad);
            const yH = -dN * Math.sin(hdgRad) + dE * Math.cos(hdgRad);
            const zH =  dU;

            const xP =  xH * Math.cos(pitchRad) + zH * Math.sin(pitchRad);
            const yP =  yH;
            const zP = -xH * Math.sin(pitchRad) + zH * Math.cos(pitchRad);

            const xB =  xP;
            const yB =  yP * Math.cos(rollRad) - zP * Math.sin(rollRad);
            const zB =  yP * Math.sin(rollRad) + zP * Math.cos(rollRad);

            finalH = normDeg(Math.atan2(yB, xB) * 180 / Math.PI + this._relYaw);
            finalP = Math.max(-85, Math.min(85,
              Math.atan2(zB, Math.hypot(xB, yB)) * 180 / Math.PI + this._relPitch));
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

        mode1.position    = [oPos[0], oPos[1], -1.2];
        mode1.orientation = [finalH, finalP, finalR];
        mode1.FOV         = fovRad;

        if (mode1.orientations) {
          mode1.orientations.current = [finalH, finalP, finalR];
          mode1.orientations.last    = [finalH, finalP, finalR];
        }

        if (window.geofs.camera.currentModeName === 'cockpit') window.geofs.camera.update(0);

        const frustum       = viewer.scene.camera.frustum;
        const origFrustumFov = frustum.fov;
        frustum.fov = fovRad;

        viewer.scene.render(viewer.clock.currentTime);

        frustum.fov = origFrustumFov;

        const vc = viewer.canvas;
        if (this._snap.width !== vc.width) {
          this._snap.width  = vc.width;
          this._snap.height = vc.height;
        }
        this._snap.getContext('2d', { alpha: false }).drawImage(vc, 0, 0);

        mode1.position    = oPos;
        mode1.orientation = oOri;
        mode1.FOV         = oFov;

        if (mode1.orientations) {
          mode1.orientations.current = oCurr;
          mode1.orientations.last    = oLast;
        }
        if (window.geofs.camera.currentModeName === 'cockpit') window.geofs.camera.update(0);
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (this._snap?.width > 0) {
      ctx.drawImage(this._snap, 0, 0, this._snap.width, this._snap.height, 0, 0, w, h);

      if (imgMode !== 'DAY') {
        const id = ctx.getImageData(0, 0, w, h);
        const d  = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
          if (imgMode === 'NIGHT') {
            d[i] = l * 0.1; d[i + 1] = l; d[i + 2] = l * 0.1;
          } else {
            d[i] = l; d[i + 1] = l; d[i + 2] = l;
          }
        }
        ctx.putImageData(id, 0, 0);
      }
    }

    const hud = isLocked ? '#ff0000' : color;
    ctx.strokeStyle = hud;
    ctx.fillStyle   = hud;
    ctx.lineWidth   = 2;

    const cx = w / 2;
    const cy = h / 2;

    if (!isAA) {
      const bs  = 22;
      const cl  = 52; 
      const gap = bs + 6; 

      ctx.strokeRect(cx - bs, cy - bs, bs * 2, bs * 2);

      ctx.beginPath();
      ctx.moveTo(cx,       cy - cl);  ctx.lineTo(cx,       cy - gap);
      ctx.moveTo(cx,       cy + gap); ctx.lineTo(cx,       cy + cl);
      ctx.moveTo(cx - cl,  cy);       ctx.lineTo(cx - gap, cy);
      ctx.moveTo(cx + gap, cy);       ctx.lineTo(cx + cl,  cy);
      ctx.stroke();

      for (let i = 1; i <= 3; i++) {
        const ty = cy - gap - i * 8;
        ctx.beginPath();
        ctx.moveTo(cx - 5, ty); ctx.lineTo(cx + 5, ty);
        ctx.stroke();
      }

      ctx.font      = 'bold 18px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('A/G', 8, 24);

      ctx.textAlign = 'right';
      ctx.fillText(`FOV ${fovDeg}\u00b0`, w - 8, 24);

      ctx.textAlign = 'center';
      ctx.fillText(isLocked ? `${this._lockMode} \u25c6 ${this._lockedCallsign}` : 'SLEW', cx, 48);


      if (isLocked && this._targetLat !== null) {
        ctx.font      = 'bold 17px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`LAT  ${this._targetLat.toFixed(4)}`, 8, h - 72);
        ctx.fillText(`LON  ${this._targetLon.toFixed(4)}`, 8, h - 50);
        ctx.fillText(`ELEV ${this._targetAltFt} ft`,        8, h - 28);

        ctx.textAlign = 'right';
        ctx.fillText(`RNG  ${this._lockedDist} NM`,              w - 8, h - 50);
        ctx.fillText(`BRG  ${Math.round(this._targetWorldH)}\u00b0`, w - 8, h - 28);
      } else {
        ctx.textAlign = 'center';
        ctx.font      = 'bold 16px monospace';
        ctx.fillText('NO TGT', cx, h - 40);
      }


    } else {
      const R       = 44;   
      const dotR    = 3;    
      const tickLen = 12;

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      [0, 1, 2, 3].forEach(i => {
        const a  = i * Math.PI / 2;
        const ix = cx + Math.cos(a) * (R - tickLen / 2);
        const iy = cy + Math.sin(a) * (R - tickLen / 2);
        const ox = cx + Math.cos(a) * (R + tickLen / 2);
        const oy = cy + Math.sin(a) * (R + tickLen / 2);
        ctx.beginPath();
        ctx.moveTo(ix, iy); ctx.lineTo(ox, oy);
        ctx.stroke();
      });

      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      if (isLocked && this._lockTargetKey) {
        ctx.fill();
      } else {
        ctx.stroke();
      }

      const barX   = cx - R - 18;
      const barH   = 44;
      const barY   = cy - barH / 2;
      const frac   = Math.max(0, Math.min(1, Math.abs(this._closureKts) / 600));
      ctx.strokeRect(barX - 4, barY, 4, barH);
      if (frac > 0) {
        ctx.fillRect(barX - 4, barY + barH * (1 - frac), 4, barH * frac);
      }
      for (let i = 0; i <= 4; i++) {
        const ty  = barY + i * (barH / 4);
        const len = (i === 2) ? 8 : 4;
        ctx.beginPath();
        ctx.moveTo(barX,       ty); ctx.lineTo(barX + len, ty);
        ctx.stroke();
      }

      ctx.font      = 'bold 18px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('A/A', 12, 24);

      ctx.textAlign = 'right';
      ctx.fillText(`FOV ${fovDeg}\u00b0`, w - 12, 30);

      ctx.textAlign = 'center';
      if (isLocked && this._lockTargetKey) {
        ctx.fillText(`TRK \u25c6 ${this._lockedCallsign}`, cx, 48);
      } else {
        ctx.fillText('ACQ', cx, 48);
      }

      if (isLocked && this._lockTargetKey) {
        ctx.font      = 'bold 17px monospace';
        ctx.textAlign = 'right';

        ctx.fillText(`ALT  ${this._targetAltFt} ft`,                  w - 8, h - 94);
        ctx.fillText(`RNG  ${this._lockedDist} NM`,                   w - 8, h - 72);

        if (Math.abs(this._closureKts) > 200) ctx.fillStyle = '#ffcc00';
        const vcSign = this._closureKts >= 0 ? '+' : '';
        ctx.fillText(`Closure Rate:    ${vcSign}${this._closureKts} kts`,          w - 8, h - 45);
        ctx.fillStyle = hud;

        ctx.fillText(`BRG  ${Math.round(this._targetWorldH)}\u00b0`,  w - 8, h - 28);
      } else {
        ctx.textAlign = 'center';
        ctx.font      = 'bold 16px monospace';
        ctx.fillText('NO TARGET SELECTED', cx, h - 40);
      }
    }

    ctx.restore();
  }
}
      ];
    }

    toCartesian(lla) {
    const [lat, lon, alt] = lla;
    return Cesium.Cartesian3.fromDegrees(lon, lat, alt);
}

directionVector(camPos, tgtPos) {
    const v = Cesium.Cartesian3.subtract(tgtPos, camPos, new Cesium.Cartesian3());
    return Cesium.Cartesian3.normalize(v, v);
}

globalHeadingPitch(dirVec) {
    const hpr = Cesium.HeadingPitchRoll.fromCartesianDirection(dirVec);
    return {
        headingDeg: Cesium.Math.toDegrees(hpr.heading),
        pitchDeg:   Cesium.Math.toDegrees(hpr.pitch)
    };
}

aircraftOrientationDeg(aircraft) {
    return {
        yaw:   aircraft.heading360,  // geofs.animation.values.heading360
        pitch: aircraft.pitch ?? 0,
        roll:  aircraft.roll ?? 0
    };
}

normalizeDeg(a) {
    return ((a + 540) % 360) - 180;
}

relativeHPR(globalH, globalP, ac) {
    return {
    yawRel:   this.normalizeDeg(globalH - ac.yaw),
    pitchRel: this.normalizeDeg(globalP - ac.pitch),
        rollRel:  0
    };
}

computeCameraOrientationRelativeToAircraft(camLLA, tgtLLA, aircraft) {
    // 1. Absolute 3D posities
  const camPos = this.toCartesian(camLLA);
  const tgtPos = this.toCartesian(tgtLLA);

    // 2. Richting van camera naar target
  const dir = this.directionVector(camPos, tgtPos);

    // 3. Globale heading/pitch van die richting
  const { headingDeg, pitchDeg } = this.globalHeadingPitch(dir);

    // 4. Aircraft attitude ophalen
  const acOri = this.aircraftOrientationDeg(aircraft);

    // 5. Camera relativiseren
    const { yawRel, pitchRel, rollRel } =
    this.relativeHPR(headingDeg, pitchDeg, acOri);

    return [yawRel, pitchRel, rollRel];
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
      return buildOptionKey(page?.title ?? 'PAGE', preferred);
    }

    ensureDefaultsInStorage() {
      const stored = readOptions();
      let changed = false;

      for (let pageIndex = 0; pageIndex < this.pages.length; pageIndex++) {
        const page = this.pages[pageIndex];
        if (!page) continue;

        for (let i = 0; i < (page.leftButtons?.length ?? 0); i++) {
          const btn = page.leftButtons[i];
          if (!btn || !btn.states?.length) continue;
          const optionKey = this.getButtonStorageKey(page, btn, i, 'L');
          if (stored[optionKey] == null) {
            stored[optionKey] = btn.states[btn.stateIndex] ?? btn.states[0];
            changed = true;
          }
        }

        for (let i = 0; i < (page.rightButtons?.length ?? 0); i++) {
          const btn = page.rightButtons[i];
          if (!btn || !btn.states?.length) continue;
          const optionKey = this.getButtonStorageKey(page, btn, i, 'R');
          if (stored[optionKey] == null) {
            stored[optionKey] = btn.states[btn.stateIndex] ?? btn.states[0];
            changed = true;
          }
        }
      }

      if (changed) {
        writeOptions(stored);
      }
    }

    getStoredStateIndex(page, button, index, side) {
      if (!button?.states?.length) return -1;

      const optionKey = this.getButtonStorageKey(page, button, index, side);
      const storedState = readOptions()?.[optionKey];

      if (storedState != null) {
        const exactIndex = button.states.findIndex((s) => s === storedState);
        if (exactIndex >= 0) return exactIndex;
      }

      if (Number.isInteger(button.stateIndex) && button.stateIndex >= 0 && button.stateIndex < button.states.length) {
        return button.stateIndex;
      }

      return 0;
    }

    toggleButton(side, index) {
      const page = this.getCurrentPage();
      const list = side === 'left' ? page.leftButtons : page.rightButtons;
      const btn = list?.[index];
      if (!btn || !btn.states?.length) return;

      const currentIndex = this.getStoredStateIndex(page, btn, index, side === 'left' ? 'L' : 'R');
      const nextIndex = (currentIndex + 1) % btn.states.length;
      const nextState = btn.states[nextIndex] ?? btn.states[0];

      if (typeof btn.onClick === 'function') {
        btn.onClick({
          page,
          side,
          index,
          button: btn,
          uiState: this,
          currentIndex,
          nextIndex,
          nextState
        });
      }

      if (btn.managedExternally) {
        return;
      }

      btn.stateIndex = nextIndex;
      setOption(page?.title ?? 'PAGE', btn?.key || btn?.label || `${side}${index + 1}`, nextState);
    }

    isButtonVisible(button, page) {
      if (!button) return false;
      if (typeof button.show !== 'function') return true;
      return Boolean(button.show({ page, button, uiState: this }));
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

    getCombinedButtonGroups(side, page = this.getCurrentPage()) {
      const visibleEntries = this.getVisibleButtonEntries(side, page);
      if (!visibleEntries.length) return [];

      const groups = [];
      let i = 0;
      while (i < visibleEntries.length) {
        const start = i;
        const key = visibleEntries[i]?.button?.key;
        i += 1;

        while (i < visibleEntries.length && visibleEntries[i]?.button?.key === key) {
          i += 1;
        }

        if (key && (i - start) >= 2) {
          groups.push({
            key,
            startSlot: start,
            endSlot: i - 1,
            entries: visibleEntries.slice(start, i)
          });
        }
      }

      return groups;
    }

    getCombinedGroupForSlot(side, slotIndex, page = this.getCurrentPage()) {
      const groups = this.getCombinedButtonGroups(side, page);
      return groups.find((group) => slotIndex >= group.startSlot && slotIndex <= group.endSlot) ?? null;
    }

    toggleButtonBySlot(side, slotIndex) {
      const page = this.getCurrentPage();
      const visibleEntries = this.getVisibleButtonEntries(side, page);
      const entry = visibleEntries?.[slotIndex];
      if (!entry) return;
      this.toggleButton(side, entry.actualIndex);
    }

    getStateLabel(button, page, actualIndex, side) {
      if (page?.title === 'REC') {
        const status = getFlightRecorderMfdStatus();
        if (!status.compatible) {
          return 'UNAVAIL';
        }
        if (button?.key === 'STATE') {
          return status.recordingState;
        }
        if (button?.key === 'PLAYBACK') {
          if (button?.combinedAction) {
            return button?.states?.[0] ?? button?.label ?? 'N/A';
          }
          return status.playbackState;
        }
      }

      if (page?.title === 'WPN' && (button?.key === 'FIRE' || button?.key === 'JETTISON')) {
        const mode = getWpnModeFromOptions();
        const modeLoadout = getWpnModeLoadout(mode);
        return getSelectedWpnLoadDisplay(mode, modeLoadout);
      }

      if (page?.title === 'NAV') {
        const abbreviateNavTrafficState = (value) => {
          const token = String(value ?? '').trim().toUpperCase();
          if (token === 'FRIEND') return 'FRND';
          if (token === 'CIVILIAN') return 'CIV';
          if (token === 'UNKNOWN') return 'UNKN';
          return token;
        };

        if (button?.key === 'MARK') {
          return abbreviateNavTrafficState(getMapModule().getSelectedTrafficMark() || '');
        }
        if (button?.key === 'SHOW') {
          return abbreviateNavTrafficState(getMapModule().getShowFilter());
        }
        if (button?.key === 'VIEW') {
          return getMapModule().getViewMode();
        }
      }

      const sideToken = side === 'right' ? 'R' : 'L';
      const resolvedIndex = this.getStoredStateIndex(page, button, actualIndex, sideToken);
      return button?.states?.[resolvedIndex] ?? '';
    }

    getLayout(w, h) {
      const frame = {
        left: 0,
        top: 0,
        width: w,
        height: h
      };

      const maxTabButtons = 5;
      const tabY = frame.top + h * 0.022;
      const bottomTabY = frame.top + h * 0.92;
      const tabW = w * 0.14;
      const tabH = h * 0.06;
      const tabGap = w * 0.03;
      const topPages = this.pages.slice(0, maxTabButtons);
      const bottomPages = this.pages.slice(maxTabButtons, maxTabButtons * 2);
      const topTabCount = topPages.length;
      const bottomTabCount = bottomPages.length;
      const tabsTotalW = topTabCount * tabW + Math.max(0, topTabCount - 1) * tabGap;
      const tabStartX = frame.left + (frame.width - tabsTotalW) * 0.5;
      const bottomTabsTotalW = bottomTabCount * tabW + Math.max(0, bottomTabCount - 1) * tabGap;
      const bottomTabStartX = frame.left + (frame.width - bottomTabsTotalW) * 0.5;

      const topTabs = topPages.map((p, i) => ({
        index: i,
        title: p.title,
        x: tabStartX + i * (tabW + tabGap) - w * 0.012,
        y: tabY - h * 0.01,
        w: tabW + w * 0.024,
        h: tabH + h * 0.02
      }));

      const bottomTabs = bottomPages.map((p, i) => ({
        index: i + maxTabButtons,
        title: p.title,
        x: bottomTabStartX + i * (tabW + tabGap) - w * 0.012,
        y: bottomTabY - h * 0.01,
        w: tabW + w * 0.024,
        h: tabH + h * 0.02
      }));

      const leftButtons = [];
      const rightButtons = [];
      const rowStartY = frame.top + h * 0.14;
      const rowStep = h * 0.155 + 3;
      const rowH = h * 0.08;

      for (let i = 0; i < 5; i++) {
        const y = rowStartY + i * rowStep;
        leftButtons.push({ index: i, x: frame.left + w * 0.028, y, w: w * 0.40, h: rowH });
        rightButtons.push({ index: i, x: frame.left + frame.width - w * 0.428, y, w: w * 0.40, h: rowH });
      }

      return { frame, topTabs, bottomTabs, leftButtons, rightButtons };
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

      for (const tab of layout.topTabs) {
        if (x >= tab.x && x <= tab.x + tab.w && y >= tab.y && y <= tab.y + tab.h) {
          this.setPage(tab.index);
          return true;
        }
      }

      for (const tab of layout.bottomTabs) {
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
      const baseColor = getOptionValue('HUD', 'COLOR', '#00ff66');
      const color = applyBrightnessToHexColor(baseColor, getMfdBrightnessFactor());
      renderer.canvasAPI.clear();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(layout.frame.left, layout.frame.top, layout.frame.width, layout.frame.height);

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(h * 0.045)}px monospace`;

      if (typeof page.render === 'function') {
        page.render(renderer, {
          ctx,
          w,
          h,
          page,
          layout,
          uiState: this,
          color
        });
      }

      for (const tab of layout.topTabs) {
        ctx.fillText(tab.title, tab.x + tab.w / 2, tab.y + tab.h / 2);
        if (tab.index === this.pageIndex) {
          ctx.strokeRect(tab.x - 4, tab.y - 2, tab.w + 8, tab.h + 4);
        }
      }

      for (const tab of layout.bottomTabs) {
        ctx.fillText(tab.title, tab.x + tab.w / 2, tab.y + tab.h / 2);
        if (tab.index === this.pageIndex) {
          ctx.strokeRect(tab.x - 4, tab.y - 2, tab.w + 8, tab.h + 4);
        }
      }

      ctx.textAlign = 'left';
      ctx.font = `bold ${Math.round(h * 0.045)}px monospace`;

      const visibleLeftButtons = this.getVisibleButtonEntries('left', page);
      const visibleRightButtons = this.getVisibleButtonEntries('right', page);

      const drawStackedLabel = (text, centerX, centerY, stepPx) => {
        const chars = String(text ?? '').split('');
        const totalHeight = Math.max(0, (chars.length - 1) * stepPx);
        const startY = centerY - totalHeight * 0.5;
        for (let c = 0; c < chars.length; c++) {
          ctx.fillText(chars[c], centerX, startY + c * stepPx);
        }
      };

      for (let i = 0; i < visibleLeftButtons.length && i < layout.leftButtons.length; i++) {
        const slot = layout.leftButtons[i];
        const combinedGroup = this.getCombinedGroupForSlot('left', i, page);
        if (combinedGroup) {
          const btn = visibleLeftButtons[i].button;
          const isMinimalGroup = Boolean(combinedGroup.entries?.[0]?.button?.minimal);
          if (isMinimalGroup) {
            const rowCenterY = slot.y + slot.h * 0.55;
            const labelX = slot.x + w * 0.016;
            ctx.save();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(btn?.label ?? ''), labelX, rowCenterY);
            ctx.restore();
            continue;
          }

          const actionText = btn?.states?.[0] ?? btn?.label ?? '';
          const rowCenterY = slot.y + slot.h * 0.55;
          const actionX = slot.x + w * 0.016;

          ctx.save();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${actionText}`, actionX, rowCenterY);
          ctx.restore();
          continue;
        }

        const btn = visibleLeftButtons[i].button;
        const label = btn.label;
        const state = this.getStateLabel(btn, page, visibleLeftButtons[i].actualIndex, 'left');
        const rowCenterY = slot.y + slot.h * 0.55;
        const labelX = slot.x + w * 0.016;
        const stateX = slot.x + w * 0.060;
        const labelStep = h * 0.038;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        drawStackedLabel(label, labelX, rowCenterY, labelStep);
        ctx.restore();

        ctx.fillText(`${state}`, stateX, rowCenterY);
      }

      for (let i = 0; i < visibleRightButtons.length && i < layout.rightButtons.length; i++) {
        const slot = layout.rightButtons[i];
        const combinedGroup = this.getCombinedGroupForSlot('right', i, page);
        if (combinedGroup) {
          const btn = visibleRightButtons[i].button;
          const isMinimalGroup = Boolean(combinedGroup.entries?.[0]?.button?.minimal);
          if (isMinimalGroup) {
            const rowCenterY = slot.y + slot.h * 0.55;
            const labelX = slot.x + slot.w - w * 0.016;
            ctx.save();
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(btn?.label ?? ''), labelX, rowCenterY);
            ctx.restore();
            continue;
          }

          const actionText = btn?.states?.[0] ?? btn?.label ?? '';
          const bracketX = slot.x + slot.w * 0.56;
          const actionX = bracketX + w * 0.026;
          ctx.fillText(`${actionText}`, actionX, slot.y + slot.h * 0.55);
          continue;
        }

        const btn = visibleRightButtons[i].button;
        const label = btn.label;
        const state = this.getStateLabel(btn, page, visibleRightButtons[i].actualIndex, 'right');
        const rowCenterY = slot.y + slot.h * 0.55;
        const labelX = slot.x + slot.w - w * 0.016;
        const labelStateGap = w * (0.060 - 0.016);
        const stateRightX = labelX - labelStateGap;
        const labelStep = h * 0.033;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        drawStackedLabel(label, labelX, rowCenterY, labelStep);
        ctx.restore();

        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${state}`, stateRightX, rowCenterY);
        ctx.restore();
      }

      const drawCombinedBracket = (side) => {
        const groups = this.getCombinedButtonGroups(side, page);
        const slots = side === 'left' ? layout.leftButtons : layout.rightButtons;
        if (!groups?.length || !slots?.length) return;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = Math.max(1.5, w * 0.0028);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(h * 0.038)}px monospace`;

        for (const group of groups) {
          const startSlot = slots[group.startSlot];
          const endSlot = slots[group.endSlot];
          if (!startSlot || !endSlot) continue;

          const isMinimalGroup = Boolean(group.entries?.[0]?.button?.minimal);
          if (isMinimalGroup) {
            const button = group.entries[0].button;
            const rawDisplayValue = (Array.isArray(button?.values) && button.values.length)
              ? getOptionValue(page?.title ?? 'PAGE', button?.key || button?.label || '', '')
              : this.getStateLabel(button, page, group.entries[0]?.actualIndex ?? 0, side);
            const hasDisplayValue = String(rawDisplayValue ?? '').trim().length > 0;
            const displayValue = hasDisplayValue
              ? rawDisplayValue
              : (button?.combinedGroupLabel ?? button?.key ?? '');

            const yTop = startSlot.y + startSlot.h * 0.22;
            const yBottom = endSlot.y + endSlot.h * 0.78;
            const yMid = (yTop + yBottom) * 0.5;
            const valueX = side === 'left'
              ? (startSlot.x + w * 0.016)
              : (startSlot.x + startSlot.w - w * 0.016);

            ctx.save();
            ctx.textAlign = side === 'left' ? 'left' : 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(displayValue ?? ''), valueX, yMid);
            ctx.restore();
            continue;
          }

          const groupLabel = group.entries?.[0]?.button?.combinedGroupLabel
            ?? group.entries?.[0]?.button?.key
            ?? '';

          const yTop = startSlot.y + startSlot.h * 0.22;
          const yBottom = endSlot.y + endSlot.h * 0.78;
          const yMid = (yTop + yBottom) * 0.5;

          const bracketX = side === 'left'
            ? (startSlot.x + startSlot.w * 0.38)
            : (startSlot.x + startSlot.w * 0.56);
          const bracketArm = w * 0.012;
          const labelOffset = w * 0.048;

          ctx.beginPath();
          if (side === 'left') {
            // Left side should point left: ']'
            ctx.moveTo(bracketX - bracketArm, yTop);
            ctx.lineTo(bracketX, yTop);
            ctx.lineTo(bracketX, yBottom);
            ctx.lineTo(bracketX - bracketArm, yBottom);
          } else {
            // Right side keeps mirrored style.
            ctx.moveTo(bracketX + bracketArm, yTop);
            ctx.lineTo(bracketX, yTop);
            ctx.lineTo(bracketX, yBottom);
            ctx.lineTo(bracketX + bracketArm, yBottom);
          }
          ctx.stroke();

          const labelX = side === 'left'
            ? (bracketX + labelOffset)
            : (bracketX - labelOffset);
          const labelChars = String(groupLabel ?? '').split('');
          const lineStep = h * 0.038;
          const totalHeight = Math.max(0, (labelChars.length - 1) * lineStep);
          const startY = yMid - totalHeight * 0.5;

          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (let c = 0; c < labelChars.length; c++) {
            ctx.fillText(labelChars[c], labelX, startY + c * lineStep);
          }
          ctx.restore();
        }

        ctx.restore();
      };

      drawCombinedBracket('left');
      drawCombinedBracket('right');

      if (Array.isArray(page.lines) && page.lines.length) {
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(h * 0.05)}px monospace`;
        page.lines.forEach((line, i) => {
          ctx.fillText(line, w * 0.5, h * (0.72 + i * 0.07));
        });
      }

      if (this.pendingMfdExport !== null) {
        const request = this.pendingMfdExport;
        this.pendingMfdExport = null;
        this.exportMfdCanvasToPng(renderer.canvasAPI.canvas, request || page.title);
      }
    }
  }

  // Returns pixelsPerDeg (vertical), pixelsPerDegX (horizontal) and
  // cameraOffsetPx (vertical eye-height parallax correction in pixels).
  function computeHudGeometry(w, h) {
    const hudVerticalFovDeg = 2 * Math.atan((F18HudModule.HUD_PHYSICAL_HEIGHT_M / 2) / CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const pixelsPerDeg = h / hudVerticalFovDeg;
    const hudPhysicalWidthM = F18HudModule.HUD_PHYSICAL_HEIGHT_M * (w / h);
    const hudHorizontalFovDeg = 2 * Math.atan((hudPhysicalWidthM / 2) / CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const pixelsPerDegX = w / hudHorizontalFovDeg;
    const cameraDeltaZ = getCurrentCameraZ() - CameraModule.DEFAULT_HUD_CAMERA_Z;
    const cameraOffsetDeg = Math.atan2(cameraDeltaZ, CAMERA_TO_HUD_DISTANCE_M) * RAD_TO_DEG;
    const cameraOffsetPx = cameraOffsetDeg * pixelsPerDeg * F18HudModule.HUD_PARALLAX_GAIN;
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
      const navReadouts = getNavModule().getReadouts(navUnit);
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

      const dme = Number.isFinite(navReadouts.dme) ? navReadouts.dme : '';
      const bearing = Number.isFinite(navReadouts.bearing) ? navReadouts.bearing : '';
      const course = Number.isFinite(navReadouts.course) ? navReadouts.course : '';
      const timeToSignal = Number.isFinite(navReadouts.timeToSignal) ? navReadouts.timeToSignal : '';

      ctx.fillText(`DME ${dme}`, x, rowY);
      rowY += rowStep;
      ctx.fillText(`B ${bearing}`, x, rowY);
      rowY += rowStep;
      ctx.fillText(`C ${course}`, x, rowY);
      rowY += rowStep;
      ctx.fillText(`T ${timeToSignal} MIN`, x, rowY);
      rowY += rowStep;

      ctx.fillText(navReadouts.navaidLabel || '', x, rowY);
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

  function drawGearAndFlapIndicators(ctx, w, h, lineColor, options = {}) {
    const target = String(options?.target ?? 'hud').toLowerCase();
    const isMfd = target === 'mfd';

    const gearRaw = Number(window.controls?.gear?.position);
    const gearPos = Number.isFinite(gearRaw) ? gearRaw : 1;

    const flapsPosRaw = Number(window.controls?.flaps?.position);
    const flapsPos = Number.isFinite(flapsPosRaw) ? flapsPosRaw : 0;
    const flapsMaxRaw = Number(window.controls?.flaps?.maxPosition);
    const flapsMax = Number.isFinite(flapsMaxRaw) && flapsMaxRaw > 0 ? flapsMaxRaw : 1;
    const flapsNorm = Math.max(0, Math.min(1, flapsPos / flapsMax));

    const hookRaw = Number(window.controls?.accessories?.position);
    const hookPos = Number.isFinite(hookRaw) ? Math.max(0, Math.min(1, hookRaw)) : 0;

    const top = isMfd ? h * 0.27 : h * 0.02;

    // Keep the 3 indicators centered, but make the total footprint narrower.
    const clusterCenterX = w * 0.5;
    const clusterW = isMfd ? w * 0.58 : w * 0.50;
    const gapGearToFlap = clusterW * (isMfd ? 0.07 : 0.06);
    const gapFlapToHook = clusterW * (isMfd ? 0.045 : 0.035); // hook closer to flap
    const blockW = (clusterW - gapGearToFlap - gapFlapToHook) / 3;
    const left = clusterCenterX - (clusterW * 0.5);

    const indicatorTopY = top;
    const indicatorBottomY = top + (isMfd ? h * 0.12 : h * 0.14);
    const textY = top + (isMfd ? h * 0.17 : h * 0.19);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = lineColor;
    ctx.fillStyle = lineColor;
    ctx.lineWidth = Math.max(1.5, w * 0.0025);
    ctx.setLineDash([]);

    const flapsLineWidth = isMfd ? 5 : 3;
    const hookLineWidth = isMfd ? 5 : 3;
    const dotRadius = isMfd ? 2.5 : Math.max(1.5, w * 0.0028);

    // --- GEAR indicator (3 boxes) ---
    const gearX = left;
    const boxW = blockW * (isMfd ? 0.13 : 0.11);
    const boxH = h * (isMfd ? 0.042 : 0.10);
    const topBoxX = gearX + blockW * 0.445;
    const topBoxY = indicatorTopY - (isMfd ? boxH * 0.80 : 0);
    const leftBoxX = gearX + blockW * 0.20;
    const leftBoxY = indicatorBottomY - boxH;
    const rightBoxX = gearX + blockW * 0.70;
    const rightBoxY = indicatorBottomY - boxH;

    const isGearDown = gearPos <= 0;
    const isGearUp = gearPos >= 1;
    const isGearTrans = !isGearDown && !isGearUp;
    const gearFill = isGearDown ? '#00ff00' : isGearTrans ? '#ff8a24' : null;

    const drawGearBox = (x, y) => {
      ctx.strokeRect(x, y, boxW, boxH);
      if (gearFill) {
        ctx.fillStyle = gearFill;
        ctx.fillRect(x + 1, y + 1, Math.max(0, boxW - 2), Math.max(0, boxH - 2));
        ctx.fillStyle = lineColor;
      }
    };

    drawGearBox(topBoxX, topBoxY);
    drawGearBox(leftBoxX, leftBoxY);
    drawGearBox(rightBoxX, rightBoxY);

    let gearStatus = 'GEAR UP';
    if (isGearDown) gearStatus = 'GEAR DOWN';
    else if (isGearTrans) gearStatus = 'GEAR TRANS';

    // --- FLAP indicator ---
    const flapX = gearX + blockW + gapGearToFlap;
    const flapWingY = top + (isMfd ? h * 0.03 : h * 0.045);
    const wingStartX = flapX + blockW * 0.08;
    const wingEndX = flapX + blockW * 0.62;
    const flapHingeX = wingEndX;
    const slatHingeX = wingStartX;
    const segmentLen = blockW * (isMfd ? 0.40 : 0.22);

    const flapMaxDeg = 45;
    const flapDeg = flapMaxDeg * flapsNorm;
    const flapRad = flapDeg * Math.PI / 180;
    const slatNorm = Math.max(0, Math.min(1, flapsPos));
    const slatMaxDeg = 30;

    // wing baseline
    const previousLineWidth = ctx.lineWidth;
    ctx.lineWidth = flapsLineWidth;
    ctx.beginPath();
    ctx.moveTo(wingStartX, flapWingY);
    ctx.lineTo(wingEndX, flapWingY);
    ctx.stroke();

    // slat line: continuous exact angle; position 1 is max deflection
    const slatDeg = slatMaxDeg * slatNorm;
    const slatRad = slatDeg * Math.PI / 180;
    const slatEndX = slatHingeX - Math.cos(slatRad) * (segmentLen * 0.55);
    const slatEndY = flapWingY + Math.sin(slatRad) * (segmentLen * 0.55);
    ctx.beginPath();
    ctx.moveTo(slatHingeX, flapWingY);
    ctx.lineTo(slatEndX, slatEndY);
    ctx.stroke();

    // flap line (continuous exact angle)
    const flapEndX = flapHingeX + Math.cos(flapRad) * segmentLen;
    const flapEndY = flapWingY + Math.sin(flapRad) * segmentLen;
    ctx.beginPath();
    ctx.moveTo(flapHingeX, flapWingY);
    ctx.lineTo(flapEndX, flapEndY);
    ctx.stroke();
    ctx.lineWidth = previousLineWidth;

    // detent dots: 0..maxPosition
    const detentCount = Math.max(1, Math.round(flapsMax));
    for (let i = 0; i <= detentCount; i++) {
      const t = i / detentCount;
      const a = (flapMaxDeg * t) * Math.PI / 180;
      const dx = Math.cos(a) * segmentLen;
      const dy = Math.sin(a) * segmentLen;
      const dotX = flapHingeX + dx;
      const dotY = flapWingY + dy;
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    let flapStatus = 'FLAPS UP';
    if (flapsPos >= flapsMax) {
      flapStatus = 'FLAPS DOWN';
    } else if (flapsPos > 0) {
      const nearest = Math.max(1, Math.min(detentCount - 1, Math.round(flapsPos)));
      flapStatus = `FLAPS ${nearest} / ${detentCount}`;
    }

    // --- HOOK indicator ---
    const hookX = flapX + blockW + gapFlapToHook;
    const hookWingY = flapWingY;
    const hookHingeX = hookX + blockW * 0.38;
    const hookLen = blockW * (isMfd ? 0.36 : 0.24);
    const hookRad = (45 * hookPos) * Math.PI / 180;

    const hookUpX = hookHingeX + hookLen;
    const hookUpY = hookWingY;
    const hookDownX = hookHingeX + Math.cos(Math.PI / 4) * hookLen;
    const hookDownY = hookWingY + Math.sin(Math.PI / 4) * hookLen;

    ctx.lineWidth = hookLineWidth;
    const hookEndX = hookHingeX + Math.cos(hookRad) * hookLen;
    const hookEndY = hookWingY + Math.sin(hookRad) * hookLen;
    ctx.beginPath();
    ctx.moveTo(hookHingeX, hookWingY);
    ctx.lineTo(hookEndX, hookEndY);
    ctx.stroke();
    ctx.lineWidth = previousLineWidth;

    ctx.beginPath();
    ctx.arc(hookUpX, hookUpY, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hookDownX, hookDownY, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    let hookStatus = 'HOOK UP';
    if (hookPos >= 1) {
      hookStatus = 'HOOK DOWN';
    } else if (hookPos > 0) {
      hookStatus = 'HOOK MOV';
    }

    // status labels on equal baseline
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * (isMfd ? 0.036 : 0.048))}px monospace`;

    const gearCenterX = gearX + blockW * 0.5;
    const flapCenterX = flapX + blockW * 0.5;
    const hookCenterX = hookX + blockW * 0.5;

    ctx.fillStyle = isGearTrans ? '#ff8a24' : lineColor;
    ctx.fillText(gearStatus, gearCenterX, textY);

    ctx.fillStyle = lineColor;
    ctx.fillText(flapStatus, flapCenterX, textY);
    ctx.fillText(hookStatus, hookCenterX, textY);

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
    const wpnMaster = getOption('WPN', 'MASTER', 'OFF');
    const wpnMode = getWpnModeFromOptions();
    const wpnModeLoadout = getWpnModeLoadout(wpnMode);
    const wpnHudStatus = wpnMaster !== 'OFF'
      ? {
          line1: `${wpnMaster === 'SIM' ? 'SIM' : 'ARM'} ${wpnMode}`,
          line2: getSelectedWpnQuantityLine(wpnMode, wpnModeLoadout)
        }
      : null;
    const hudBaseColor = getOptionValue('HUD', 'COLOR', DEFAULT_COLOR);
    const hudColor = applyBrightnessToHexColor(hudBaseColor, getMfdBrightnessFactor());
    const hudLevel = getOption('HUD', 'LEVEL', 'FULL');
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

    const communicationModule = getCommunicationModule();
    const commHudText = communicationModule?.getHudOverlayText?.();
    if (commHudText) {
      o.save();
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.fillStyle = currentHudColor;
      o.textAlign = 'center';
      o.textBaseline = 'bottom';
      o.font = `bold ${Math.round(h * 0.038)}px monospace`;
      const lines = String(commHudText ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
      const lineHeight = h * 0.045;
      const startY = h * 0.96 - ((lines.length - 1) * lineHeight);
      for (let i = 0; i < lines.length; i++) {
        o.fillText(lines[i], w * 0.5, startY + i * lineHeight);
      }
      o.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Class-based plugin structuur
  // ---------------------------------------------------------------------------

  class F18HudModule {
    static HUD_PHYSICAL_HEIGHT_M = 0.30;
    static HUD_PARALLAX_GAIN = 1.65;

    // Prepares HUD module state and renderer references.
    constructor() {
      this.originalRenderer = null;
      this.installed = false;
    }

    // Installs the custom HUD renderer while preserving the original one.
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
        if (!isF18Active() || getOption('HUD', 'HUD', 'F-18') === 'DEFAULT') {
          return self.originalRenderer.call(this, renderer);
        }
        renderF18Hud(renderer);
      };

      this.installed = true;
      return true;
    }

    getMode() {
      return getOption('HUD', 'HUD', 'F-18');
    }

    setMode(mode) {
      setOption('HUD', 'HUD', mode);
      this.ensureLoaded();
      return mode;
    }

    // Ensures the HUD renderer is installed and active.
    ensureLoaded() {
      if (getOption('HUD', 'HUD', 'F-18') === 'DEFAULT') {
        this.restore();
        return true;
      }

      if (!this.install()) {
        return false;
      }
      return true;
    }

    // Restores the original HUD renderer and clears install state.
    restore() {
      if (this.originalRenderer && window.instruments?.renderers) {
        window.instruments.renderers.genericHUD = this.originalRenderer;
      }
      this.originalRenderer = null;
      this.installed = false;
    }
  }

  class CameraModule {
    static DEFAULT_HUD_CAMERA_Z = 0.95;
    static CAMERA_STEP_Z = 0.005;
    static CAMERA_UP_BUTTON_ID = 'f18-hud-camera-up';
    static CAMERA_DOWN_BUTTON_ID = 'f18-hud-camera-down';
    static CAMERA_VIEW_BUTTON_ID = 'f18-cockpit-view-cycle';

    static COCKPIT_VIEW_PRESETS = [
      {
        name: 'DEFAULT',
        position: [0, 5.5, 0.95],
        orientation: [0, -15, 0],
        FOV: 1.7
      },
      {
        name: 'MFD',
        position: [0, 5.7, 0.78],
        orientation: [0.7, -34.48, 0],
        FOV: 1.7
      },
      {
        name: 'THR/JOY',
        position: [-0.17, 5.4, 0.3],
        orientation: [0, -8, 0],
        FOV: 1.7
      },
      {
        name: 'SEAT-SIDE',
        position: [0.38, 5, 0.8],
        orientation: [-20, -13, 0],
        FOV: 2
      },
      {
        name: 'LOOK-BACK',
        position: [0.9, 4.86, 0.6],
        orientation: [-211, -2.3, 0],
        FOV: 2
      }
    ];

    static CAMERA_MODE_DEFINITIONS = {
      6: {
        distance: 0,
        FOV: 10,
        insideView: false,
        mode: 6,
        name: 'Nose cam',
        offsetBounds: [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
        offsets: {
          current: [0, 0.5, -1],
          last: [0, 0.5, 0],
          neutral: [0, 0.5, 0]
        },
        orientation: [180, 20, -1.5],
        orientations: {
          current: [180, 20, 0],
          last: [180, 20, 0],
          neutral: [180, 20, 0]
        },
        position: [0, 11.55, -1.5],
        view: 'Nose cam'
      },
      7: {
        distance: 0,
        FOV: 10,
        insideView: false,
        mode: 7,
        name: 'Cockpit Rear',
        offsetBounds: [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
        offsets: {
          current: [0, 0.5, -1],
          last: [0, 0.5, 0],
          neutral: [0, 0.5, 0]
        },
        orientation: [180, -15, -1.5],
        orientations: {
          current: [180, -15, 0],
          last: [180, -15, 0],
          neutral: [180, -15, 0]
        },
        position: [0, 5, 3.4],
        view: 'Cockpit Rear'
      },
      8: {
        distance: 0,
        FOV: 10,
        insideView: false,
        mode: 8,
        name: 'Wingman',
        offsetBounds: [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
        offsets: {
          current: [0, 0.5, -1],
          last: [0, 0.5, 0],
          neutral: [0, 0.5, 0]
        },
        orientation: [115, -12, 0],
        orientations: {
          current: [115, -15, 0],
          last: [115, -15, 0],
          neutral: [115, -15, 0]
        },
        position: [1, 4, -0.3],
        view: 'Wingman'
      },
      9: {
        distance: 0,
        FOV: 2,
        insideView: false,
        mode: 9,
        name: 'Down Rear',
        offsetBounds: [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
        offsets: {
          current: [0, 0.5, -1],
          last: [0, 0.5, 0],
          neutral: [0, 0.5, 0]
        },
        orientation: [180, 20, -1.5],
        orientations: {
          current: [180, 20, 0],
          last: [180, 20, 0],
          neutral: [180, 20, 0]
        },
        position: [0, 4, -1],
        view: 'Down Rear'
      },
      10: {
        distance: 0,
        FOV: 2,
        insideView: false,
        mode: 10,
        name: 'Gun cam',
        offsetBounds: [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
        offsets: {
          current: [0, -6, -1],
          last: [0, 0.5, 0],
          neutral: [0, 0.5, 0]
        },
        orientation: [10, 0, 0],
        orientations: {
          current: [10, 0, 0],
          last: [0, 20, 0],
          neutral: [0, 20, 0]
        },
        position: [3, 4.5, 1.85],
        view: 'Gun cam'
      },
      11: {
        distance: 0,
        FOV: 10,
        insideView: false,
        mode: 11,
        name: 'Wing cam',
        offsetBounds: [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
        offsets: {
          current: [0, -5, -1],
          last: [0, 0.5, 0],
          neutral: [0, 0.5, 0]
        },
        orientation: [30, 35, 0],
        orientations: {
          current: [30, 35, 0],
          last: [0, 20, 0],
          neutral: [0, 20, 0]
        },
        position: [-6, 0, 0.1],
        view: 'Wing cam'
      }
    };

    constructor(helperModule) {
      this.helperModule = helperModule;
      this.installed = false;
      this.originalModesByIndex = new Map();
      this.boundModesRef = null;
      this.cockpitViewIndex = 0;
      this.cockpitViewControlsWrapperId = 'f18-cockpit-view-controls';
      this.cockpitViewApplied = false;
    }

    createCameraPadButton(label, id, onClick) {
      const outerStyle = {};
      if (label === 'UP') {
        outerStyle.borderBottom = '1px solid #333';
        outerStyle.borderRadius = '15px 15px 0 0';
      } else if (label === 'DOWN') {
        outerStyle.marginTop = '-9px';
        outerStyle.borderRadius = '0 0 15px 15px';
        outerStyle.borderTop = '0';
      }

      return this.helperModule?.createPadButton({
        label,
        id,
        onClick,
        outerStyle
      }) ?? null;
    }

    installCameraControls() {
      if (document.getElementById('f18-hud-camera-controls')) return true;
      if (!this.helperModule) return false;

      const wrapper = document.createElement('div');
      wrapper.id = 'f18-hud-camera-controls';
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '4px';
      wrapper.style.alignItems = 'flex-start';

      const upButton = this.createCameraPadButton('UP', CameraModule.CAMERA_UP_BUTTON_ID, () => {
        adjustHudCameraZ(CameraModule.CAMERA_STEP_Z);
      });
      const seatLabelButton = this.helperModule?.createPadButton({
        label: 'SEAT',
        id: 'f18-seat-label',
        onClick: () => {},
        outerStyle: {
          marginTop: '-9px',
          borderRadius: '0',
          borderTop: '0',
          cursor: 'default',
          pointerEvents: 'none'
        },
        innerStyle: {
          fontWeight: '700'
        }
      });
      const downButton = this.createCameraPadButton('DOWN', CameraModule.CAMERA_DOWN_BUTTON_ID, () => {
        adjustHudCameraZ(-CameraModule.CAMERA_STEP_Z);
      });

      if (!upButton || !seatLabelButton || !downButton) return false;

      wrapper.appendChild(upButton);
      wrapper.appendChild(seatLabelButton);
      wrapper.appendChild(downButton);
      return this.helperModule.installPadControl({
        id: wrapper.id,
        element: wrapper,
        prepend: true
      });
    }

    installCockpitViewControls() {
      if (document.getElementById(this.cockpitViewControlsWrapperId)) return true;
      if (!this.helperModule) return false;

      const wrapper = document.createElement('div');
      wrapper.id = this.cockpitViewControlsWrapperId;
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '0px';
      wrapper.style.alignItems = 'flex-start';

      const viewButton = this.helperModule?.createPadButton({
        label: 'VIEW',
        id: CameraModule.CAMERA_VIEW_BUTTON_ID,
        onClick: () => {
          this.nextCockpitView();
        },
        outerStyle: {
          borderRadius: '15px'
        },
        innerStyle: {
          fontWeight: '700'
        }
      });

      if (!viewButton) return false;
      wrapper.appendChild(viewButton);

      return this.helperModule.installPadControl({
        id: wrapper.id,
        element: wrapper,
        prepend: true
      });
    }

    removeCameraControls() {
      this.helperModule?.removePadControl('f18-hud-camera-controls');
    }

    removeCockpitViewControls() {
      this.helperModule?.removePadControl(this.cockpitViewControlsWrapperId);
    }

    applyCockpitViewByIndex(index = 0) {
      const mode = window.geofs?.camera?.modes?.[1];
      if (!mode) return false;

      const views = CameraModule.COCKPIT_VIEW_PRESETS;
      const safeIndex = clampValue(Math.floor(Number(index) || 0), 0, views.length - 1);
      const preset = views[safeIndex];
      if (!preset) return false;

      mode.position = Array.isArray(preset.position) ? [...preset.position] : [0, 5.5, CameraModule.DEFAULT_HUD_CAMERA_Z];
      mode.offsets = mode.offsets && typeof mode.offsets === 'object' ? mode.offsets : {};
      mode.offsets.current = [0, 0, 0];
      mode.orientations = mode.orientations && typeof mode.orientations === 'object' ? mode.orientations : {};
      mode.orientations.current = Array.isArray(preset.orientation) ? [...preset.orientation] : [0, -15, 0];
      mode.orientation = Array.isArray(preset.orientation) ? [...preset.orientation] : [0, -15, 0];
      mode.FOV = Number.isFinite(Number(preset.FOV)) ? Number(preset.FOV) : 1.7;

      this.cockpitViewIndex = safeIndex;
      return true;
    }

    nextCockpitView() {
      const views = CameraModule.COCKPIT_VIEW_PRESETS;
      const next = (this.cockpitViewIndex + 1) % views.length;
      const ok = this.applyCockpitViewByIndex(next);
      if (ok) this.cockpitViewApplied = true;
      return ok;
    }

    isAircraftCameraReady() {
      const aircraft = window.geofs?.aircraft?.instance;
      const parts = aircraft?.parts;
      const mode1 = window.geofs?.camera?.modes?.[1];
      return Boolean(parts && Object.keys(parts).length > 0 && mode1?.position);
    }

    hasCustomModes(modes) {
      if (!modes) return false;
      return Object.entries(CameraModule.CAMERA_MODE_DEFINITIONS).every(([indexKey, definition]) => {
        const index = Number(indexKey);
        const current = modes[index];
        return Boolean(current && current.name === definition.name && current.view === definition.view);
      });
    }

    ensureLoaded() {
      if (!isF18Active()) {
        this.removeCameraControls();
        this.removeCockpitViewControls();
        return false;
      }

      const modes = window.geofs?.camera?.modes;
      if (!modes) return false;
      if (!this.isAircraftCameraReady()) return false;

      const isCockpitView = window.geofs?.camera?.currentModeName === 'cockpit';
      if (isCockpitView) {
        if (!this.installCameraControls()) return false;
        if (!this.installCockpitViewControls()) return false;
      } else {
        this.removeCameraControls();
        this.removeCockpitViewControls();
        this.cockpitViewApplied = false;
      }

      const modesRefChanged = this.boundModesRef && this.boundModesRef !== modes;
      const customModesPresent = this.hasCustomModes(modes);

      if (this.installed && !modesRefChanged && customModesPresent) {
        return true;
      }

      if (!this.installed || modesRefChanged) {
        this.originalModesByIndex.clear();
      }

      for (const [indexKey, definition] of Object.entries(CameraModule.CAMERA_MODE_DEFINITIONS)) {
        const index = Number(indexKey);
        if (!Number.isInteger(index)) continue;

        if (!this.originalModesByIndex.has(index)) {
          const hasOriginalMode = Object.prototype.hasOwnProperty.call(modes, index);
          this.originalModesByIndex.set(index, {
            exists: hasOriginalMode,
            value: hasOriginalMode ? deepCloneJson(modes[index]) : null
          });
        }

        modes[index] = deepCloneJson(definition);
      }

      this.installed = true;
      this.boundModesRef = modes;

      if (isCockpitView && (!this.cockpitViewApplied || modesRefChanged || !customModesPresent)) {
        this.applyCockpitViewByIndex(this.cockpitViewIndex);
        this.cockpitViewApplied = true;
      }
      return true;
    }

    restore() {
      this.removeCameraControls();
      this.removeCockpitViewControls();

      if (!this.installed && this.originalModesByIndex.size === 0) return;

      const modes = window.geofs?.camera?.modes;
      if (modes && (!this.boundModesRef || modes === this.boundModesRef)) {
        for (const [index, originalState] of this.originalModesByIndex.entries()) {
          if (originalState?.exists) {
            modes[index] = deepCloneJson(originalState.value);
          } else {
            delete modes[index];
          }
        }
      }

      this.originalModesByIndex.clear();
      this.installed = false;
      this.boundModesRef = null;
      this.cockpitViewApplied = false;
    }
  }

  class FMCModule {
    constructor() {
      this.installed = false;
      this.timer = null;
      this.lastFlapsMode = null;
      this.lastAutoTarget = null;
      this.originalSetPartAnimationDelta = null;
      this.airbrakeDeltaHookInstalled = false;
    }

    ensureLoaded() {
      if (this.installed) return true;
      this.installed = true;
      this.startLoop();
      return true;
    }

    startLoop() {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick(), 120);
    }

    stopLoop() {
      if (!this.timer) return;
      clearInterval(this.timer);
      this.timer = null;
    }

    getFlapsMode() {
      return getOption('SYS', 'FLAPS', 'MAN');
    }

    getSpeedbrakeCapNormalized() {
      const raw = String(getOption('SYS', 'SPEEDBRAKE', 'MAX') ?? 'MAX').trim().toUpperCase();
      if (raw === 'MAX') return 1;

      const percentMatch = raw.match(/^(\d+(?:\.\d+)?)%$/);
      if (percentMatch) {
        const pct = Number(percentMatch[1]);
        if (Number.isFinite(pct)) {
          return clampValue(pct / 100, 0, 1);
        }
      }

      // Safe fallback: no limitation when option is unknown.
      return 1;
    }

    installAirbrakeDeltaHook(controlsApi) {
      if (!controlsApi || typeof controlsApi.setPartAnimationDelta !== 'function') return false;
      if (this.airbrakeDeltaHookInstalled) return true;

      this.originalSetPartAnimationDelta = controlsApi.setPartAnimationDelta;
      const self = this;

      controlsApi.setPartAnimationDelta = function (part) {
        const airbrakes = controlsApi.airbrakes;
        if (part && airbrakes && part === airbrakes) {
          const cap = self.getSpeedbrakeCapNormalized();

          const target = Number(airbrakes.target);
          if (Number.isFinite(target) && target > cap) {
            airbrakes.target = cap;
          }

          const positionTarget = Number(airbrakes.positionTarget);
          if (Number.isFinite(positionTarget) && positionTarget > cap) {
            airbrakes.positionTarget = cap;
          }
        }

        return self.originalSetPartAnimationDelta.call(this, part);
      };

      this.airbrakeDeltaHookInstalled = true;
      return true;
    }

    enforceAirbrakeTargetCap(controlsApi) {
      const airbrakes = controlsApi?.airbrakes;
      if (!airbrakes) return;

      const cap = this.getSpeedbrakeCapNormalized();
      let changed = false;

      const target = Number(airbrakes.target);
      if (Number.isFinite(target) && target > cap) {
        airbrakes.target = cap;
        changed = true;
      }

      const positionTarget = Number(airbrakes.positionTarget);
      if (Number.isFinite(positionTarget) && positionTarget > cap) {
        airbrakes.positionTarget = cap;
        changed = true;
      }

      if (changed && typeof controlsApi.setPartAnimationDelta === 'function') {
        controlsApi.setPartAnimationDelta(airbrakes);
      }
    }

    uninstallAirbrakeDeltaHook() {
      const controlsApi = window.controls;
      if (this.airbrakeDeltaHookInstalled && controlsApi && this.originalSetPartAnimationDelta) {
        controlsApi.setPartAnimationDelta = this.originalSetPartAnimationDelta;
      }
      this.originalSetPartAnimationDelta = null;
      this.airbrakeDeltaHookInstalled = false;
    }

    computeAutoFlapsTarget() {
      const controlsApi = window.controls;
      const maxPositionRaw = Number(controlsApi?.flaps?.maxPosition);
      const maxPosition = Number.isFinite(maxPositionRaw) && maxPositionRaw > 0 ? maxPositionRaw : 1;

      const anim = window.geofs?.animation?.values ?? {};
      const kias = Number(anim.kias);
      const aoa = Number(anim.aoa);
      const gLoad = Number(anim.loadFactor);
      const mach = Number(anim.mach);

      // Hard speed-gate from spec: above 250 KIAS flaps should stay up.
      if (Number.isFinite(kias) && kias >= 250) {
        return 0;
      }

      // Under 130 KIAS always command full flaps.
      if (Number.isFinite(kias) && kias <= 130) {
        return maxPosition;
      }

      // Gradual speed schedule (250 -> ~0, 200 -> very small, 130 -> 1).
      const speedFactor = Number.isFinite(kias)
        ? Math.pow(clampValue((250 - kias) / 120, 0, 1), 2.6)
        : 0;
      const aoaFactor = Number.isFinite(aoa)
        ? clampValue((aoa - 6) / 10, 0, 1)
        : 0;
      const gFactor = Number.isFinite(gLoad)
        ? clampValue((gLoad - 1.15) / 3.0, 0, 1)
        : 0;

      // Mach contributes only at very low Mach, so it won't dominate around ~200 KIAS.
      const machFactor = Number.isFinite(mach)
        ? Math.pow(clampValue((0.28 - mach) / 0.12, 0, 1), 2)
        : 0;

      // Use the maximum demand of the four factors (no weighted combination).
      const normalized = Math.max(speedFactor, aoaFactor, gFactor, machFactor);
      return normalized * maxPosition;
    }

    applyFlapsTarget(target) {
      const controlsApi = window.controls;
      const flaps = controlsApi?.flaps;
      if (!flaps || typeof controlsApi?.setPartAnimationDelta !== 'function') return;

      const maxPositionRaw = Number(flaps?.maxPosition);
      const maxPosition = Number.isFinite(maxPositionRaw) && maxPositionRaw > 0 ? maxPositionRaw : 1;
      const clampedTarget = clampValue(Number(target) || 0, 0, maxPosition);

      if (this.lastAutoTarget != null && Math.abs(this.lastAutoTarget - clampedTarget) < 0.015) {
        return;
      }

      flaps.positionTarget = clampedTarget;
      controlsApi.setPartAnimationDelta(flaps);
      this.lastAutoTarget = clampedTarget;
    }

    tick() {
      if (!isF18Active()) {
        this.lastFlapsMode = null;
        this.lastAutoTarget = null;
        return;
      }

      const controlsApi = window.controls;
      if (!controlsApi) return;

      this.installAirbrakeDeltaHook(controlsApi);

      if (controlsApi.flaps) {
        const flapsMode = this.getFlapsMode();
        if (flapsMode === 'AUTO') {
          const target = this.computeAutoFlapsTarget();
          this.applyFlapsTarget(target);
        } else if (this.lastFlapsMode === 'AUTO') {
          // Critical handback behavior: reset to 0 when leaving AUTO,
          // otherwise manual mode can stay latched.
          this.lastAutoTarget = null;
          this.applyFlapsTarget(0);
        }

        this.lastFlapsMode = flapsMode;
      } else {
        this.lastFlapsMode = null;
      }

      // Override max speedbrake effectiveness based on SYS.SPEEDBRAKE option.
      // Cap targets (not live position) to avoid visible oscillation/jitter.
      this.enforceAirbrakeTargetCap(controlsApi);
    }

    restore() {
      this.stopLoop();
      this.uninstallAirbrakeDeltaHook();

      if (isF18Active()) {
        this.lastAutoTarget = null;
        this.applyFlapsTarget(0);
      }

      this.lastFlapsMode = null;
      this.installed = false;
    }
  }

  class ControlModule {
    constructor(helperModule = null) {
      this.helperModule = helperModule;
      this.installed = false;
      this.timer = null;
      this.controls = new Map();
      this.lastAircraftId = null;
      this.probeControlsWrapperId = 'f18-probe-controls';
      this.registerDefaultControls();
    }

    registerDefaultControls() {
      this.registerControl({
        key: 'SYS.REFUELING',
        defaultState: 'CLOSED',
        durationMs: 1200,
        parts: [
          {
            partName: 'Probe',
            motion: {
              OPEN: { delayMs: 2600, durationMs: 2200 },
              CLOSED: { delayMs: 0, durationMs: 2200 }
            },
            channels: {
              ProbeRotXDeg: { OPEN: -40, CLOSED: 0 },
              ProbeRotYDeg: { OPEN: 10, CLOSED: 0 },
              ProbeRotZDeg: { OPEN: 20, CLOSED: 0 }
            }
          },
          {
            partName: 'RefDoor1',
            motion: {
              OPEN: { delayMs: 2600, durationMs: 2200 },
              CLOSED: { delayMs: 0, durationMs: 2200 }
            },
            channels: {
              RefDoor1RotXDeg: { OPEN: -40, CLOSED: 0 },
              RefDoor1RotYDeg: { OPEN: 10, CLOSED: 0 },
              RefDoor1RotZDeg: { OPEN: 30, CLOSED: 0 }
            }
          },
          {
            partName: 'RefDoor2',
            motion: {
              OPEN: { delayMs: 0, durationMs: 2000 },
              CLOSED: { delayMs: 2400, durationMs: 2000 }
            },
            channels: {
              RefDoor2RotXDeg: { OPEN: -10, CLOSED: 0 },
              RefDoor2RotYDeg: { OPEN: 60, CLOSED: 0 },
              RefDoor2RotZDeg: { OPEN: -20, CLOSED: 0 }
            }
          }
        ]
      });

      this.registerControl({
        key: 'SYS.CANOPY',
        defaultState: 'CLOSED',
        durationMs: 6000,
        parts: [
          {
            partName: 'CanopyFrameCockpit',
            motion: {
              OPEN: { delayMs: 1000, durationMs: 5000 },
              CLOSED: { delayMs: 1000, durationMs: 5000 }
            },
            channels: {
              CanopyFrameCockpitRotXDeg: { OPEN: 30, CLOSED: 0 },
              CanopyFrameCockpitRotYDeg: { OPEN: 0, CLOSED: 0 },
              CanopyFrameCockpitRotZDeg: { OPEN: 0, CLOSED: 0 }
            }
          }
        ]
      });
    }

    registerControl(definition) {
      const key = String(definition?.key || '');
      if (!key) return false;

      const control = {
        key,
        defaultState: String(definition?.defaultState || 'CLOSED'),
        durationMs: Math.max(0, Number(definition?.durationMs) || 0),
        parts: Array.isArray(definition?.parts) ? definition.parts : [],
        runtime: {
          initialized: false,
          currentState: null,
          targetState: null,
          transitionStartMs: 0,
          timingByValueKey: Object.create(null),
          fromValues: Object.create(null),
          toValues: Object.create(null),
          currentValues: Object.create(null)
        }
      };

      this.controls.set(key, control);
      return true;
    }

    ensureLoaded() {
      if (this.installed) return true;
      this.installed = true;
      this.installProbeControls();
      this.startLoop();
      return true;
    }

    setProbeState(state) {
      const value = String(state || '');
      if (value !== 'OPEN' && value !== 'CLOSED') return false;
      setOption('SYS', 'REFUELING', value);
      return true;
    }

    createProbePadButton(label, id, onClick, outerStyle = {}, innerStyle = {}) {
      return this.helperModule?.createPadButton({
        label,
        id,
        onClick,
        outerStyle,
        innerStyle
      }) ?? null;
    }

    installProbeControls() {
      if (!this.helperModule || !isF18Active()) return false;
      if (document.getElementById(this.probeControlsWrapperId)) return true;

      const wrapper = document.createElement('div');
      wrapper.id = this.probeControlsWrapperId;
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '0px';
      wrapper.style.alignItems = 'flex-start';

      const openButton = this.createProbePadButton('OPEN', 'f18-probe-open', () => {
        this.setProbeState('OPEN');
      }, {
        borderBottom: '1px solid #333',
        borderRadius: '15px 15px 0 0'
      });

      const probeLabel = this.createProbePadButton('PROBE', 'f18-probe-label', () => {}, {
        marginTop: '-9px',
        borderRadius: '0',
        borderTop: '0',
        cursor: 'default',
        pointerEvents: 'none'
      }, {
        fontWeight: '700'
      });

      const closeButton = this.createProbePadButton('CLOSE', 'f18-probe-close', () => {
        this.setProbeState('CLOSED');
      }, {
        marginTop: '-9px',
        borderRadius: '0 0 15px 15px',
        borderTop: '0'
      });

      if (!openButton || !probeLabel || !closeButton) return false;

      wrapper.appendChild(openButton);
      wrapper.appendChild(probeLabel);
      wrapper.appendChild(closeButton);

      return this.helperModule.installPadControl({
        id: wrapper.id,
        element: wrapper,
        prepend: true
      });
    }

    removeProbeControls() {
      this.helperModule?.removePadControl(this.probeControlsWrapperId);
    }

    startLoop() {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick(), 50);
    }

    stopLoop() {
      if (!this.timer) return;
      clearInterval(this.timer);
      this.timer = null;
    }

    parseConfigKey(configKey) {
      const raw = String(configKey || '');
      const [page, key] = raw.split('.');
      return {
        page: String(page || ''),
        key: String(key || '')
      };
    }

    getRequestedState(control) {
      const tokens = this.parseConfigKey(control?.key);
      if (!tokens.page || !tokens.key) return control.defaultState;

      const runtime = control?.runtime || {};
      const raw = getOption(tokens.page, tokens.key, null);
      if (raw == null || raw === '') {
        return String(runtime.targetState || runtime.currentState || control.defaultState);
      }

      return String(raw);
    }

    getAnimationValue(valueKey, fallback = 0) {
      const raw = Number(window.geofs?.animation?.values?.[valueKey]);
      return Number.isFinite(raw) ? raw : Number(fallback) || 0;
    }


    getControlByKey(key) {
      if (!key) return null;
      return this.controls.get(key) || null;
    }

    getControlSnapshot(controlKey) {
      const control = this.getControlByKey(controlKey);
      if (!control) return null;
      return {
        key: control.key,
        defaultState: control.defaultState,
        durationMs: control.durationMs,
        parts: JSON.parse(JSON.stringify(control.parts || [])),
        runtime: {
          initialized: !!control.runtime?.initialized,
          currentState: control.runtime?.currentState ?? null,
          targetState: control.runtime?.targetState ?? null,
          currentValues: { ...(control.runtime?.currentValues || {}) }
        }
      };
    }

    setControlDuration(controlKey, durationMs) {
      const control = this.getControlByKey(controlKey);
      if (!control) return false;
      const next = Math.max(0, Number(durationMs) || 0);
      control.durationMs = next;
      return true;
    }

    setChannelValue(controlKey, partName, valueKey, state, value) {
      const control = this.getControlByKey(controlKey);
      if (!control) return false;

      const numericValue = Number(value);
      if (!partName || !valueKey || !state || !Number.isFinite(numericValue)) return false;

      const partDef = control.parts.find((p) => p.partName === partName);
      if (!partDef) return false;

      partDef.channels = partDef.channels || {};
      partDef.channels[valueKeyNorm] = partDef.channels[valueKeyNorm] || {};
      partDef.channels[valueKeyNorm][stateNorm] = numericValue;
      return true;
    }

    setChannelValueByValueKey(controlKey, valueKey, state, value) {
      const control = this.getControlByKey(controlKey);
      if (!control) return false;

      const valueKeyNorm = String(valueKey || '').trim();
      const stateNorm = String(state || '').trim();
      const numericValue = Number(value);
      if (!valueKeyNorm || !stateNorm || !Number.isFinite(numericValue)) return false;

      const matches = control.parts.filter((p) => Object.prototype.hasOwnProperty.call(p?.channels || {}, valueKeyNorm));
      if (matches.length !== 1) {
        return false;
      }

      const partDef = matches[0];
      partDef.channels = partDef.channels || {};
      partDef.channels[valueKeyNorm] = partDef.channels[valueKeyNorm] || {};
      partDef.channels[valueKeyNorm][stateNorm] = numericValue;
      return true;
    }

    setPartTiming(controlKey, partName, state, delayMs, durationMs) {
      const control = this.getControlByKey(controlKey);
      if (!control) return false;

      const partNameNorm = String(partName || '').trim();
      const stateNorm = String(state || '').trim();
      const delay = Number(delayMs);
      const duration = Number(durationMs);
      if (!partNameNorm || !stateNorm) return false;

      const partDef = control.parts.find((p) => String(p?.partName || '').trim() === partNameNorm);
      if (!partDef) return false;

      partDef.motion = partDef.motion || {};
      partDef.motion[stateNorm] = {
        delayMs: Number.isFinite(delay) ? Math.max(0, delay) : 0,
        durationMs: Number.isFinite(duration) ? Math.max(1, duration) : Math.max(1, Number(control.durationMs) || 1)
      };
      return true;
    }

    reanimateControlToOption(controlKey) {
      const control = this.getControlByKey(controlKey);
      if (!control) return false;
      control.runtime.initialized = false;
      return true;
    }

    reanimateAllControlsToOption() {
      for (const control of this.controls.values()) {
        control.runtime.initialized = false;
      }
      return true;
    }

    findNodeNameLoose(model, wanted) {
      const target = String(wanted || '').trim();
      if (!target || !model) return null;

      const tries = [target, target.toLowerCase(), target.toUpperCase()];
      for (const candidate of tries) {
        const node = model.getNode(candidate);
        if (node) return String(node.name || node._name || node.id || target);
      }

      const wantedLow = target.toLowerCase();
      const arr = model._runtime?.nodes || model._nodes || [];
      for (const node of arr) {
        const nodeName = String(node?.name || node?._name || node?.id || '').trim();
        if (nodeName && nodeName.toLowerCase() === wantedLow) return nodeName;
      }

      return null;
    }

    ensurePartExists(partName) {
      const aircraft = window.geofs?.aircraft?.instance;
      const model = aircraft?.object3d?.model?._model;
      if (!aircraft || !model) return null;

      let part = aircraft.parts?.[partName] || null;
      if (part?.object3d) return part;

      const nodeName = this.findNodeNameLoose(model, partName);
      if (!nodeName) return null;

      const partDef = {
        name: partName,
        node: nodeName,
        parent: 'root',
        animations: []
      };

      aircraft.definition.parts = Array.isArray(aircraft.definition?.parts) ? aircraft.definition.parts : [];
      if (!aircraft.definition.parts.some((p) => String(p?.name || '') === partName)) {
        aircraft.definition.parts.push(partDef);
      }

      aircraft.addParts([partDef], aircraft.aircraftRecord?.fullPath, aircraft.definition?.scale || 1, aircraft.definition?.orientation);

      part = aircraft.parts?.[partName] || null;
      return part?.object3d ? part : null;
    }

    inferAxisFromValueKey(valueKey) {
      const m = String(valueKey || '').match(/Rot([XYZ])Deg$/i);
      return m ? m[1].toUpperCase() : null;
    }

    ensurePartAnimations(partName, channels) {
      const part = this.ensurePartExists(partName);
      if (!part?.object3d) return null;

      part.animations = Array.isArray(part.animations) ? part.animations : [];

      for (const valueKey of Object.keys(channels || {})) {
        const axis = this.inferAxisFromValueKey(valueKey);
        if (!axis) continue;

        const existing = part.animations.some((a) => String(a?.value || '') === valueKey);
        if (existing) continue;

        const rotationMethod = part.object3d[`rotate${axis}`];
        if (typeof rotationMethod !== 'function') continue;

        part.animations.push({
          name: valueKey,
          type: 'rotate',
          axis,
          value: valueKey,
          rotationMethod
        });
      }

      return part;
    }

    ensureControlBindings(control) {
      let allBound = true;

      for (const partDef of control.parts || []) {
        const channels = partDef?.channels || {};
        const part = this.ensurePartAnimations(partDef?.partName, channels);
        if (!part?.object3d) {
          allBound = false;
          continue;
        }

        for (const valueKey of Object.keys(channels)) {
          const exists = (part.animations || []).some((a) => String(a?.value || '') === String(valueKey));
          if (!exists) {
            allBound = false;
          }
        }
      }

      return allBound;
    }

    buildTargetValues(control, state) {
      const targetState = String(state || control.defaultState).toUpperCase();
      const values = Object.create(null);

      for (const partDef of control.parts) {
        this.ensurePartAnimations(partDef?.partName, partDef?.channels);
        const channels = partDef?.channels || {};
        for (const [valueKey, byState] of Object.entries(channels)) {
          const fallback = Number(byState?.[control.defaultState]);
          const raw = byState?.[targetState];
          const target = Number(raw);
          values[valueKey] = Number.isFinite(target)
            ? target
            : (Number.isFinite(fallback) ? fallback : 0);
        }
      }

      return values;
    }

    resolvePartMotion(partDef, targetState, control) {
      const state = String(targetState || control?.defaultState || 'CLOSED').toUpperCase();
      const cfg = partDef?.motion?.[state] || {};
      const delayRaw = Number(cfg?.delayMs);
      const durationRaw = Number(cfg?.durationMs);
      const fallbackDuration = Math.max(1, Number(control?.durationMs) || 1);

      return {
        delayMs: Number.isFinite(delayRaw) ? Math.max(0, delayRaw) : 0,
        durationMs: Number.isFinite(durationRaw) ? Math.max(1, durationRaw) : fallbackDuration
      };
    }

    buildTimingByValueKey(control, targetState) {
      const map = Object.create(null);

      for (const partDef of control.parts || []) {
        const channels = partDef?.channels || {};
        const timing = this.resolvePartMotion(partDef, targetState, control);
        for (const valueKey of Object.keys(channels)) {
          map[valueKey] = {
            delayMs: timing.delayMs,
            durationMs: timing.durationMs
          };
        }
      }

      return map;
    }

    applyCurrentValues(runtime) {
      for (const [valueKey, value] of Object.entries(runtime.currentValues || {})) {
        window.geofs?.animation?.setValue?.(valueKey, Number(value) || 0);
      }
    }

    updateControl(control, nowMs) {
      const runtime = control.runtime;

      const hasBindings = this.ensureControlBindings(control);
      if (!hasBindings) {
        runtime.initialized = false;
        return;
      }

      const requestedState = this.getRequestedState(control);

      if (!runtime.initialized) {
        const initialTargetValues = this.buildTargetValues(control, requestedState);
        const initialFromValues = Object.create(null);
        for (const key of Object.keys(initialTargetValues || {})) {
          initialFromValues[key] = this.getAnimationValue(key, initialTargetValues[key]);
        }

        runtime.initialized = true;
        runtime.currentState = null;
        runtime.targetState = requestedState;
        runtime.timingByValueKey = this.buildTimingByValueKey(control, requestedState);
        runtime.fromValues = { ...initialFromValues };
        runtime.toValues = { ...initialTargetValues };
        runtime.currentValues = { ...initialFromValues };
        runtime.transitionStartMs = nowMs;

        if (Math.max(0, Number(control.durationMs) || 0) === 0) {
          runtime.currentState = requestedState;
          runtime.currentValues = { ...runtime.toValues };
          this.applyCurrentValues(runtime);
        }
        return;
      }

      if (requestedState !== runtime.targetState) {
        runtime.fromValues = { ...runtime.currentValues };
        runtime.toValues = this.buildTargetValues(control, requestedState);
        runtime.timingByValueKey = this.buildTimingByValueKey(control, requestedState);
        runtime.transitionStartMs = nowMs;
        runtime.targetState = requestedState;
      }

      if (runtime.targetState !== runtime.currentState) {
        const elapsedMs = Math.max(0, nowMs - runtime.transitionStartMs);
        const keys = new Set([...Object.keys(runtime.fromValues || {}), ...Object.keys(runtime.toValues || {})]);
        let allDone = true;

        for (const key of keys) {
          const from = Number(runtime.fromValues?.[key]);
          const to = Number(runtime.toValues?.[key]);
          const a = Number.isFinite(from) ? from : 0;
          const b = Number.isFinite(to) ? to : 0;

          const timing = runtime.timingByValueKey?.[key] || { delayMs: 0, durationMs: Math.max(1, Number(control.durationMs) || 1) };
          const delayMs = Math.max(0, Number(timing?.delayMs) || 0);
          const durationMs = Math.max(1, Number(timing?.durationMs) || 1);
          const localT = Math.max(0, Math.min(1, (elapsedMs - delayMs) / durationMs));

          runtime.currentValues[key] = a + (b - a) * localT;
          if (localT < 1) allDone = false;
        }

        if (allDone) {
          runtime.currentState = runtime.targetState;
          runtime.currentValues = { ...runtime.toValues };
        }
      }

      this.applyCurrentValues(runtime);
    }

    tick() {
      if (!isF18Active()) {
        this.removeProbeControls();
        this.lastAircraftId = null;
        for (const control of this.controls.values()) {
          control.runtime.initialized = false;
        }
        return;
      }

      this.installProbeControls();

      const aircraftId = String(window.geofs?.aircraft?.instance?.id ?? '');
      if (aircraftId !== this.lastAircraftId) {
        this.lastAircraftId = aircraftId;
        for (const control of this.controls.values()) {
          control.runtime.initialized = false;
        }
      }

      const nowMs = Date.now();
      for (const control of this.controls.values()) {
        this.updateControl(control, nowMs);
      }
    }

    restore() {
      this.stopLoop();
      this.removeProbeControls();
      for (const control of this.controls.values()) {
        control.runtime.initialized = false;
      }
      this.installed = false;
      this.lastAircraftId = null;
    }
  }

  class MfdModule {
    static DEFAULTS = {
      MFD_BASE_SCALE: [0.29, 0.29, 0.285],
      MFD_BUTTON_BASE_SCALE: [0.047, 0.047, 0.047],
      MFD_BUTTON_COUNT: 5,
      MFD_BUTTON_START_X: -0.048,
      MFD_BUTTON_STEP_X: 0.023,
      MFD_BUTTON_Y: -0.01,
      MFD_BUTTON_Z_OFFSET: 0.083,
      MFD_LEFT_BUTTON_X: -0.085,
      MFD_RIGHT_BUTTON_X: 0.0835,
      MFD_SIDE_BUTTON_Y: -0.01,
      MFD_SIDE_BUTTON_START_Z: 0.05,
      MFD_SIDE_BUTTON_STEP_Z: 0.023,
      MFD_TOP_BUTTON_VISUAL_SCALE: 2 / 3,
      MFD_CLICK_HALF_WIDTH: 0.36,
      MFD_CLICK_HALF_HEIGHT: 0.36,
      MFD_PART_MODEL_URL: 'models/gauges/glassPanel/glassPanel.gltf',
      defaultPageTitle: null
    };

    constructor(config = {}) {
      this.cfg = {
        ...MfdModule.DEFAULTS,
        name: 'RIGHT',
        position: [0.2167, 6.158, 0.584],
        rotation: [8, 0, 0],
        scale: [0.29, 0.29, 0.285],
        parentPartName: null,
        ...config
      };

      this.slotName = this.cfg.name || 'MFD';
      this.slotNameLower = this.slotName.toLowerCase();
      this.names = {
        MFD_RENDERER_NAME: `mfdRenderer${this.slotName}`,
        MFD_INCLUDE_KEY: `mfd-include-${this.slotNameLower}`,
        MFD_PART_NAME: `mfdPart${this.slotName}`,
        MFD_TOP_BUTTON_RENDERER_NAME: `mfdTopButtonRenderer${this.slotName}`,
        MFD_TOP_BUTTON_INCLUDE_KEY_BASE: `mfd-top-button-include-${this.slotNameLower}`,
        MFD_TOP_BUTTON_PART_NAME_BASE: `mfdTopButtonPart${this.slotName}_`,
        MFD_BOTTOM_BUTTON_PART_NAME_BASE: `mfdBottomButtonPart${this.slotName}_`,
        MFD_LEFT_BUTTON_PART_NAME_BASE: `mfdLeftButtonPart${this.slotName}_`,
        MFD_RIGHT_BUTTON_PART_NAME_BASE: `mfdRightButtonPart${this.slotName}_`
      };

      this.nodeClickHandlerInstalled = false;
      this.onNodeClickBound = this.onNodeClick.bind(this);
      this.defaultPageApplied = false;
    }

    get partName() {
      return this.names.MFD_PART_NAME;
    }

    getTopButtonPartName(index) {
      return `${this.names.MFD_TOP_BUTTON_PART_NAME_BASE}${index}`;
    }

    getLeftButtonPartName(index) {
      return `${this.names.MFD_LEFT_BUTTON_PART_NAME_BASE}${index}`;
    }

    getBottomButtonPartName(index) {
      return `${this.names.MFD_BOTTOM_BUTTON_PART_NAME_BASE}${index}`;
    }

    getRightButtonPartName(index) {
      return `${this.names.MFD_RIGHT_BUTTON_PART_NAME_BASE}${index}`;
    }

    getButtonPartName(side, index) {
      if (side === 'top') return this.getTopButtonPartName(index);
      if (side === 'bottom') return this.getBottomButtonPartName(index);
      if (side === 'left') return this.getLeftButtonPartName(index);
      return this.getRightButtonPartName(index);
    }

    getMfdScaleRatios() {
      const scale = Array.isArray(this.cfg?.scale) ? this.cfg.scale : [];
      const base = Array.isArray(this.cfg?.MFD_BASE_SCALE) ? this.cfg.MFD_BASE_SCALE : [0.29, 0.29, 0.285];

      const toRatio = (value, baseValue) => {
        const numerator = Number(value);
        const denominator = Number(baseValue);
        if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
          return 1;
        }
        const ratio = numerator / denominator;
        if (!Number.isFinite(ratio) || ratio <= 0) return 1;
        return ratio;
      };

      return [
        toRatio(scale[0], base[0]),
        toRatio(scale[1], base[1]),
        toRatio(scale[2], base[2])
      ];
    }

    scaleButtonLocalPosition(basePosition) {
      const source = Array.isArray(basePosition) ? basePosition : [0, 0, 0];
      const [sx, sy, sz] = this.getMfdScaleRatios();
      return [
        (Number(source[0]) || 0) * sx,
        (Number(source[1]) || 0) * sy,
        (Number(source[2]) || 0) * sz
      ];
    }

    getScaledButtonPartScale() {
      const [sx, sy, sz] = this.getMfdScaleRatios();
      const base = Array.isArray(this.cfg?.MFD_BUTTON_BASE_SCALE)
        ? this.cfg.MFD_BUTTON_BASE_SCALE
        : [0.047, 0.047, 0.047];

      return [
        (Number(base[0]) || 0.047) * sx,
        (Number(base[1]) || 0.047) * sy,
        (Number(base[2]) || 0.047) * sz
      ];
    }

    ensureUiState() {
      if (!addonRuntime.mfdUiStates[this.slotName]) {
        addonRuntime.mfdUiStates[this.slotName] = new F18MfdUiState();
      }

      if (!this.defaultPageApplied) {
        const desiredTitle = String(this.cfg.defaultPageTitle || '').trim().toUpperCase();
        const uiState = addonRuntime.mfdUiStates[this.slotName];
        if (desiredTitle && Array.isArray(uiState?.pages)) {
          const idx = uiState.pages.findIndex((p) => String(p?.title || '').trim().toUpperCase() === desiredTitle);
          if (idx >= 0) {
            uiState.setPage(idx);
          }
        }
        this.defaultPageApplied = true;
      }

      if (!addonRuntime.mfdPagesCatalog) {
        addonRuntime.mfdPagesCatalog = addonRuntime.mfdUiStates[this.slotName]?.pages;
      }
      return true;
    }

    getUiState() {
      return addonRuntime.mfdUiStates[this.slotName];
    }

    renderMfdButton(renderer) {
      const ctx = renderer.canvasAPI.context;
      const w = renderer.canvasAPI.canvas.width;
      const h = renderer.canvasAPI.canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const outerSize = Math.min(w, h) * this.cfg.MFD_TOP_BUTTON_VISUAL_SCALE;
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

    ensureMainRendererFunction() {
      if (!window.instruments?.renderers) return false;
      if (window.instruments.renderers[this.names.MFD_RENDERER_NAME]) return true;

      window.instruments.renderers[this.names.MFD_RENDERER_NAME] = (renderer) => {
        const uiState = this.getUiState();
        if (uiState?.render) {
          uiState.render(renderer);
          return;
        }

        const ctx = renderer.canvasAPI.context;
        const w = renderer.canvasAPI.canvas.width;
        const h = renderer.canvasAPI.canvas.height;
        renderer.canvasAPI.clear('#000000');
        const fallbackBaseColor = getOptionValue('HUD', 'COLOR', DEFAULT_COLOR);
        ctx.fillStyle = applyBrightnessToHexColor(fallbackBaseColor, getMfdBrightnessFactor());
        ctx.font = `bold ${Math.round(h * 0.18)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('MFD INIT', w / 2, h / 2);
      };

      return true;
    }

    ensureButtonRendererFunction() {
      if (!window.instruments?.renderers) return false;
      if (window.instruments.renderers[this.names.MFD_TOP_BUTTON_RENDERER_NAME]) return true;

      window.instruments.renderers[this.names.MFD_TOP_BUTTON_RENDERER_NAME] = (renderer) => {
        this.renderMfdButton(renderer);
      };

      return true;
    }

    ensureIncludeDefinition(includeKey, rendererName, modelUrl) {
      if (!window.geofs) return false;
      window.geofs.includes = window.geofs.includes || {};
      if (window.geofs.includes[includeKey]) return true;

      window.geofs.includes[includeKey] = [{
        model: {
          url: modelUrl,
          shader: {
            name: 'glassPanel',
            textures: { diffuse: '' }
          }
        },
        renderer: {
          name: rendererName,
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

    ensureMainIncludeDefinition() {
      return this.ensureIncludeDefinition(
        this.names.MFD_INCLUDE_KEY,
        this.names.MFD_RENDERER_NAME,
        `${this.cfg.MFD_PART_MODEL_URL}?v=${encodeURIComponent(this.names.MFD_RENDERER_NAME)}`
      );
    }

    getButtonIncludeKey(partName) {
      return `${this.names.MFD_TOP_BUTTON_INCLUDE_KEY_BASE}-${partName}`;
    }

    ensureButtonIncludeDefinition(partName) {
      return this.ensureIncludeDefinition(
        this.getButtonIncludeKey(partName),
        this.names.MFD_TOP_BUTTON_RENDERER_NAME,
        `${this.cfg.MFD_PART_MODEL_URL}?v=mfd-button-${encodeURIComponent(partName)}`
      );
    }

    registerButtonPickNode(partName, nodeName) {
      const aircraft = window.geofs?.aircraft?.instance;
      const part = aircraft?.parts?.[partName];
      if (!part) return false;

      const model = part?.object3d?.model?._model;
      const nodesByName = model?._nodesByName;
      const glassNode = nodesByName?.glassPanel;
      if (!glassNode) return false;

      glassNode.name = nodeName;
      nodesByName[nodeName] = glassNode;
      return true;
    }

    installButtonGroup(side) {
      const aircraft = window.geofs?.aircraft?.instance;
      if (!aircraft?.addParts) return false;
      if (!this.ensureButtonRendererFunction()) return false;
      if (!aircraft.parts?.[this.names.MFD_PART_NAME]) return false;

      const count = this.cfg.MFD_BUTTON_COUNT;

      const partsToAdd = [];
      for (let i = 0; i < count; i++) {
        const partName = this.getButtonPartName(side, i);
        if (aircraft.parts?.[partName]) continue;
        if (!this.ensureButtonIncludeDefinition(partName)) return false;

        const basePosition = side === 'top'
          ? [
              this.cfg.MFD_BUTTON_START_X + i * this.cfg.MFD_BUTTON_STEP_X,
              this.cfg.MFD_BUTTON_Y,
              Math.abs(this.cfg.MFD_BUTTON_Z_OFFSET)
            ]
          : side === 'bottom'
            ? [
                this.cfg.MFD_BUTTON_START_X + i * this.cfg.MFD_BUTTON_STEP_X,
                this.cfg.MFD_BUTTON_Y,
                -Math.abs(this.cfg.MFD_BUTTON_Z_OFFSET)
              ]
            : side === 'left'
              ? [
                  this.cfg.MFD_LEFT_BUTTON_X,
                  this.cfg.MFD_SIDE_BUTTON_Y,
                  this.cfg.MFD_SIDE_BUTTON_START_Z - i * this.cfg.MFD_SIDE_BUTTON_STEP_Z
                ]
              : [
                  this.cfg.MFD_RIGHT_BUTTON_X,
                  this.cfg.MFD_SIDE_BUTTON_Y,
                  this.cfg.MFD_SIDE_BUTTON_START_Z - i * this.cfg.MFD_SIDE_BUTTON_STEP_Z
                ];

        const position = this.scaleButtonLocalPosition(basePosition);

        partsToAdd.push({
          name: partName,
          include: this.getButtonIncludeKey(partName),
          parent: this.names.MFD_PART_NAME,
          position,
          scale: this.getScaledButtonPartScale(),
          shadows: 'SHADOWS_NONE'
        });
      }

      if (partsToAdd.length) {
        aircraft.addParts(partsToAdd);
      }

      for (let i = 0; i < count; i++) {
        const partName = this.getButtonPartName(side, i);
        if (!aircraft.parts?.[partName]) return false;
        if (!this.registerButtonPickNode(partName, partName)) {
          const buttonPart = aircraft.parts?.[partName];
          buttonPart?.['3dmodel']?.readyPromise?.then?.(() => {
            this.registerButtonPickNode(partName, partName);
          });
        }
      }

      return true;
    }

    ensureMfdUsingGeoFsParts() {
      const existingRef = addonRuntime.mfdRuntimeRefs[this.slotName];
      const existingPart = window.geofs?.aircraft?.instance?.parts?.[this.names.MFD_PART_NAME];
      if (existingRef && existingPart) return true;
      if (existingRef && !existingPart) delete addonRuntime.mfdRuntimeRefs[this.slotName];
      if (!isF18Active()) return false;

      const aircraft = window.geofs?.aircraft?.instance;
      if (!aircraft?.addParts) return false;
      if (!this.ensureMainRendererFunction()) return false;
      if (!this.ensureMainIncludeDefinition()) return false;

      const hudPart = getHudPartDefinition();
      if (!hudPart) return false;

      if (!aircraft.parts?.[this.names.MFD_PART_NAME]) {
        aircraft.addParts([{
          name: this.names.MFD_PART_NAME,
          include: this.names.MFD_INCLUDE_KEY,
          parent: this.cfg.parentPartName || hudPart.parent || 'root',
          position: this.cfg.position,
          rotation: this.cfg.rotation,
          scale: this.cfg.scale,
          points: {
            topLeft: [-this.cfg.MFD_CLICK_HALF_WIDTH, 0, this.cfg.MFD_CLICK_HALF_HEIGHT],
            topRight: [this.cfg.MFD_CLICK_HALF_WIDTH, 0, this.cfg.MFD_CLICK_HALF_HEIGHT],
            bottomLeft: [-this.cfg.MFD_CLICK_HALF_WIDTH, 0, -this.cfg.MFD_CLICK_HALF_HEIGHT],
            bottomRight: [this.cfg.MFD_CLICK_HALF_WIDTH, 0, -this.cfg.MFD_CLICK_HALF_HEIGHT]
          }
        }]);
      }

      const mfdPart = aircraft.parts?.[this.names.MFD_PART_NAME];
      if (!mfdPart) return false;

      const registerMainPickNode = () => {
        const model = mfdPart?.object3d?.model?._model;
        const nodesByName = model?._nodesByName;
        const glassNode = nodesByName?.glassPanel;
        if (!glassNode) return false;

        glassNode.name = this.names.MFD_PART_NAME;
        nodesByName[this.names.MFD_PART_NAME] = glassNode;
        return true;
      };

      if (!registerMainPickNode()) {
        mfdPart?.['3dmodel']?.readyPromise?.then?.(() => registerMainPickNode());
      }

      if (!this.installButtonGroup('top')) return false;
      if (!this.installButtonGroup('bottom')) return false;
      if (!this.installButtonGroup('left')) return false;
      if (!this.installButtonGroup('right')) return false;

      addonRuntime.mfdRuntimeRefs[this.slotName] = {
        remove: () => this.removeInstalledParts()
      };

      return true;
    }

    removePartByName(partName) {
      const ac = window.geofs?.aircraft?.instance;
      const part = ac?.parts?.[partName];
      if (!part) return;

      const parent = part.object3d?.getParent?.();
      if (parent?._children) {
        const idx = parent._children.indexOf(part.object3d);
        if (idx >= 0) parent._children.splice(idx, 1);
      }
      part.object3d?.destroy?.();
      part.rendererInstance?.destroy?.();
      part['3dmodel']?.destroy?.();
      delete ac.parts[partName];
    }

    removeInstalledParts() {
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        this.removePartByName(this.getTopButtonPartName(i));
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        this.removePartByName(this.getBottomButtonPartName(i));
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        this.removePartByName(this.getLeftButtonPartName(i));
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        this.removePartByName(this.getRightButtonPartName(i));
      }
      this.removePartByName(this.names.MFD_PART_NAME);
      delete addonRuntime.mfdRuntimeRefs[this.slotName];
    }

    hasRequiredNodeClickHandlers() {
      const handlers = window.controls?.nodeClickHandlers;
      if (!handlers) return false;

      if (handlers[this.names.MFD_PART_NAME] !== this.onNodeClickBound) return false;
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        if (handlers[this.getTopButtonPartName(i)] !== this.onNodeClickBound) return false;
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        if (handlers[this.getBottomButtonPartName(i)] !== this.onNodeClickBound) return false;
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        if (handlers[this.getLeftButtonPartName(i)] !== this.onNodeClickBound) return false;
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        if (handlers[this.getRightButtonPartName(i)] !== this.onNodeClickBound) return false;
      }
      return true;
    }

    ensureLoaded() {
      this.ensureUiState();
      const ready = this.ensureMfdUsingGeoFsParts();
      if (!ready) return false;

      if (this.nodeClickHandlerInstalled && !this.hasRequiredNodeClickHandlers()) {
        this.nodeClickHandlerInstalled = false;
      }
      this.installNodeClickHandler();
      return this.hasRequiredNodeClickHandlers();
    }

    installNodeClickHandler() {
      const controlsApi = window.controls;
      if (!controlsApi?.addNodeClickHandler || this.nodeClickHandlerInstalled) return false;

      controlsApi.addNodeClickHandler(this.names.MFD_PART_NAME, this.onNodeClickBound);
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(this.getTopButtonPartName(i), this.onNodeClickBound);
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(this.getBottomButtonPartName(i), this.onNodeClickBound);
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(this.getLeftButtonPartName(i), this.onNodeClickBound);
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(this.getRightButtonPartName(i), this.onNodeClickBound);
      }
      this.nodeClickHandlerInstalled = true;
      return true;
    }

    removeNodeClickHandler() {
      const controlsApi = window.controls;
      if (!this.nodeClickHandlerInstalled || !controlsApi?.nodeClickHandlers) return;

      delete controlsApi.nodeClickHandlers[this.names.MFD_PART_NAME];
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[this.getTopButtonPartName(i)];
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[this.getBottomButtonPartName(i)];
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[this.getLeftButtonPartName(i)];
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[this.getRightButtonPartName(i)];
      }
      this.nodeClickHandlerInstalled = false;
    }

    projectMfdCorner(cornerLocal, partObj, aircraftLla) {
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
      const part = aircraft?.parts?.[this.names.MFD_PART_NAME];
      const partObj = part?.object3d;
      const aircraftLla = aircraft?.llaLocation;
      if (!partObj || !aircraftLla) return null;

      const halfW = this.cfg.MFD_CLICK_HALF_WIDTH;
      const halfH = this.cfg.MFD_CLICK_HALF_HEIGHT;
      const localCorners = [
        [-halfW, 0,  halfH],
        [ halfW, 0,  halfH],
        [-halfW, 0, -halfH],
        [ halfW, 0, -halfH],
      ];

      const projected = localCorners.map(c => this.projectMfdCorner(c, partObj, aircraftLla));
      if (projected.some(p => p === null)) return null;

      const [topLeft, topRight, bottomLeft, bottomRight] = projected;
      const xs = projected.map(p => p.x);
      const ys = projected.map(p => p.y);

      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
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

    getPickScore(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;

      const bounds = this.getProjectedMfdBounds();
      if (!bounds || !this.pointInProjectedQuad(x, y, bounds.corners)) {
        return Infinity;
      }

      const { topLeft, topRight, bottomLeft, bottomRight } = bounds.corners;
      const centerX = (topLeft.x + topRight.x + bottomLeft.x + bottomRight.x) / 4;
      const centerY = (topLeft.y + topRight.y + bottomLeft.y + bottomRight.y) / 4;
      const dx = x - centerX;
      const dy = y - centerY;
      return dx * dx + dy * dy;
    }

    getButtonIndexFromScreenCoords(side, x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;

      const aircraft = window.geofs?.aircraft?.instance;
      const aircraftLla = aircraft?.llaLocation;
      if (!aircraft || !aircraftLla) return -1;

      const halfW = this.cfg.MFD_CLICK_HALF_WIDTH * this.cfg.MFD_TOP_BUTTON_VISUAL_SCALE;
      const halfH = this.cfg.MFD_CLICK_HALF_HEIGHT * this.cfg.MFD_TOP_BUTTON_VISUAL_SCALE;
      const localCorners = [
        [-halfW, 0, halfH],
        [halfW, 0, halfH],
        [-halfW, 0, -halfH],
        [halfW, 0, -halfH]
      ];

      const count = this.cfg.MFD_BUTTON_COUNT;

      for (let i = 0; i < count; i++) {
        const partName = this.getButtonPartName(side, i);
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

    isOwnedNode(nodeName) {
      if (nodeName === this.names.MFD_PART_NAME) return true;
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        if (nodeName === this.getTopButtonPartName(i)) return true;
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        if (nodeName === this.getBottomButtonPartName(i)) return true;
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        if (nodeName === this.getLeftButtonPartName(i)) return true;
      }
      for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
        if (nodeName === this.getRightButtonPartName(i)) return true;
      }
      return false;
    }

    onNodeClick(nodeName) {
      if (!isF18Active()) {
        return false;
      }
      if (window.geofs?.camera?.currentModeName !== 'cockpit') {
        return false;
      }

      if (!this.isOwnedNode(nodeName)) {
        return false;
      }

      const topButtonIndex = (() => {
        for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
          if (nodeName === this.getTopButtonPartName(i)) return i;
        }
        return -1;
      })();

      if (topButtonIndex >= 0) {
        const uiState = this.getUiState();
        uiState?.setPage?.(topButtonIndex);
        return true;
      }

      const bottomButtonIndex = (() => {
        for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
          if (nodeName === this.getBottomButtonPartName(i)) return i;
        }
        return -1;
      })();

      if (bottomButtonIndex >= 0) {
        const uiState = this.getUiState();
        uiState?.setPage?.(this.cfg.MFD_BUTTON_COUNT + bottomButtonIndex);
        return true;
      }

      const leftButtonIndex = (() => {
        for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
          if (nodeName === this.getLeftButtonPartName(i)) return i;
        }
        return -1;
      })();

      if (leftButtonIndex >= 0) {
        const uiState = this.getUiState();
        uiState?.toggleButtonBySlot?.('left', leftButtonIndex);
        return true;
      }

      const rightButtonIndex = (() => {
        for (let i = 0; i < this.cfg.MFD_BUTTON_COUNT; i++) {
          if (nodeName === this.getRightButtonPartName(i)) return i;
        }
        return -1;
      })();

      if (rightButtonIndex >= 0) {
        const uiState = this.getUiState();
        uiState?.toggleButtonBySlot?.('right', rightButtonIndex);
        return true;
      }

      if (nodeName !== this.names.MFD_PART_NAME) {
        return false;
      }

      return this.handlePickClick();
    }

    handlePickClick(clickOverride = null) {
      const uiState = this.getUiState();
      if (!uiState) return false;

      const click = clickOverride ?? HelperModule.getClickScreenCoords();
      if (!click) return false;

      const bounds = this.getProjectedMfdBounds();
      if (!bounds || !this.pointInProjectedQuad(click.x, click.y, bounds.corners)) {
        return false;
      }

      const pickedTopButtonIndex = this.getButtonIndexFromScreenCoords('top', click.x, click.y);
      if (pickedTopButtonIndex >= 0) {
        uiState?.setPage?.(pickedTopButtonIndex);
        return true;
      }

      const pickedBottomButtonIndex = this.getButtonIndexFromScreenCoords('bottom', click.x, click.y);
      if (pickedBottomButtonIndex >= 0) {
        uiState?.setPage?.(this.cfg.MFD_BUTTON_COUNT + pickedBottomButtonIndex);
        return true;
      }

      const pickedLeftButtonIndex = this.getButtonIndexFromScreenCoords('left', click.x, click.y);
      if (pickedLeftButtonIndex >= 0) {
        uiState?.toggleButtonBySlot?.('left', pickedLeftButtonIndex);
        return true;
      }

      const pickedRightButtonIndex = this.getButtonIndexFromScreenCoords('right', click.x, click.y);
      if (pickedRightButtonIndex >= 0) {
        uiState?.toggleButtonBySlot?.('right', pickedRightButtonIndex);
        return true;
      }

      uiState?.nextPage?.();
      return true;
    }

    restore() {
      this.removeNodeClickHandler();
      addonRuntime.mfdRuntimeRefs[this.slotName]?.remove?.();
      this.defaultPageApplied = false;
    }
  }

  function getMfdSlotState(slotName) {
    const slot = slotName || 'LEFT';
    return addonRuntime.mfdUiStates?.[slot] ?? null;
  }

  // Resolves an active MFD module by slot name.
  function getMfdModuleBySlot(slotName) {
    const slot = slotName || 'LEFT';
    return addonRuntime.mainPlugin?.mfdModules?.find((mfdModule) => mfdModule?.slotName === slot) ?? null;
  }

  function parseVec3(value, fallback = [0, 0, 0]) {
    if (!Array.isArray(value) || value.length < 3) return null;
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const numeric = Number(value[i]);
      if (!Number.isFinite(numeric)) {
        const fallbackNumeric = Number(fallback?.[i]);
        out[i] = Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0;
      } else {
        out[i] = numeric;
      }
    }
    return out;
  }

  // Returns the current configured transform of an MFD display slot.
  function getMfdDisplayTransform(slotName) {
    const mfdModule = getMfdModuleBySlot(slotName);
    if (!mfdModule) return null;

    const position = parseVec3(mfdModule.cfg?.position, [0, 0, 0]) ?? [0, 0, 0];
    const rotation = parseVec3(mfdModule.cfg?.rotation, [0, 0, 0]) ?? [0, 0, 0];
    const scale = parseVec3(mfdModule.cfg?.scale, [1, 1, 1]) ?? [1, 1, 1];

    return {
      slotName: mfdModule.slotName,
      partName: mfdModule.partName,
      position,
      rotation,
      scale
    };
  }

  // Updates one or more transform vectors for an MFD slot and reapplies live parts.
  function updateMfdDisplayTransform(slotName, transform = {}) {
    const mfdModule = getMfdModuleBySlot(slotName);
    if (!mfdModule) return { ok: false, reason: 'MFD_SLOT_NOT_FOUND' };

    const payload = (transform && typeof transform === 'object') ? transform : {};
    const hasPosition = Object.prototype.hasOwnProperty.call(payload, 'position');
    const hasRotation = Object.prototype.hasOwnProperty.call(payload, 'rotation');
    const hasScale = Object.prototype.hasOwnProperty.call(payload, 'scale');

    if (!hasPosition && !hasRotation && !hasScale) {
      return { ok: false, reason: 'NO_TRANSFORM_FIELDS' };
    }

    if (hasPosition) {
      const parsed = parseVec3(payload.position, mfdModule.cfg?.position ?? [0, 0, 0]);
      if (!parsed) return { ok: false, reason: 'INVALID_POSITION' };
      mfdModule.cfg.position = parsed;
    }

    if (hasRotation) {
      const parsed = parseVec3(payload.rotation, mfdModule.cfg?.rotation ?? [0, 0, 0]);
      if (!parsed) return { ok: false, reason: 'INVALID_ROTATION' };
      mfdModule.cfg.rotation = parsed;
    }

    if (hasScale) {
      const parsed = parseVec3(payload.scale, mfdModule.cfg?.scale ?? [1, 1, 1]);
      if (!parsed) return { ok: false, reason: 'INVALID_SCALE' };
      mfdModule.cfg.scale = parsed;
    }

    const wasInstalled = Boolean(addonRuntime.mfdRuntimeRefs?.[mfdModule.slotName]);
    if (wasInstalled) {
      mfdModule.removeNodeClickHandler();
      addonRuntime.mfdRuntimeRefs[mfdModule.slotName]?.remove?.();
      mfdModule.ensureLoaded();
    }

    return {
      ok: true,
      ...getMfdDisplayTransform(mfdModule.slotName)
    };
  }

  // Ensures MFD UI state objects exist before external MFD page operations.
  function ensureMfdUiStatesReady() {
    addonRuntime.mainPlugin?.mfdModules?.forEach((mfdModule) => {
      mfdModule?.ensureUiState?.();
    });
    return Object.values(addonRuntime.mfdUiStates ?? {});
  }

  // Resolves a page target to an index using number or title lookup.
  function resolveMfdPageTargetIndex(uiState, target) {
    if (!uiState || !Array.isArray(uiState.pages)) return -1;
    if (Number.isInteger(target)) {
      return target >= 0 && target < uiState.pages.length ? target : -1;
    }

    const titleToken = target;
    if (!titleToken) return -1;
    return uiState.pages.findIndex((p) => p.title === titleToken);
  }

  function createAddonApi() {
    return {
      version: VERSION,
      helper: {
        normalizeToken: normalizeOptionToken,
        isAircraftActive: isF18Active
      },
      options: {
        buildKey: buildOptionKey,
        read: readOptions,
        write: writeOptions,
        get: getOption,
        set: setOption,
        getValue: getOptionValue
      },
      checklists: {
        getModule: () => getChecklistModule(),
        addChecklist: (definition) => getChecklistModule().addChecklist(definition),
        getChecklists: (type) => getChecklistModule().getChecklists(type),
        getCurrentChecklist: (type) => getChecklistModule().getCurrentChecklist(type),
        getCurrentItemCompleted: (type) => getChecklistModule().getCurrentItemCompleted(type),
        markNextCurrentItem: (type) => getChecklistModule().markNextCurrentItem(type),
        setCurrentIndex: (type, index) => getChecklistModule().setCurrentIndex(type, index),
        nextChecklist: (type) => getChecklistModule().nextChecklist(type),
        nextChecklistNoWrap: (type) => getChecklistModule().nextChecklistNoWrap(type),
        prevChecklist: (type) => getChecklistModule().prevChecklist(type),
        setCurrentCompleted: (type, completed) => getChecklistModule().setCurrentCompleted(type, completed),
        toggleCurrentCompleted: (type) => getChecklistModule().toggleCurrentCompleted(type),
        resetCurrent: (type) => getChecklistModule().resetCurrent(type),
        resetType: (type) => getChecklistModule().resetType(type)
      },
      weapons: {
        getMode: getWpnModeFromOptions,
        getLoadout: () => wpnCurrentLoadout,
        getSelectedWeapon: () => {
          const mode = getWpnModeFromOptions();
          const modeLoadout = getWpnModeLoadout(mode);
          return ensureWpnSelectedWeapon(mode, modeLoadout);
        },
        selectNext: (minimumQuantity = 0) => {
          const mode = getWpnModeFromOptions();
          const modeLoadout = getWpnModeLoadout(mode);
          return selectNextWpnWeapon(mode, modeLoadout, minimumQuantity);
        },
        fireSelected: () => {
          const mode = getWpnModeFromOptions();
          const modeLoadout = getWpnModeLoadout(mode);
          return fireSelectedWpnWeapon(mode, modeLoadout);
        },
        jettisonSelected: () => {
          const mode = getWpnModeFromOptions();
          const modeLoadout = getWpnModeLoadout(mode);
          return jettisonSelectedWpnWeapon(mode, modeLoadout);
        },
        startRearm: (config) => startWpnRearm(config),
        getRearmState: () => ({ ...wpnRearmState })
      },
      controls: {
        setProbeState: (state) => addonRuntime.mainPlugin.controlModule.setProbeState(state),
        getProbeState: () => getOption('SYS', 'REFUELING', 'CLOSED')
      },
      nav: {
        getModule: () => getNavModule(),
        getCurrentNavUnit: () => getNavModule().getCurrentNavUnit(),
        getReadouts: () => getNavModule().getReadouts(),
        getNavaidLabel: () => getNavModule().getNavaidTypeLabel(),
        getAutopilotHeading: () => getNavModule().getAutopilotHeadingDeg()
      },
      map: {
        getModule: () => getMapModule(),
        getRangeNm: () => getMapModule().getRangeNm(),
        setRangeNm: (rangeNm) => getMapModule().setRangeNm(rangeNm),
        stepRange: (step) => getMapModule().stepRange(step),
        clearSelectedTraffic: () => getMapModule().clearSelectedTraffic(),
        stepSelectedTraffic: (step) => getMapModule().stepSelectedTraffic(step),
        getSelectedTrafficMark: () => getMapModule().getSelectedTrafficMark(),
        cycleSelectedTrafficMark: () => getMapModule().cycleSelectedTrafficMark(),
        getShowFilter: () => getMapModule().getShowFilter(),
        setShowFilter: (value) => getMapModule().setShowFilter(value),
        cycleShowFilter: () => getMapModule().cycleShowFilter(),
        getSceneData: () => getMapModule().getSceneData()
      },
      communication: {
        getModule: () => getCommunicationModule(),
        getProfile: () => getCommunicationModule().getProfile(),
        setProfile: (profile) => getCommunicationModule().setProfile(profile),
        getGroup: () => getCommunicationModule().getProfile().group,
        setGroup: (value) => getCommunicationModule().setGroup(value),
        getFlight: () => getCommunicationModule().getProfile().flight,
        setFlight: (value) => getCommunicationModule().setFlight(value),
        getWingman: () => getCommunicationModule().getProfile().wingman,
        setWingman: (value) => getCommunicationModule().setWingman(value),
        getVoiceLanguage: () => getCommunicationModule().getVoiceLanguage(),
        setVoiceLanguage: (language) => getCommunicationModule().setVoiceLanguage(language),
        getVoiceRate: () => getCommunicationModule().getVoiceRate(),
        setVoiceRate: (rate) => getCommunicationModule().setVoiceRate(rate),
        getMessages: (mode = 'ALL', limit = 5) => getCommunicationModule().getMessagesByMode(mode, limit),
        getHudMessage: () => getCommunicationModule().getHudOverlayText()
      },
      hud: {
        getModule: () => addonRuntime.mainPlugin?.hudModule ?? null,
        getMode: () => getOption('HUD', 'HUD', 'F-18'),
        setMode: (mode) => {
          if (addonRuntime.mainPlugin?.hudModule?.setMode) {
            return addonRuntime.mainPlugin.hudModule.setMode(mode);
          }
          setOption('HUD', 'HUD', mode);
          return mode;
        },
        isCustomEnabled: () => getOption('HUD', 'HUD', 'F-18') !== 'DEFAULT'
      },
      mfd: {
        getSlots: () => Object.keys(addonRuntime.mfdUiStates),
        addPage: (pageDefinition, insertIndex = null) => {
          const states = ensureMfdUiStatesReady();
          if (!states.length) return { ok: false, reason: 'NO_MFD_STATES' };

          const baseIndex = Number.isInteger(insertIndex) ? insertIndex : states[0].pages.length;
          const nextIndex = Math.max(0, Math.min(states[0].pages.length, baseIndex));
          const fallbackTitle = `PAGE_${nextIndex + 1}`;

          for (const uiState of states) {
            uiState.pages.splice(nextIndex, 0, pageDefinition);
            if (uiState.pageIndex >= nextIndex) {
              uiState.pageIndex += 1;
            }
            uiState.ensureDefaultsInStorage();
          }

          addonRuntime.mfdPagesCatalog = states[0].pages;
          return { ok: true, index: nextIndex, title: states[0].pages[nextIndex]?.title ?? fallbackTitle };
        },
        setPageDefinition: (target, pageDefinition) => {
          const states = ensureMfdUiStatesReady();
          if (!states.length) return { ok: false, reason: 'NO_MFD_STATES' };

          const resolvedIndex = resolveMfdPageTargetIndex(states[0], target);
          if (resolvedIndex < 0) return { ok: false, reason: 'PAGE_NOT_FOUND' };

          for (const uiState of states) {
            const currentTitle = uiState.pages?.[resolvedIndex]?.title ?? `PAGE_${resolvedIndex + 1}`;
            uiState.pages[resolvedIndex] = pageDefinition;
            if (uiState.pageIndex >= uiState.pages.length) {
              uiState.pageIndex = Math.max(0, uiState.pages.length - 1);
            }
            uiState.ensureDefaultsInStorage();
          }

          addonRuntime.mfdPagesCatalog = states[0].pages;
          return { ok: true, index: resolvedIndex, title: states[0].pages[resolvedIndex]?.title ?? null };
        },
        addDisplay: (config = {}) => {
          if (!addonRuntime.mainPlugin) {
            addonRuntime.mainPlugin = new F18MainPlugin();
            addonRuntime.mainPlugin.start();
          }

          const mfdModule = addonRuntime.mainPlugin.addMfd(config);
          mfdModule?.ensureLoaded?.();

          return {
            slotName: mfdModule?.slotName ?? null,
            partName: mfdModule?.partName ?? null
          };
        },
        getDisplayTransform: (slotName) => getMfdDisplayTransform(slotName),
        updateDisplayTransform: (slotName, transform = {}) => updateMfdDisplayTransform(slotName, transform),
        getDisplayState: (slotName) => getMfdSlotState(slotName),
        setPage: (slotName, pageIndex) => {
          const uiState = getMfdSlotState(slotName);
          if (!uiState || !Number.isInteger(pageIndex)) return false;
          uiState.setPage(pageIndex);
          return true;
        },
        nextPage: (slotName) => {
          const uiState = getMfdSlotState(slotName);
          if (!uiState) return false;
          uiState.nextPage();
          return true;
        },
        toggleButton: (slotName, side, index) => {
          const uiState = getMfdSlotState(slotName);
          if (!uiState) return false;
          uiState.toggleButtonBySlot(side, index);
          return true;
        }
      },
      lifecycle: {
        start: () => {
          if (!addonRuntime.mainPlugin) {
            addonRuntime.mainPlugin = new F18MainPlugin();
          }
          addonRuntime.mainPlugin.start();
          return true;
        },
        stop: () => {
          if (!addonRuntime.mainPlugin) return false;
          addonRuntime.mainPlugin.stop();
          addonRuntime.mainPlugin = null;
          addonRuntime.mapModule = null;
          addonRuntime.navModule = null;
          addonRuntime.communicationModule = null;
          addonRuntime.mfdRuntimeRefs = Object.create(null);
          return true;
        },
        restart: () => {
          if (addonRuntime.mainPlugin) {
            addonRuntime.mainPlugin.stop();
          }
          addonRuntime.mainPlugin = new F18MainPlugin();
          addonRuntime.mainPlugin.start();
          return true;
        },
        isRunning: () => Boolean(addonRuntime.mainPlugin)
      }
    };
  }

  if (window.F18Addon?.lifecycle?.stop) {
    window.F18Addon.lifecycle.stop();
  }

  window.F18Addon = createAddonApi();
  window.F18Addon.lifecycle.start();
})();
