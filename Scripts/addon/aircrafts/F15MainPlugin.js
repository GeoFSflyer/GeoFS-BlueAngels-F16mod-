(function () {
  'use strict';

  class F15MainPlugin extends window.BasePlugin {
    static AIRCRAFT_ID = '3591';
    static DEFAULT_MFD_LAYOUT = [
      {
        name: 'LEFT',
        position: [-0.2, 7.12, 0.795],
        rotation: [9, 0, 0],
        scale: [0.25, 0.25, 0.25],
        defaultPageTitle: 'NAV'
      },
      {
        name: 'RIGHT',
        position: [0.201, 7.107, 0.808],
        rotation: [9, 0, 0],
        scale: [0.23, 0.23, 0.23],
        defaultPageTitle: 'SYS'
      },
      {
        name: 'CENTER',
        position: [-0.308, 7.096, 0.608],
        rotation: [9, 0, 0],
        scale: [0.27, 0.27, 0.27],
        defaultPageTitle: 'CHK'
      }
    ];

    static CAMERA_CONFIG = {
      cockpitViewPresets: [],
      cameraModeDefinitions: {}
    };

    constructor(config = {}) {
      super({ id: 'F15', version: config.version ?? '2.0.0' });
      OptionModule.initializeStorageKey(this.id, 'F15Options');

      console.log(`[F15MainPlugin] Initializing plugin version ${this.version}...`);

      // Initialize window.F15Addon with all modules
      window.F15Addon = {
        version: this.version,
        options: {
          buildKey: OptionModule.buildOptionKey,
          read: OptionModule.readOptions,
          write: OptionModule.writeOptions,
          get: OptionModule.getOption,
          set: OptionModule.setOption,
          getValue: OptionModule.getOptionValue
        },
        // Instantiate all modules directly under F15Addon
        weapons: new WeaponModule({
          ...window.WeaponModuleDefaults?.fighter,
          storageKey: 'F15WpnState'
        }),
        checklists: ChecklistModule.loadDefaults('f18') ?? new ChecklistModule(),
        helper: new HelperModule(),
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
      window.F15Addon.camera = new CameraModule(window.F15Addon.helper, F15MainPlugin.CAMERA_CONFIG);
      window.F15Addon.controls = new ControlModule(window.F15Addon.helper);
      window.F15Addon.nav = new NavModule();
      window.F15Addon.map = new MapModule();
      window.F15Addon.radar = new RadarModule({ navModule: window.F15Addon.nav });
      window.F15Addon.targetingPod = new TargetingPodModule(() => window.F15Addon);
      window.F15Addon.nav.setMapModule(window.F15Addon.map);
      window.F15Addon.map.setNavModule(window.F15Addon.nav);

      // Create MFD module BEFORE page registration
      window.F15Addon.mfd = new MfdModule(
        window.F15Addon.helper,
        window.F15Addon.map,
        window.F15Addon.camera,
        window.F15Addon.weapons,
        window.F15Addon.recorder
      );

      // Register MFD pages from each module
      window.F15Addon.recorder.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.hud.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.system.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.checklists.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.weapons.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.nav.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.radar.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.communication.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.adi.registerMfdPages(window.F15Addon.mfd);
      window.F15Addon.targetingPod.registerMfdPages(window.F15Addon.mfd);

      this.setManagedModules([
        window.F15Addon.controls
      ]);
    }

    isAircraftActive() {
      return window.geofs?.aircraft?.instance?.id === F15MainPlugin.AIRCRAFT_ID;
    }

    getMfdPages() {
      return window.F15Addon.mfd.pageRegistry;
    }

    tryInstall() {
      // Core modules
      const hudReady = window.F15Addon?.hud?.ensureLoaded();
      const cameraReady = window.F15Addon?.camera?.ensureLoaded();
      const fmcReady = window.F15Addon?.fmc?.ensureLoaded();
      const controlsReady = window.F15Addon?.controls?.ensureLoaded();
      const communicationReady = window.F15Addon?.communication?.ensureLoaded();
      
      // MFD module handles its own loading
      const mfdReady = window.F15Addon?.mfd?.ensureLoaded();
      
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

      // Initialize MFDs first before starting install loop
      window.F15Addon.mfd.initializeDefaultMfds(F15MainPlugin.DEFAULT_MFD_LAYOUT);
      window.F15Addon.mfd.startCameraWatch();

      this.tickActive();
    }

    tickActive() {
      this.runInstallTick('F15MainPlugin', () => this.tryInstall());
    }

    stop() {
      if (!this.stopLifecycle()) return;

      window.F15Addon?.weapons?.stopGunFireTimer();
      window.F15Addon?.mfd?.restore();
      
      window.F15Addon?.communication?.restore();
      window.F15Addon?.fmc?.restore();
      window.F15Addon?.camera?.restore();
      window.F15Addon?.hud?.restore();
    }

    restart() {
      this.stop();
      this.start();
    }

    isRunning() {
      return this.running;
    }
  }

  window.F15MainPlugin = F15MainPlugin;
})();
