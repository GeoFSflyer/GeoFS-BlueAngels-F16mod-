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
      group: '',
      flight: '',
      wingman: '',
      flightData: {
        startTimeZ: '',
        startTaxiZ: '',
        startToZ: '',
        timeOverTargetZ: '',
        endTimeZ: ''
      },
      positions: [],
      cruise: {
        altitude: '',
        speed: ''
      },
      notes: '',
      landing: {
        airportIcao: '',
        runway: '',
        nav1: '',
        pattern: '',
        formation: '',
        altEntryAgl: '',
        speedEntryKn: '',
        pitchIntervalS: '',
        speedDownwindKn: ''
      },
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
    normalized.group = src.group ?? '';
    normalized.flight = src.flight ?? '';
    normalized.wingman = src.wingman ?? '';
    normalized.flightData = this._clone(src.flightData ?? normalized.flightData);
    normalized.positions = this._clone(src.positions ?? []);
    normalized.cruise = this._clone(src.cruise ?? normalized.cruise);
    normalized.notes = src.notes ?? src.cruise?.notes ?? '';
    normalized.landing = this._clone(src.landing ?? normalized.landing);
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

  setMarkpointType(index, type) {
    const markpoint = this.data.markpoints[index];
    if (!markpoint) return false;
    markpoint.type = type;
    this._emitUpdate();
    return true;
  }

  setActiveMarkpoint(index) {
    if (!this.data.markpoints[index]) return false;
    for (let i = 0; i < this.data.markpoints.length; i++) {
      this.data.markpoints[i].active = i === index;
    }
    this._emitUpdate();
    return true;
  }

  getActiveMarkpoint() {
    const active = this.data.markpoints.find((markpoint) => markpoint?.active);
    return active ? this._clone(active) : null;
  }

  deleteMarkpoint(index) {
    if (!this.data.markpoints[index]) return false;
    this.data.markpoints.splice(index, 1);
    this._emitUpdate();
    return true;
  }

  getMissionData() {
    return this._clone(this.data);
  }

  getMissionName() {
    return this.data.missionName;
  }

  getGroup() {
    return this.data.group;
  }

  getFlight() {
    return this.data.flight;
  }

  getWingman() {
    return this.data.wingman;
  }

  getFlightData() {
    return this._clone(this.data.flightData);
  }

  getPositions() {
    return this._clone(this.data.positions);
  }

  getCruise() {
    return this._clone(this.data.cruise);
  }

  getNotes() {
    return this.data.notes ?? '';
  }

  getLanding() {
    return this._clone(this.data.landing);
  }

  getFlightPlan() {
    return this._clone(this.data.flightPlan);
  }

  getNavaids() {
    return this._clone(this.data.navaids);
  }

  getMarkpoints() {
    return this._clone(this.data.markpoints);
  }

  getAreas() {
    return this._clone(this.data.areas);
  }

  getChecklists() {
    return this._clone(this.data.checklists);
  }

  getIffCodes() {
    return this._clone(this.data.iffCodes);
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
