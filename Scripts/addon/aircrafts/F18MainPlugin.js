(function () {
  'use strict';

  class F18MainPlugin extends window.BasePlugin {
    static AIRCRAFT_ID = '27';
    static DEFAULT_MFD_LAYOUT = [
      {
        name: 'LEFT',
        position: [-0.2160, 6.158, 0.584],
        rotation: [8, 0, 0],
        scale: [0.29, 0.29, 0.285],
        defaultPageTitle: 'NAV'
      },
      {
        name: 'RIGHT',
        position: [0.2167, 6.158, 0.584],
        rotation: [8, 0, 0],
        scale: [0.29, 0.29, 0.285],
        defaultPageTitle: 'SYS'
      },
      {
        name: 'CENTER',
        position: [-0.003, 6.085, 0.335],
        rotation: [23.5, 0, 0],
        scale: [0.335, 0.335, 0.335],
        defaultPageTitle: 'CHK'
      }
    ];

    static CAMERA_CONFIG = {
      cockpitViewPresets: [
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
      ],
      cameraModeDefinitions: {
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
      }
    };

    constructor(config = {}) {
      super({ id: 'F18', version: config.version ?? '2.0.0' });
      OptionModule.initializeStorageKey(this.id, 'F18Options');

      console.log(`[F18MainPlugin] Initializing plugin version ${this.version}...`);

      // Initialize window.F18Addon with all modules
      window.F18Addon = {
        version: this.version,
        options: {
          buildKey: OptionModule.buildOptionKey,
          read: OptionModule.readOptions,
          write: OptionModule.writeOptions,
          get: OptionModule.getOption,
          set: OptionModule.setOption,
          getValue: OptionModule.getOptionValue
        },
        // Instantiate all modules directly under F18Addon
        weapons: new WeaponModule({
          ...window.WeaponModuleDefaults?.fighter,
          storageKey: 'F18WpnState'
        }),
        checklists: ChecklistModule.loadDefaults('f18') ?? new ChecklistModule(),
        helper: new HelperModule(),
        dataCartridge: null,
        map: null,
        nav: null,
        communication: new CommunicationModule(),
        system: new SystemModule(),
        adi: new AdiModule(),
        radar: null,
        targetingPod: null,
        hud: new F18HudModule(),
        camera: null, // Will be initialized with helper reference
        fmc: new FMCModule(),
        controls: null, // Will be initialized with helper reference
        recorder: new RecorderModule(),
        mfd: MfdModule,
        lifecycle: {
          start: () => this.start(),
          stop: () => this.stop(),
          restart: () => this.restart(),
          isRunning: () => this.isRunning()
        }
      };

      // Initialize modules that need helper reference
      window.F18Addon.camera = new CameraModule(window.F18Addon.helper, F18MainPlugin.CAMERA_CONFIG);
      window.F18Addon.controls = new ControlModule(window.F18Addon.helper);
      window.F18Addon.dataCartridge = new DataCartridgeModule();
      window.F18Addon.nav = new NavModule();
      window.F18Addon.map = new MapModule();
      window.F18Addon.radar = new RadarModule({ navModule: window.F18Addon.nav });
      window.F18Addon.targetingPod = new TargetingPodModule(() => window.F18Addon);
      window.F18Addon.nav.setMapModule(window.F18Addon.map);
      window.F18Addon.nav.setDataCartridgeModule(window.F18Addon.dataCartridge);
      window.F18Addon.map.setNavModule(window.F18Addon.nav);

      // Create MFD module
      window.F18Addon.mfd = new MfdModule(
        window.F18Addon.helper,
        window.F18Addon.map,
        window.F18Addon.camera,
        window.F18Addon.weapons,
        window.F18Addon.recorder
      );

      // Register MFD pages from each module
      window.F18Addon.recorder.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.hud.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.system.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.checklists.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.weapons.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.nav.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.radar.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.communication.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.adi.registerMfdPages(window.F18Addon.mfd);
      window.F18Addon.targetingPod.registerMfdPages(window.F18Addon.mfd);

      this.setManagedModules([
        window.F18Addon.controls
      ]);
    }

    registerF18Controls() {
      if (!this.isAircraftActive()) return false;

      return this.runOnce('F18ControlsRegistered', () => {
        window.F18Addon.controls.registerControl({
          key: 'SYS.CANOPY',
          padLabel: 'CANOPY',
          defaultState: 'CLOSED',
          durationMs: 5000,
          parts: [
            {
              partName: 'CanopyFrameCockpit',
              motion: {
                OPEN: { delayMs: 0, durationMs: 5000 },
                CLOSED: { delayMs: 0, durationMs: 5000 }
              },
              channels: {
                CanopyFrameCockpitRotXDeg: { OPEN: -40, CLOSED: 0 },
                CanopyFrameCockpitRotYDeg: { OPEN: 0, CLOSED: 0 },
                CanopyFrameCockpitRotZDeg: { OPEN: 0, CLOSED: 0 }
              }
            },
            {
              partName: 'CanopyFrame',
              motion: {
                OPEN: { delayMs: 0, durationMs: 5000 },
                CLOSED: { delayMs: 0, durationMs: 5000 }
              },
              channels: {
                CanopyFrameRotXDeg: { OPEN: -40, CLOSED: 0 },
                CanopyFrameRotYDeg: { OPEN: 0, CLOSED: 0 },
                CanopyFrameRotZDeg: { OPEN: 0, CLOSED: 0 }
              }
            },
            {
              partName: 'CanopyArm',
              motion: {
                OPEN: { delayMs: 0, durationMs: 5000 },
                CLOSED: { delayMs: 0, durationMs: 5000 }
              },
              channels: {
                CanopyArmRotXDeg: { OPEN: -40, CLOSED: 0 },
                CanopyArmRotYDeg: { OPEN: 0, CLOSED: 0 },
                CanopyArmRotZDeg: { OPEN: 0, CLOSED: 0 }
              }
            }
          ]
        });

        window.F18Addon.controls.registerControl({
        key: 'SYS.REFUELING',
        padLabel: 'PROBE',
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
      });
    }

    isAircraftActive() {
      return window.geofs?.aircraft?.instance?.id === F18MainPlugin.AIRCRAFT_ID;
    }

    getMfdPages() {
      return window.F18Addon.mfd.pageRegistry;
    }

    tryInstall() {
      // Core modules
      const hudReady = window.F18Addon?.hud?.ensureLoaded();
      const cameraReady = window.F18Addon?.camera?.ensureLoaded();
      const fmcReady = window.F18Addon?.fmc?.ensureLoaded();
      const controlsReady = window.F18Addon?.controls?.ensureLoaded();
      const communicationReady = window.F18Addon?.communication?.ensureLoaded();

      if (this.isAircraftActive()) {
        this.registerF18Controls();
      }
      
      // MFD system
      const mfdReady = window.F18Addon.mfd.ensureLoaded();
      
      // Return true if core systems are ready
      return hudReady
        && cameraReady
        && fmcReady
        && controlsReady
        && communicationReady
        && mfdReady;
    }

    start() {
      if (!this.startLifecycle()) return;

      // Initialize MFDs
      window.F18Addon.mfd.initializeDefaultMfds(F18MainPlugin.DEFAULT_MFD_LAYOUT);
      window.F18Addon.mfd.startCameraWatch();

      this.tickActive();
    }

    tickActive() {
      this.runInstallTick('F18MainPlugin', () => this.tryInstall());
    }

    stop() {
      if (!this.stopLifecycle()) return;

      window.F18Addon?.weapons?.stopGunFireTimer();
      window.F18Addon?.mfd?.restore();
      
      window.F18Addon?.communication?.restore();
      window.F18Addon?.fmc?.restore();
      window.F18Addon?.camera?.restore();
      window.F18Addon?.hud?.restore();
    }

    restart() {
      this.stop();
      this.start();
    }

    isRunning() {
      return this.running;
    }
  }

  window.F18MainPlugin = F18MainPlugin;
})();
