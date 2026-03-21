// ==UserScript==
// @name         GeoFS F-18 Addon
// @namespace    https://github.com/ArjanKw/GeoFS-BlueAngels/
// @version      1.3.0
// @description  Improves the cockpit with a new HUD and custom MFDs, adjustable seat height and more.
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @match        https://*.geo-fs.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.3.0';
  const F18_AIRCRAFT_ID = '27';

  const FLIGHT_RECORDER_MIN_VERSION = '1.2.0';
  const RAD_TO_DEG = 180 / Math.PI;
  const CAMERA_TO_HUD_DISTANCE_M = 0.92;
  const PROBE_OPEN_BUTTON_ID = 'f18-probe-open';
  const PROBE_LABEL_BUTTON_ID = 'f18-probe-label';
  const PROBE_CLOSE_BUTTON_ID = 'f18-probe-close';
  const F18_OPTIONS_STORAGE_KEY = 'F18Options';
  const F18_WPN_STATE_STORAGE_KEY = 'F18WpnState';
  const DEFAULT_COLOR = '#00ff00';
  let currentHudColor = DEFAULT_COLOR;
  const addonRuntime = {
    checklistModule: null,
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
        name: 'RIGHT',
        position: [0.2167, 6.158, 0.584],
        rotation: [8, 0, 0],
        scale: [0.29, 0.29, 0.285],
        defaultPageTitle: 'SYS'
      });

      this.addMfd({
        name: 'LEFT',
        position: [-0.2160, 6.158, 0.584],
        rotation: [8, 0, 0],
        scale: [0.29, 0.29, 0.285],
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
      const mfdReady = this.mfdModules.every((mfdModule) => mfdModule.ensureLoaded());
      const pickNodeReady = this.ensureGlobalMfdPickNodeHandler();
      const nodeBridgeReady = this.ensureRunNodeClickBridge();
      return Boolean(hudReady && cameraReady && fmcReady && controlsReady && mfdReady && pickNodeReady && nodeBridgeReady);
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
    const value = String(version ?? '').trim();
    const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3])
    };
  }

  function isSemverAtLeast(version, minimumVersion) {
    const a = parseSemver(version);
    const b = parseSemver(minimumVersion);
    if (!a || !b) return false;

    if (a.major !== b.major) return a.major > b.major;
    if (a.minor !== b.minor) return a.minor > b.minor;
    return a.patch >= b.patch;
  }

  function getFlightRecorderApi() {
    return window.FlightRecorder?.api ?? null;
  }

  function getFlightRecorderVersion(api = getFlightRecorderApi()) {
    if (!api || typeof api.getVersion !== 'function') return null;
    try {
      return String(api.getVersion() ?? '').trim() || null;
    } catch (e) {
      return null;
    }
  }

  function isFlightRecorderCompatible(api = getFlightRecorderApi()) {
    if (!api) return false;
    const version = getFlightRecorderVersion(api);
    if (!version) return false;
    return isSemverAtLeast(version, FLIGHT_RECORDER_MIN_VERSION);
  }

  function normalizeFlightRecorderRecordingState(rawState) {
    const value = String(rawState ?? '').trim().toUpperCase();
    if (value.includes('RECORD')) return 'RECORDING';
    if (value.includes('STOP')) return 'STOPPED';
    if (value.includes('OFF') || value.includes('IDLE') || value.includes('NONE')) return 'OFF';
    return 'OFF';
  }

  function normalizeFlightRecorderPlaybackState(rawState) {
    const value = String(rawState ?? '').trim().toUpperCase();
    if (value.includes('START') || value.includes('PLAY')) return 'STARTED';
    if (value.includes('PAUSE')) return 'PAUSED';
    if (value.includes('STOP') || value.includes('OFF') || value.includes('IDLE') || value.includes('NONE')) return 'STOPPED';
    return 'STOPPED';
  }

  function getNestedStateValue(raw) {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
      if (typeof raw.state === 'string') return raw.state;
      if (typeof raw.status === 'string') return raw.status;
      if (typeof raw.mode === 'string') return raw.mode;
      if (typeof raw.value === 'string') return raw.value;
    }
    return null;
  }

  function getFlightRecorderRecordingState(api = getFlightRecorderApi()) {
    if (!isFlightRecorderCompatible(api)) return 'OFF';

    let raw = null;
    try {
      raw = api?.recording?.getState?.();
    } catch (e) {
      raw = null;
    }

    if (raw && typeof raw === 'object' && typeof raw.recording === 'boolean') {
      return raw.recording ? 'RECORDING' : 'STOPPED';
    }

    const nested = getNestedStateValue(raw);
    return normalizeFlightRecorderRecordingState(nested);
  }

  function getFlightRecorderPlaybackState(api = getFlightRecorderApi()) {
    if (!isFlightRecorderCompatible(api)) return 'STOPPED';

    let raw = null;
    try {
      raw = api?.playback?.getState?.();
    } catch (e) {
      raw = null;
    }

    if (raw && typeof raw === 'object' && typeof raw.playing === 'boolean') {
      if (raw.playing) return 'STARTED';
      if (raw.paused === true) return 'PAUSED';
      return 'STOPPED';
    }

    const nested = getNestedStateValue(raw);
    return normalizeFlightRecorderPlaybackState(nested);
  }

  function getFlightRecorderMfdStatus() {
    const api = getFlightRecorderApi();
    const installed = Boolean(api);
    const version = getFlightRecorderVersion(api);
    const compatible = isFlightRecorderCompatible(api);

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
      recordingState: getFlightRecorderRecordingState(api),
      playbackState: getFlightRecorderPlaybackState(api),
      message: ''
    };
  }

  function toggleFlightRecorderRecordingFromMfd() {
    const api = getFlightRecorderApi();
    if (!isFlightRecorderCompatible(api)) return false;

    const currentState = getFlightRecorderRecordingState(api);
    try {
      if (currentState === 'RECORDING') {
        api?.recording?.stop?.();
      } else {
        api?.recording?.start?.();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function controlFlightRecorderPlaybackFromMfd(action) {
    const api = getFlightRecorderApi();
    if (!isFlightRecorderCompatible(api)) return false;

    const command = String(action ?? '').trim().toUpperCase();
    try {
      if (command === 'START') {
        api?.playback?.start?.();
      } else if (command === 'PAUSE') {
        api?.playback?.pause?.();
      } else if (command === 'STOP') {
        api?.playback?.stop?.();
      } else {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function deepCloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getWpnModeFromOptions() {
    const mode = getOption('WPN', 'MODE', 'NAV');
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
        config: getOption('WPN', 'CONFIG', 'A/A'),
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

  function buildOptionKey(pageTitle, buttonKey) {
    return `${normalizeOptionToken(pageTitle)}.${normalizeOptionToken(buttonKey)}`;
  }

  function readOptions() {
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

  function getOption(pageTitle, buttonKey, fallback = null) {
    const options = readOptions();
    const optionKey = buildOptionKey(pageTitle, buttonKey);
    return options[optionKey] ?? fallback;
  }

  function writeOptions(options) {
    try {
      const payload = (options && typeof options === 'object' && !Array.isArray(options)) ? options : {};
      window.localStorage?.setItem?.(F18_OPTIONS_STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  }

  function setOption(pageTitle, buttonKey, value) {
    try {
      const options = readOptions();
      const optionKey = buildOptionKey(pageTitle, buttonKey);
      options[optionKey] = value;
      writeOptions(options);
    } catch (e) {
      // Ignore storage write issues.
    }
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

  function getMfdBrightnessFactor() {
    const brightMode = String(getOption('HUD', 'BRIGHT', 'NORM') ?? 'NORM').toUpperCase();
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

    normalizeType(type) {
      const value = String(type ?? '').trim().toUpperCase();
      return this.types.includes(value) ? value : 'PROC';
    }

    normalizeItemProgress(checklist) {
      if (!checklist) return [];
      const items = Array.isArray(checklist.items) ? checklist.items : [];
      const raw = Array.isArray(checklist.itemCompleted) ? checklist.itemCompleted : [];
      checklist.itemCompleted = items.map((_, idx) => Boolean(raw[idx]));
      return checklist.itemCompleted;
    }

    addChecklist(definition) {
      const type = this.normalizeType(definition?.type);
      const list = this.checklistsByType[type];
      if (!Array.isArray(list)) return false;

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
        itemCompleted: Array.isArray(definition?.itemCompleted) ? definition.itemCompleted : [],
        completed: Boolean(definition?.completed)
      };

      this.normalizeItemProgress(checklist);
      if (checklist.completed && checklist.itemCompleted.length) {
        checklist.itemCompleted = checklist.itemCompleted.map(() => true);
      }

      list.push(checklist);

      const idx = this.currentIndexByType[type] ?? 0;
      this.currentIndexByType[type] = Math.max(0, Math.min(idx, list.length - 1));
      return true;
    }

    getChecklists(type) {
      const normalized = this.normalizeType(type);
      return this.checklistsByType[normalized] ?? [];
    }

    getCurrentIndex(type) {
      const normalized = this.normalizeType(type);
      const list = this.getChecklists(normalized);
      if (!list.length) return 0;
      const idx = Number(this.currentIndexByType[normalized]);
      if (!Number.isFinite(idx)) return 0;
      return Math.max(0, Math.min(list.length - 1, Math.floor(idx)));
    }

    setCurrentIndex(type, index) {
      const normalized = this.normalizeType(type);
      const list = this.getChecklists(normalized);
      if (!list.length) {
        this.currentIndexByType[normalized] = 0;
        return 0;
      }
      const idx = Number(index);
      const clamped = Number.isFinite(idx)
        ? Math.max(0, Math.min(list.length - 1, Math.floor(idx)))
        : 0;
      this.currentIndexByType[normalized] = clamped;
      return clamped;
    }

    nextChecklist(type) {
      const normalized = this.normalizeType(type);
      const list = this.getChecklists(normalized);
      if (!list.length) return null;
      const next = (this.getCurrentIndex(normalized) + 1) % list.length;
      this.currentIndexByType[normalized] = next;
      return list[next];
    }

    prevChecklist(type) {
      const normalized = this.normalizeType(type);
      const list = this.getChecklists(normalized);
      if (!list.length) return null;
      const next = (this.getCurrentIndex(normalized) - 1 + list.length) % list.length;
      this.currentIndexByType[normalized] = next;
      return list[next];
    }

    getCurrentChecklist(type) {
      const normalized = this.normalizeType(type);
      const list = this.getChecklists(normalized);
      if (!list.length) return null;
      return list[this.getCurrentIndex(normalized)] ?? null;
    }

    hasNextChecklist(type) {
      const normalized = this.normalizeType(type);
      const list = this.getChecklists(normalized);
      if (!list.length) return false;
      return this.getCurrentIndex(normalized) < (list.length - 1);
    }

    nextChecklistNoWrap(type) {
      const normalized = this.normalizeType(type);
      const list = this.getChecklists(normalized);
      if (!list.length) return null;

      const current = this.getCurrentIndex(normalized);
      if (current >= list.length - 1) {
        return list[current] ?? null;
      }

      const next = current + 1;
      this.currentIndexByType[normalized] = next;
      return list[next] ?? null;
    }

    setCurrentCompleted(type, completed) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return false;
      const nextCompleted = Boolean(completed);
      checklist.completed = nextCompleted;

      const states = this.normalizeItemProgress(checklist);
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
      return this.normalizeItemProgress(checklist);
    }

    markNextCurrentItem(type) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return false;

      const states = this.normalizeItemProgress(checklist);
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
      const normalized = this.normalizeType(type);
      const list = this.getChecklists(normalized);
      for (const checklist of list) {
        checklist.completed = false;
        this.normalizeItemProgress(checklist).fill(false);
      }
      this.currentIndexByType[normalized] = 0;
      return true;
    }
  }

  function createDefaultChecklistModule() {
    const module = new ChecklistModule();
    module.addChecklist({
      type: 'PROC',
      title: 'Engine Start',
      items: ['Parking Brake ON', 'Flight Plan LOADED', 'Briefing CHECKED', 'Master Arm OFF', 'Weapon Config SELECTED', 'Rearming FINISHED', 'Area CLEAR', 'Engine ON', 'Instruments CHECK'],
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
      items: ['Flaps AUTO', 'Attitude SET', 'Trim SET'],
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

  class F18MfdUiState {
    constructor() {
      this.pageIndex = 0;
      this.pages = this.createPages();
      this.ensureDefaultsInStorage();
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
                const isAllMode = String(getOption('CHK', 'ALL', 'ONE') ?? 'ONE').toUpperCase() === 'ALL';
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
                const isAllMode = String(getOption('CHK', 'ALL', 'ONE') ?? 'ONE').toUpperCase() === 'ALL';
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
            const selectedType = String(getOption('CHK', 'TYPE', 'PROC') ?? 'PROC').toUpperCase();
            const showAll = String(getOption('CHK', 'ALL', 'ONE') ?? 'ONE').toUpperCase() === 'ALL';
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
          title: 'AUX1',
          leftButtons: [],
          rightButtons: [],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(h * 0.06)}px monospace`;
            ctx.fillText('AUX PAGE 1', w * 0.5, h * 0.5);
            ctx.restore();
          }
        },
        {
          title: 'AUX2',
          leftButtons: [],
          rightButtons: [],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(h * 0.06)}px monospace`;
            ctx.fillText('AUX PAGE 2', w * 0.5, h * 0.5);
            ctx.restore();
          }
        },
        {
          title: 'AUX3',
          leftButtons: [],
          rightButtons: [],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(h * 0.06)}px monospace`;
            ctx.fillText('AUX PAGE 3', w * 0.5, h * 0.5);
            ctx.restore();
          }
        },
        {
          title: 'AUX4',
          leftButtons: [],
          rightButtons: [],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(h * 0.06)}px monospace`;
            ctx.fillText('AUX PAGE 4', w * 0.5, h * 0.5);
            ctx.restore();
          }
        },
        {
          title: 'AUX5',
          leftButtons: [],
          rightButtons: [],
          lines: [],
          render: (renderer, renderContext) => {
            const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
            const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
            const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
            const color = renderContext?.color ?? '#00ff66';
            if (!ctx) return;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.round(h * 0.06)}px monospace`;
            ctx.fillText('AUX PAGE 5', w * 0.5, h * 0.5);
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
      return buildOptionKey(page?.title ?? 'PAGE', preferred);
    }

    ensureDefaultsInStorage() {
      try {
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
      } catch (e) {
        // Ignore malformed storage.
      }
    }

    getStoredStateIndex(page, button, index, side) {
      if (!button?.states?.length) return -1;

      const optionKey = this.getButtonStorageKey(page, button, index, side);
      const storedState = readOptions()?.[optionKey];

      if (storedState != null) {
        const exactIndex = button.states.findIndex((s) => s === storedState);
        if (exactIndex >= 0) return exactIndex;

        const ciIndex = button.states.findIndex((s) => String(s).toUpperCase() === String(storedState).toUpperCase());
        if (ciIndex >= 0) return ciIndex;
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
        try {
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
        } catch (e) {
          // Ignore button callback errors to keep MFD responsive.
        }
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
      const baseColor = getOptionValue('HUD', 'COLOR', '#00ff66') ?? '#00ff66';
      const color = applyBrightnessToHexColor(baseColor, getMfdBrightnessFactor()) ?? baseColor;
      renderer.canvasAPI.clear();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(layout.frame.left, layout.frame.top, layout.frame.width, layout.frame.height);

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(h * 0.045)}px monospace`;

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
    return getOptionValue('HUD', 'COLOR', DEFAULT_COLOR) ?? DEFAULT_COLOR;
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
    const hudBaseColor = getHudColorFromStoredOptions();
    const hudColor = applyBrightnessToHexColor(hudBaseColor, getMfdBrightnessFactor()) ?? hudBaseColor;
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
        if (!isF18Active()) {
          return self.originalRenderer.call(this, renderer);
        }
        renderF18Hud(renderer);
      };

      this.installed = true;
      return true;
    }

    // Ensures the HUD renderer is installed and active.
    ensureLoaded() {
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
    static DEFAULT_HUD_CAMERA_Z = 0.925;
    static CAMERA_STEP_Z = 0.005;
    static CAMERA_UP_BUTTON_ID = 'f18-hud-camera-up';
    static CAMERA_DOWN_BUTTON_ID = 'f18-hud-camera-down';

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
      },
      12: {
        distance: 0,
        FOV: 1.7,
        insideView: true,
        mode: 12,
        name: 'Throttle cam',
        offsetBounds: [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
        offsets: {
          current: [0, 0, 0],
          last: [0, 0, 0],
          neutral: [0, 0, 0]
        },
        orientation: [0, -8, 0],
        orientations: {
          current: [0, -8, 0],
          last: [0, -8, 0],
          neutral: [0, -8, 0]
        },
        position: [-0.17, 5.4, 0.3],
        view: 'Throttle cam'
      }
    };

    constructor(helperModule) {
      this.helperModule = helperModule;
      this.installed = false;
      this.originalModesByIndex = new Map();
      this.boundModesRef = null;
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

    removeCameraControls() {
      this.helperModule?.removePadControl('f18-hud-camera-controls');
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
        return false;
      }

      const modes = window.geofs?.camera?.modes;
      if (!modes) return false;
      if (!this.isAircraftCameraReady()) return false;

      if (!this.installCameraControls()) return false;

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
      return true;
    }

    restore() {
      this.removeCameraControls();

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
      return String(getOption('SYS', 'FLAPS', 'MAN') ?? 'MAN').toUpperCase();
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
    }

    registerControl(definition) {
      const key = String(definition?.key || '').trim().toUpperCase();
      if (!key) return false;

      const control = {
        key,
        defaultState: String(definition?.defaultState || 'CLOSED').toUpperCase(),
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
      const value = String(state || '').trim().toUpperCase();
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

      const openButton = this.createProbePadButton('OPEN', PROBE_OPEN_BUTTON_ID, () => {
        this.setProbeState('OPEN');
      }, {
        borderBottom: '1px solid #333',
        borderRadius: '15px 15px 0 0'
      });

      const probeLabel = this.createProbePadButton('PROBE', PROBE_LABEL_BUTTON_ID, () => {}, {
        marginTop: '-9px',
        borderRadius: '0',
        borderTop: '0',
        cursor: 'default',
        pointerEvents: 'none'
      }, {
        fontWeight: '700'
      });

      const closeButton = this.createProbePadButton('CLOSE', PROBE_CLOSE_BUTTON_ID, () => {
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
      const raw = String(configKey || '').trim();
      const [page, key] = raw.split('.');
      return {
        page: String(page || '').toUpperCase(),
        key: String(key || '').toUpperCase()
      };
    }

    getRequestedState(control) {
      const tokens = this.parseConfigKey(control?.key);
      if (!tokens.page || !tokens.key) return control.defaultState;

      const runtime = control?.runtime || {};
      const raw = getOption(tokens.page, tokens.key, null);
      if (raw == null || raw === '') {
        return String(runtime.targetState || runtime.currentState || control.defaultState).toUpperCase();
      }

      return String(raw).toUpperCase();
    }

    getAnimationValue(valueKey, fallback = 0) {
      const raw = Number(window.geofs?.animation?.values?.[valueKey]);
      return Number.isFinite(raw) ? raw : Number(fallback) || 0;
    }

    resolveControlKey(controlKey) {
      const key = String(controlKey || '').trim().toUpperCase();
      return key;
    }

    getControlByKey(controlKey) {
      const key = this.resolveControlKey(controlKey);
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

      const partNameNorm = String(partName || '').trim();
      const valueKeyNorm = String(valueKey || '').trim();
      const stateNorm = String(state || '').trim().toUpperCase();
      const numericValue = Number(value);
      if (!partNameNorm || !valueKeyNorm || !stateNorm || !Number.isFinite(numericValue)) return false;

      const partDef = control.parts.find((p) => String(p?.partName || '').trim() === partNameNorm);
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
      const stateNorm = String(state || '').trim().toUpperCase();
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
      const stateNorm = String(state || '').trim().toUpperCase();
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
        try {
          const node = model.getNode(candidate);
          if (node) return String(node.name || node._name || node.id || target);
        } catch { }
      }

      try {
        const wantedLow = target.toLowerCase();
        const arr = model._runtime?.nodes || model._nodes || [];
        for (const node of arr) {
          const nodeName = String(node?.name || node?._name || node?.id || '').trim();
          if (nodeName && nodeName.toLowerCase() === wantedLow) return nodeName;
        }
      } catch { }

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

      try {
        aircraft.addParts([partDef], aircraft.aircraftRecord?.fullPath, aircraft.definition?.scale || 1, aircraft.definition?.orientation);
      } catch {
        return null;
      }

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
      MFD_TOP_BUTTON_COUNT: 5,
      MFD_BOTTOM_BUTTON_COUNT: 5,
      MFD_LEFT_BUTTON_COUNT: 5,
      MFD_RIGHT_BUTTON_COUNT: 5,
      MFD_TOP_BUTTON_START_X: -0.048,
      MFD_TOP_BUTTON_STEP_X: 0.023,
      MFD_TOP_BUTTON_Y: -0.01,
      MFD_TOP_BUTTON_Z: 0.092,
      MFD_BOTTOM_BUTTON_START_X: -0.048,
      MFD_BOTTOM_BUTTON_STEP_X: 0.023,
      MFD_BOTTOM_BUTTON_Y: -0.01,
      MFD_BOTTOM_BUTTON_Z: -0.08,
      MFD_LEFT_BUTTON_X: -0.085,
      MFD_LEFT_BUTTON_Y: -0.01,
      MFD_LEFT_BUTTON_START_Z: 0.05,
      MFD_LEFT_BUTTON_STEP_Z: 0.023,
      MFD_RIGHT_BUTTON_X: 0.0835,
      MFD_RIGHT_BUTTON_Y: -0.01,
      MFD_RIGHT_BUTTON_START_Z: 0.05,
      MFD_RIGHT_BUTTON_STEP_Z: 0.023,
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

      this.slotName = normalizeOptionToken(this.cfg.name || 'MFD') || 'MFD';
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
        const fallbackBaseColor = getOptionValue('HUD', 'COLOR', DEFAULT_COLOR) ?? DEFAULT_COLOR;
        ctx.fillStyle = applyBrightnessToHexColor(fallbackBaseColor, getMfdBrightnessFactor()) ?? fallbackBaseColor;
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

      const count = side === 'top'
        ? this.cfg.MFD_TOP_BUTTON_COUNT
        : side === 'bottom'
          ? this.cfg.MFD_BOTTOM_BUTTON_COUNT
        : side === 'left'
          ? this.cfg.MFD_LEFT_BUTTON_COUNT
          : this.cfg.MFD_RIGHT_BUTTON_COUNT;

      const partsToAdd = [];
      for (let i = 0; i < count; i++) {
        const partName = this.getButtonPartName(side, i);
        if (aircraft.parts?.[partName]) continue;
        if (!this.ensureButtonIncludeDefinition(partName)) return false;

        const position = side === 'top'
          ? [
              this.cfg.MFD_TOP_BUTTON_START_X + i * this.cfg.MFD_TOP_BUTTON_STEP_X,
              this.cfg.MFD_TOP_BUTTON_Y,
              this.cfg.MFD_TOP_BUTTON_Z
            ]
          : side === 'bottom'
            ? [
                this.cfg.MFD_BOTTOM_BUTTON_START_X + i * this.cfg.MFD_BOTTOM_BUTTON_STEP_X,
                this.cfg.MFD_BOTTOM_BUTTON_Y,
                this.cfg.MFD_BOTTOM_BUTTON_Z
              ]
          : side === 'left'
            ? [
                this.cfg.MFD_LEFT_BUTTON_X,
                this.cfg.MFD_LEFT_BUTTON_Y,
                this.cfg.MFD_LEFT_BUTTON_START_Z - i * this.cfg.MFD_LEFT_BUTTON_STEP_Z
              ]
            : [
                this.cfg.MFD_RIGHT_BUTTON_X,
                this.cfg.MFD_RIGHT_BUTTON_Y,
                this.cfg.MFD_RIGHT_BUTTON_START_Z - i * this.cfg.MFD_RIGHT_BUTTON_STEP_Z
              ];

        partsToAdd.push({
          name: partName,
          include: this.getButtonIncludeKey(partName),
          parent: this.names.MFD_PART_NAME,
          position,
          scale: [0.047, 0.047, 0.047],
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
      for (let i = 0; i < this.cfg.MFD_TOP_BUTTON_COUNT; i++) {
        this.removePartByName(this.getTopButtonPartName(i));
      }
      for (let i = 0; i < this.cfg.MFD_BOTTOM_BUTTON_COUNT; i++) {
        this.removePartByName(this.getBottomButtonPartName(i));
      }
      for (let i = 0; i < this.cfg.MFD_LEFT_BUTTON_COUNT; i++) {
        this.removePartByName(this.getLeftButtonPartName(i));
      }
      for (let i = 0; i < this.cfg.MFD_RIGHT_BUTTON_COUNT; i++) {
        this.removePartByName(this.getRightButtonPartName(i));
      }
      this.removePartByName(this.names.MFD_PART_NAME);
      delete addonRuntime.mfdRuntimeRefs[this.slotName];
    }

    hasRequiredNodeClickHandlers() {
      const handlers = window.controls?.nodeClickHandlers;
      if (!handlers) return false;

      if (handlers[this.names.MFD_PART_NAME] !== this.onNodeClickBound) return false;
      for (let i = 0; i < this.cfg.MFD_TOP_BUTTON_COUNT; i++) {
        if (handlers[this.getTopButtonPartName(i)] !== this.onNodeClickBound) return false;
      }
      for (let i = 0; i < this.cfg.MFD_BOTTOM_BUTTON_COUNT; i++) {
        if (handlers[this.getBottomButtonPartName(i)] !== this.onNodeClickBound) return false;
      }
      for (let i = 0; i < this.cfg.MFD_LEFT_BUTTON_COUNT; i++) {
        if (handlers[this.getLeftButtonPartName(i)] !== this.onNodeClickBound) return false;
      }
      for (let i = 0; i < this.cfg.MFD_RIGHT_BUTTON_COUNT; i++) {
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
      for (let i = 0; i < this.cfg.MFD_TOP_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(this.getTopButtonPartName(i), this.onNodeClickBound);
      }
      for (let i = 0; i < this.cfg.MFD_BOTTOM_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(this.getBottomButtonPartName(i), this.onNodeClickBound);
      }
      for (let i = 0; i < this.cfg.MFD_LEFT_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(this.getLeftButtonPartName(i), this.onNodeClickBound);
      }
      for (let i = 0; i < this.cfg.MFD_RIGHT_BUTTON_COUNT; i++) {
        controlsApi.addNodeClickHandler(this.getRightButtonPartName(i), this.onNodeClickBound);
      }
      this.nodeClickHandlerInstalled = true;
      return true;
    }

    removeNodeClickHandler() {
      const controlsApi = window.controls;
      if (!this.nodeClickHandlerInstalled || !controlsApi?.nodeClickHandlers) return;

      delete controlsApi.nodeClickHandlers[this.names.MFD_PART_NAME];
      for (let i = 0; i < this.cfg.MFD_TOP_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[this.getTopButtonPartName(i)];
      }
      for (let i = 0; i < this.cfg.MFD_BOTTOM_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[this.getBottomButtonPartName(i)];
      }
      for (let i = 0; i < this.cfg.MFD_LEFT_BUTTON_COUNT; i++) {
        delete controlsApi.nodeClickHandlers[this.getLeftButtonPartName(i)];
      }
      for (let i = 0; i < this.cfg.MFD_RIGHT_BUTTON_COUNT; i++) {
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

    // Returns normalized click coordinates for MFD hit-testing.
    getClickScreenCoords() {
      return HelperModule.getClickScreenCoords();
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

      const count = side === 'top'
        ? this.cfg.MFD_TOP_BUTTON_COUNT
        : side === 'bottom'
          ? this.cfg.MFD_BOTTOM_BUTTON_COUNT
        : side === 'left'
          ? this.cfg.MFD_LEFT_BUTTON_COUNT
          : this.cfg.MFD_RIGHT_BUTTON_COUNT;

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
      for (let i = 0; i < this.cfg.MFD_TOP_BUTTON_COUNT; i++) {
        if (nodeName === this.getTopButtonPartName(i)) return true;
      }
      for (let i = 0; i < this.cfg.MFD_BOTTOM_BUTTON_COUNT; i++) {
        if (nodeName === this.getBottomButtonPartName(i)) return true;
      }
      for (let i = 0; i < this.cfg.MFD_LEFT_BUTTON_COUNT; i++) {
        if (nodeName === this.getLeftButtonPartName(i)) return true;
      }
      for (let i = 0; i < this.cfg.MFD_RIGHT_BUTTON_COUNT; i++) {
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
        for (let i = 0; i < this.cfg.MFD_TOP_BUTTON_COUNT; i++) {
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
        for (let i = 0; i < this.cfg.MFD_BOTTOM_BUTTON_COUNT; i++) {
          if (nodeName === this.getBottomButtonPartName(i)) return i;
        }
        return -1;
      })();

      if (bottomButtonIndex >= 0) {
        const uiState = this.getUiState();
        uiState?.setPage?.(this.cfg.MFD_TOP_BUTTON_COUNT + bottomButtonIndex);
        return true;
      }

      const leftButtonIndex = (() => {
        for (let i = 0; i < this.cfg.MFD_LEFT_BUTTON_COUNT; i++) {
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
        for (let i = 0; i < this.cfg.MFD_RIGHT_BUTTON_COUNT; i++) {
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

      const click = clickOverride ?? this.getClickScreenCoords();
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
        uiState?.setPage?.(this.cfg.MFD_TOP_BUTTON_COUNT + pickedBottomButtonIndex);
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
    const slot = normalizeOptionToken(slotName || 'LEFT') || 'LEFT';
    return addonRuntime.mfdUiStates?.[slot] ?? null;
  }

  // Ensures MFD UI state objects exist before external MFD page operations.
  function ensureMfdUiStatesReady() {
    addonRuntime.mainPlugin?.mfdModules?.forEach((mfdModule) => {
      mfdModule?.ensureUiState?.();
    });
    return Object.values(addonRuntime.mfdUiStates ?? {});
  }

  // Normalizes an external page definition to the expected MFD page structure.
  function normalizeMfdPageDefinition(pageDefinition, fallbackTitle = 'PAGE') {
    const source = (pageDefinition && typeof pageDefinition === 'object') ? pageDefinition : {};
    const titleRaw = String(source.title ?? fallbackTitle).trim();
    const title = titleRaw || String(fallbackTitle || 'PAGE').trim() || 'PAGE';
    const leftButtons = Array.isArray(source.leftButtons) ? source.leftButtons : [];
    const rightButtons = Array.isArray(source.rightButtons) ? source.rightButtons : [];
    const lines = Array.isArray(source.lines) ? source.lines : [];
    const render = typeof source.render === 'function' ? source.render : null;
    return {
      ...source,
      title,
      leftButtons,
      rightButtons,
      lines,
      render
    };
  }

  // Resolves a page target to an index using number or title lookup.
  function resolveMfdPageTargetIndex(uiState, target) {
    if (!uiState || !Array.isArray(uiState.pages)) return -1;
    if (Number.isInteger(target)) {
      return target >= 0 && target < uiState.pages.length ? target : -1;
    }

    const titleToken = String(target ?? '').trim().toUpperCase();
    if (!titleToken) return -1;
    return uiState.pages.findIndex((p) => String(p?.title ?? '').trim().toUpperCase() === titleToken);
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
        setProbeState: (state) => addonRuntime.mainPlugin?.controlModule?.setProbeState?.(state) ?? false,
        getProbeState: () => getOption('SYS', 'REFUELING', 'CLOSED')
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
            const normalized = normalizeMfdPageDefinition(pageDefinition, fallbackTitle);
            uiState.pages.splice(nextIndex, 0, normalized);
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
            const normalized = normalizeMfdPageDefinition(pageDefinition, currentTitle);
            uiState.pages[resolvedIndex] = normalized;
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
          addonRuntime.mainPlugin?.stop?.();
          addonRuntime.mainPlugin = null;
          addonRuntime.mfdRuntimeRefs = Object.create(null);
          return true;
        },
        restart: () => {
          addonRuntime.mainPlugin?.stop?.();
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
