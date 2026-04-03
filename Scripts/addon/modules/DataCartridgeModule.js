class DataCartridgeModule {
  static AREA_STYLE_BY_TYPE = {
    SAM: { color: '#ff5252', fillColor: '#ff5252', fillOpacity: 0.18 },
    NOFLY: { color: '#ff9800', fillColor: '#ff9800', fillOpacity: 0.16 },
    UNRESTRICTED: { color: '#4caf50', fillColor: '#4caf50', fillOpacity: 0.12 },
    DANGER: { color: '#9c27b0', fillColor: '#9c27b0', fillOpacity: 0.16 },
    AREA: { color: '#03a9f4', fillColor: '#03a9f4', fillOpacity: 0.14 }
  };

  static MARKPOINT_COLOR_BY_TYPE = {
    TARGET: '#f44336',
    FRIENDLY: '#2196f3',
    RESQUE: '#ff9800',
    CIVILIAN: '#4caf50'
  };

  static NAVAID_COLOR_BY_MISSION_TYPE = {
    CIVILIAN: '#4caf50',
    FOO: '#f44336',
    FRIEND: '#2196f3',
    ALTERNATE: '#ff9800'
  };

  constructor() {
    this.data = this._newData();
  }

  _newData() {
    return {
      version: 1,
      source: 'empty',
      missionName: 'Untitled Mission',
      loadedAt: null,
      flightPlan: [],
      navaids: [],
      markpoints: [],
      areas: [],
      checklists: [],
      iffCodes: []
    };
  }

  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  _nextMarkpointId() {
    if (!Array.isArray(this.data?.markpoints) || !this.data.markpoints.length) return 1;
    return this.data.markpoints.reduce((maxId, item) => Math.max(maxId, Number(item?.id) || 0), 0) + 1;
  }

  _emitUpdate() {
    window.dispatchEvent(new CustomEvent('GeoFSDataCartridge:updated', {
      detail: this.getMissionData()
    }));
  }

  clear() {
    this.data = this._newData();
    this._emitUpdate();
    return true;
  }

  loadMissionData(missionData, options = {}) {
    const src = missionData;
    const loadedAt = new Date().toISOString();

    const normalized = this._newData();
    normalized.source = options.source ?? 'mission-planner';
    normalized.missionName = src.name ?? src.missionName ?? 'Untitled Mission';
    normalized.loadedAt = loadedAt;
    normalized.flightPlan = this._clone(src.flightPlan ?? []);
    normalized.checklists = this._clone(src.checklists ?? []);
    normalized.iffCodes = this._clone(src.iffCodes ?? []);
    normalized.navaids = this._clone(src.navaids ?? []);
    normalized.markpoints = this._clone(src.markpoints ?? []);
    normalized.areas = this._clone(src.areas ?? []).sort((a, b) => a.order - b.order);

    this.data = normalized;
    this._emitUpdate();
    return true;
  }

  addTgpMarkpoint(point, options = {}) {
    const nextId = this._nextMarkpointId();
    const markpoint = {
      id: nextId,
      name: options.name ?? `TGP Markpoint ${nextId}`,
      abbreviation: options.abbreviation ?? `TGP${nextId}`,
      type: options.type ?? 'TARGET',
      lat: point.lat,
      lon: point.lon,
      altM: point.altM ?? null,
      source: 'TGP'
    };

    this.data.markpoints.push(markpoint);
    this._emitUpdate();
    return this._clone(markpoint);
  }

  getMissionData() {
    return this._clone(this.data);
  }

  getRenderableData() {
    const data = this.getMissionData();
    return {
      missionName: data.missionName,
      loadedAt: data.loadedAt,
      navaids: data.navaids,
      markpoints: data.markpoints,
      areas: data.areas
    };
  }

  getAreaStyle(type) {
    return this._clone(DataCartridgeModule.AREA_STYLE_BY_TYPE[type] ?? DataCartridgeModule.AREA_STYLE_BY_TYPE.AREA);
  }

  getMarkpointColor(type) {
    return DataCartridgeModule.MARKPOINT_COLOR_BY_TYPE[type] ?? '#00bcd4';
  }

  getNavaidColor(missionType) {
    return DataCartridgeModule.NAVAID_COLOR_BY_MISSION_TYPE[missionType ?? 'FRIEND'] ?? '#2196f3';
  }
}

window.DataCartridgeModule = DataCartridgeModule;
