
  class OptionModule {
    static STORAGE_KEY = 'F18Options';
    static storageKeysByAircraft = Object.create(null);
    static optionKeyCache = Object.create(null);
    static optionStoreCache = null;

    static initializeStorageKey(aircraftId, storageKey) {
      OptionModule.storageKeysByAircraft[aircraftId] = storageKey;
      return true;
    }

    static useStorageKeyForAircraft(aircraftId) {
      const nextStorageKey = OptionModule.storageKeysByAircraft[aircraftId];
      if (!nextStorageKey || nextStorageKey === OptionModule.STORAGE_KEY) return false;
      OptionModule.STORAGE_KEY = nextStorageKey;
      OptionModule.optionStoreCache = null;
      return true;
    }

    static normalizeOptionToken(value) {
      return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    static getCachedOptionKey(pageTitle, buttonKey) {
      const pageToken = OptionModule.normalizeOptionToken(pageTitle);
      const buttonToken = OptionModule.normalizeOptionToken(buttonKey);
      const cacheId = `${pageToken}\u0000${buttonToken}`;
      let optionKey = OptionModule.optionKeyCache[cacheId];
      if (optionKey) return optionKey;

      optionKey = `${pageToken}.${buttonToken}`;
      OptionModule.optionKeyCache[cacheId] = optionKey;
      return optionKey;
    }

    static buildOptionKey(pageTitle, buttonKey) {
      return OptionModule.getCachedOptionKey(pageTitle, buttonKey);
    }

    static readOptions() {
      if (OptionModule.optionStoreCache) return OptionModule.optionStoreCache;

      const raw = window.localStorage.getItem(OptionModule.STORAGE_KEY);
      if (!raw) {
        OptionModule.optionStoreCache = {};
        return OptionModule.optionStoreCache;
      }

      OptionModule.optionStoreCache = JSON.parse(raw);
      return OptionModule.optionStoreCache;
    }

    static getOption(pageTitle, buttonKey, fallback = null) {
      const options = OptionModule.readOptions();
      const optionKey = OptionModule.buildOptionKey(pageTitle, buttonKey);
      return options[optionKey] ?? fallback;
    }

    static writeOptions(options) {
      const payload = options ?? {};
      OptionModule.optionStoreCache = payload;
      window.localStorage.setItem(OptionModule.STORAGE_KEY, JSON.stringify(payload));
      return true;
    }

    static setOption(pageTitle, buttonKey, value) {
      const options = OptionModule.readOptions();
      const optionKey = OptionModule.getCachedOptionKey(pageTitle, buttonKey);
      options[optionKey] = value;
      OptionModule.writeOptions(options);
    }

    static getOptionValue(pageTitle, buttonKey, fallback = null) {
      const selectedState = OptionModule.getOption(pageTitle, buttonKey, null);
      const pages = window.BasePlugin.getActiveMfdPages();
      if (!pages.length) return selectedState ?? fallback;

      const page = pages.find((p) => p?.title === pageTitle);
      if (!page) return selectedState ?? fallback;

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
  }
