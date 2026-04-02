(function () {
  'use strict';

  const CORE_VERSION = '1.0.0';

  class HelperModule {
    // Parses a semantic version string (major.minor.patch).
    static parseSemver(version) {
      const [major, minor, patch] = version.split('.').map(Number);
      return { major, minor, patch };
    }

    // Returns true when version >= minimumVersion.
    static isSemverAtLeast(version, minimumVersion) {
      const a = HelperModule.parseSemver(version);
      const b = HelperModule.parseSemver(minimumVersion);
      if (a.major !== b.major) return a.major > b.major;
      if (a.minor !== b.minor) return a.minor > b.minor;
      return a.patch >= b.patch;
    }
  }

  class AddonRegistryModule {
    constructor() {
      this.plugins = Object.create(null);
    }

    // Registers one aircraft plugin descriptor.
    register(plugin) {
      this.plugins[plugin.id] = plugin;
      return plugin;
    }

    // Returns one registered aircraft plugin descriptor.
    get(id) {
      return this.plugins[id] ?? null;
    }

    // Returns all registered aircraft plugin descriptors.
    list() {
      return Object.values(this.plugins);
    }
  }

  if (window.GeoFSAddonCore) {
    return;
  }

  window.GeoFSAddonCore = {
    version: CORE_VERSION,
    HelperModule,
    registry: new AddonRegistryModule()
  };

  if (!window.addonRuntime) {
    window.addonRuntime = {
      checklistModule: null,
      mapModule: null,
      navModule: null,
      communicationModule: null,
      mfdUiStates: Object.create(null),
      mfdPagesCatalog: null,
      mfdRuntimeRefs: Object.create(null),
      navRdrRuntime: { bootStartMs: 0 },
      mainPlugin: null
    };
  }
})();

var addonRuntime = window.addonRuntime;
