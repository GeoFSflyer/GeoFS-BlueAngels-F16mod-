// ==UserScript==
// @name         GeoFS Mission Planner
// @namespace    https://www.geo-fs.com/
// @version      0.1.0
// @description  Plan your mission upfront, share it with your flight members and execute it together in GeoFS!
// @match        https://www.geo-fs.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (!window.__GeoFSMissionPlannerV2Loaded) {
    window.__GeoFSMissionPlannerV2Loaded = true;

    const STORAGE_KEY_V2 = 'GeoFSMissionPlanner.v2';
    const API_VERSION_V2 = '1.0.0';
    const AREA_TYPES = ['SAM', 'NOFLY', 'UNRESTRICTED', 'DANGER', 'AREA'];
    const AREA_GROUPS = ['FRIENDLY', 'FOO', 'CIVILIAN', 'UNKNOWN'];
    const MARKPOINT_TYPES = ['TARGET', 'FRIENDLY', 'RESQUE', 'CIVILIAN'];
    const NAVAID_MISSION_TYPES = ['CIVILIAN', 'FOO', 'FRIEND', 'ALTERNATE'];
    const AREA_VARIANTS = ['POLYGON', 'SQUARE', 'CIRCLE'];
    const DEFAULT_FLP_CHECKLISTS = [
      'Briefing - Air Tasking Order',
      'Briefing - Flight',
      'Briefing - Positions',
      'Briefing - Enroute',
      'Briefing - Landing'
    ];
    const AREA_STYLE_BY_TYPE = {
      SAM: { color: '#ff5252', fillColor: '#ff5252', fillOpacity: 0.18 },
      NOFLY: { color: '#ff9800', fillColor: '#ff9800', fillOpacity: 0.16 },
      UNRESTRICTED: { color: '#4caf50', fillColor: '#4caf50', fillOpacity: 0.12 },
      DANGER: { color: '#9c27b0', fillColor: '#9c27b0', fillOpacity: 0.16 },
      AREA: { color: '#03a9f4', fillColor: '#03a9f4', fillOpacity: 0.14 }
    };
    const MARKPOINT_COLOR_BY_TYPE = {
      TARGET: '#f44336',
      FRIENDLY: '#2196f3',
      RESQUE: '#ff9800',
      CIVILIAN: '#4caf50'
    };
    const NAVAID_COLOR_BY_MISSION_TYPE = {
      CIVILIAN: '#4caf50',
      FOO: '#f44336',
      FRIEND: '#2196f3',
      ALTERNATE: '#ff9800'
    };

    function makeIffCodes() {
      const out = [];
      for (let i = 1; i <= 14; i += 1) {
        out.push({ key: String(i).padStart(2, '0'), response: String(100 + Math.floor(Math.random() * 900)) });
      }
      return out;
    }

    function cloneData(value) {
      return JSON.parse(JSON.stringify(value));
    }

    class MissionStoreV2 {
      constructor() {
        this.mission = this.newMission('Untitled Mission');
      }

      newMission(name) {
        return {
          version: 1,
          name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          flightPlan: [],
          markpoints: [],
          areas: [],
          navaids: [],
          checklists: DEFAULT_FLP_CHECKLISTS.map((title, index) => ({ id: index + 1, type: 'FLP', title, items: [] })),
          iffCodes: makeIffCodes()
        };
      }

      touch() {
        this.mission.updatedAt = new Date().toISOString();
        this.saveLocal();
        window.dispatchEvent(new CustomEvent('GeoFSMissionPlanner:updated', { detail: cloneData(this.mission) }));
      }

      saveLocal() {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(this.mission));
      }

      loadLocal() {
        const raw = localStorage.getItem(STORAGE_KEY_V2);
        if (!raw) {
          return false;
        }
        this.mission = JSON.parse(raw);
        this.touch();
        return true;
      }

      syncFlightPlan() {
        this.mission.flightPlan = geofs.flightPlan.waypointArray.map((wp) => ({
          id: wp.id,
          ident: wp.ident,
          lat: wp.lat,
          lon: wp.lon,
          type: wp.type,
          alt: wp.alt,
          spd: wp.spd,
          heading: wp.heading,
          track: wp.track
        }));
        this.touch();
      }
    }

    class MapAdapterV2 {
      constructor() {
        this.map = geofs.api.map._map;
        this.layers = {
          draft: L.layerGroup().addTo(this.map),
          mission: L.layerGroup().addTo(this.map)
        };
        this.navaidAddCallback = null;
        this.markpointAddCallback = null;
        this.areaSelectCallback = null;
        this.markpointSelectCallback = null;
        this.map.on('popupopen', (e) => this.decoratePopup(e));
      }

      setNavaidAddCallback(cb) {
        this.navaidAddCallback = cb;
      }

      setMarkpointAddCallback(cb) {
        this.markpointAddCallback = cb;
      }

      setAreaSelectCallback(cb) {
        this.areaSelectCallback = cb;
      }

      setMarkpointSelectCallback(cb) {
        this.markpointSelectCallback = cb;
      }

      decoratePopup(event) {
        const source = event.popup._source;
        const contentNode = event.popup.getElement().querySelector('.leaflet-popup-content');

        if (source && source.options && source.options.navaid && !contentNode.querySelector('.geofs-mp-addNavaid')) {
          const navaid = source.options.navaid;
          const isGpsFix = navaid.type === 'FIX' || navaid.freq === 'GPS';
          if (!isGpsFix) {
            const chip = document.createElement('span');
            chip.className = 'mdl-chip geofs-mp-addNavaid';
            chip.style.cursor = 'pointer';
            chip.style.display = 'table';
            chip.style.margin = '10px auto 0';
            chip.style.setProperty('padding', '0 12px 0 0', 'important');
            chip.innerHTML = '<span class="mdl-chip__contact mdl-color-text--white" style="background:#2f5f8f">MP</span><span class="mdl-chip__text">Add Navaid to Mission</span>';
            chip.addEventListener('click', () => {
              this.navaidAddCallback(navaid);
              geofs.api.map.closeAllPopups();
            });
            contentNode.appendChild(chip);
          }
        }

        if (source && source.options && source.options.runway && !contentNode.querySelector('.geofs-mp-addRunway')) {
          const runway = source.options.runway;
          const chip = document.createElement('span');
          chip.className = 'mdl-chip geofs-mp-addRunway';
          chip.style.cursor = 'pointer';
          chip.style.display = 'table';
          chip.style.margin = '10px auto 0';
          chip.style.setProperty('padding', '0 12px 0 0', 'important');
          chip.innerHTML = '<span class="mdl-chip__contact mdl-color-text--white" style="background:#2f5f8f">MP</span><span class="mdl-chip__text">Add Navaid to Mission</span>';
          chip.addEventListener('click', () => {
            this.navaidAddCallback(runway);
            geofs.api.map.closeAllPopups();
          });
          contentNode.appendChild(chip);
        }

        if (!contentNode.querySelector('.geofs-mp-addMarkpoint')) {
          const popupLatLng = event.popup.getLatLng();
          const chip = document.createElement('span');
          chip.className = 'mdl-chip geofs-mp-addMarkpoint';
          chip.style.cursor = 'pointer';
          chip.style.display = 'table';
          chip.style.margin = '10px auto 0';
          chip.style.setProperty('padding', '0 12px 0 0', 'important');
          chip.innerHTML = '<span class="mdl-chip__contact mdl-color-text--white" style="background:#4f6b4f">MP</span><span class="mdl-chip__text">Markpoint</span>';
          chip.addEventListener('click', () => {
            this.markpointAddCallback([popupLatLng.lat, popupLatLng.lng]);
            geofs.api.map.closeAllPopups();
          });
          contentNode.appendChild(chip);
        }
      }

      clearDraft() {
        this.layers.draft.clearLayers();
      }

      renderMission(mission) {
        this.layers.mission.clearLayers();

        mission.areas
          .slice()
          .sort((a, b) => a.order - b.order)
          .forEach((area) => {
            const style = { ...AREA_STYLE_BY_TYPE[area.type], weight: 2 };
            let layer;
            if (area.variant === 'CIRCLE') {
              layer = L.circle(area.center, { ...style, radius: area.radius }).addTo(this.layers.mission).bindTooltip(`${area.name} (${area.type}/${area.group})`);
            } else {
              layer = L.polygon(area.points, style).addTo(this.layers.mission).bindTooltip(`${area.name} (${area.type}/${area.group})`);
            }
            if (layer) {
              layer.on('click', () => {
                if (this.areaSelectCallback) {
                  this.areaSelectCallback(area.id);
                }
              });
            }
          });

        mission.markpoints.forEach((m) => {
          const color = MARKPOINT_COLOR_BY_TYPE[m.type] || '#00bcd4';
          const layer = L.circleMarker([m.lat, m.lon], {
            radius: 5,
            color: '#ffffff',
            fillColor: color,
            fillOpacity: 1,
            weight: 1
          }).addTo(this.layers.mission).bindTooltip(`${m.abbreviation} (${m.type})`);
          layer.on('click', () => {
            if (this.markpointSelectCallback) {
              this.markpointSelectCallback(m.id);
            }
          });
        });

        mission.navaids.forEach((n) => {
          const missionType = n.missionType || 'FRIEND';
          const color = NAVAID_COLOR_BY_MISSION_TYPE[missionType] || '#2196f3';
          L.circleMarker([n.lat, n.lon], {
            radius: 4,
            color: '#ffffff',
            fillColor: color,
            fillOpacity: 1,
            weight: 1
          }).addTo(this.layers.mission).bindTooltip(`${missionType} · ${n.ident || n.icao}`);
        });
      }
    }

    class ToolManagerV2 {
      constructor(map, onFinish, onState) {
        this.map = map;
        this.onFinish = onFinish;
        this.onState = onState;
        this.active = 'NONE';
        this.vertices = [];
        this.center = null;
        this.firstCorner = null;
        this.clickHandler = (e) => this.onClick(e);
        this.dblClickHandler = (e) => this.onDblClick(e);
      }

      start(variant) {
        this.cancel();
        this.active = variant;
        this.map.map.on('click', this.clickHandler);
        this.map.map.on('dblclick', this.dblClickHandler);
        if (variant === 'POLYGON') {
          this.map.map.doubleClickZoom.disable();
        }
        this.emit();
      }

      stop() {
        this.map.map.off('click', this.clickHandler);
        this.map.map.off('dblclick', this.dblClickHandler);
        this.map.map.doubleClickZoom.enable();
        this.active = 'NONE';
        this.vertices = [];
        this.center = null;
        this.firstCorner = null;
        this.map.clearDraft();
        this.emit();
      }

      cancel() {
        this.vertices = [];
        this.center = null;
        this.firstCorner = null;
        this.map.clearDraft();
        this.emit();
      }

      undo() {
        if (this.active === 'POLYGON' && this.vertices.length) {
          this.vertices.pop();
          this.renderDraft();
          this.emit();
        } else {
          this.cancel();
        }
      }

      finish() {
        if (this.active === 'POLYGON' && this.vertices.length >= 3) {
          this.onFinish({ variant: 'POLYGON', points: [...this.vertices] });
          this.cancel();
        }
      }

      onDblClick(event) {
        if (this.active !== 'POLYGON') {
          return;
        }
        event.originalEvent.preventDefault();
        event.originalEvent.stopPropagation();
        this.finish();
      }

      onClick(event) {
        const p = [event.latlng.lat, event.latlng.lng];

        if (this.active === 'POLYGON') {
          this.vertices.push(p);
          this.renderDraft();
          this.emit();
          return;
        }

        if (this.active === 'CIRCLE') {
          if (!this.center) {
            this.center = p;
            this.renderDraft();
            this.emit();
            return;
          }
          const radius = this.map.map.distance(this.center, p);
          this.onFinish({ variant: 'CIRCLE', center: [...this.center], radius });
          this.cancel();
          return;
        }

        if (this.active === 'SQUARE') {
          if (!this.firstCorner) {
            this.firstCorner = p;
            this.vertices = [p];
            this.renderDraft();
            this.emit();
            return;
          }
          const a = this.firstCorner;
          const b = p;
          const size = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
          const latSign = b[0] >= a[0] ? 1 : -1;
          const lonSign = b[1] >= a[1] ? 1 : -1;
          const points = [
            [a[0], a[1]],
            [a[0] + size * latSign, a[1]],
            [a[0] + size * latSign, a[1] + size * lonSign],
            [a[0], a[1] + size * lonSign]
          ];
          this.onFinish({ variant: 'SQUARE', points });
          this.cancel();
        }
      }

      renderDraft() {
        this.map.clearDraft();
        if (this.active === 'POLYGON') {
          this.vertices.forEach((v) => {
            L.circleMarker(v, { radius: 4, color: '#ffffff', fillColor: '#00e5ff', fillOpacity: 1, weight: 1 }).addTo(this.map.layers.draft);
          });
          if (this.vertices.length >= 2) {
            L.polyline(this.vertices, { color: '#00e5ff', weight: 2, dashArray: '6 4' }).addTo(this.map.layers.draft);
          }
          if (this.vertices.length >= 3) {
            L.polygon(this.vertices, { color: '#00e5ff', weight: 2, fillColor: '#00bcd4', fillOpacity: 0.15 }).addTo(this.map.layers.draft);
          }
        }
        if (this.active === 'CIRCLE' && this.center) {
          L.circleMarker(this.center, { radius: 4, color: '#ffffff', fillColor: '#00e5ff', fillOpacity: 1, weight: 1 }).addTo(this.map.layers.draft);
        }
        if (this.active === 'SQUARE' && this.firstCorner) {
          L.circleMarker(this.firstCorner, { radius: 4, color: '#ffffff', fillColor: '#00e5ff', fillOpacity: 1, weight: 1 }).addTo(this.map.layers.draft);
        }
      }

      emit() {
        const points = this.active === 'POLYGON' ? this.vertices.length : (this.center || this.firstCorner ? 1 : 0);
        this.onState({ activeTool: this.active, draftPoints: points });
      }
    }

    class MissionPlannerAppV2 {
      constructor() {
        this.store = new MissionStoreV2();
        this.map = new MapAdapterV2();
        this.pendingAreaMeta = null;
        this.areaFormState = {
          name: 'Area 1',
          variant: AREA_VARIANTS[0],
          type: AREA_TYPES[0],
          group: AREA_GROUPS[0],
          order: 1
        };
        this.tools = new ToolManagerV2(this.map, (shape) => this.handleAreaShape(shape), (s) => this.updateToolState(s));
        this.toolState = { activeTool: 'NONE', draftPoints: 0 };
        this.flightPlanSignature = '';
        this.sectionOpen = {
          mission: true,
          flightPlan: false,
          markpoints: false,
          areas: false,
          navaids: false,
          checklists: false,
          iff: false
        };

        this.map.setNavaidAddCallback((navaid) => {
          const exists = this.store.mission.navaids.some((n) => n.id === navaid.id);
          if (!exists) {
            this.store.mission.navaids.push({
              id: navaid.id,
              ident: navaid.ident || navaid.icao || navaid.name,
              name: navaid.name,
              icao: navaid.icao,
              type: navaid.type || 'RUNWAY',
              missionType: 'FRIEND',
              lat: navaid.lat,
              lon: navaid.lon,
              freq: navaid.freq
            });
            this.store.touch();
            this.render();
          }
        });

        this.map.setMarkpointAddCallback((coords) => {
          const nextId = this.store.mission.markpoints.length + 1;
          this.store.mission.markpoints.push({
            id: nextId,
            name: `Markpoint ${nextId}`,
            abbreviation: `MP${nextId}`,
            lat: coords[0],
            lon: coords[1],
            type: 'TARGET'
          });
          this.store.touch();
          this.render();
        });

        this.map.setAreaSelectCallback((areaId) => {
          this.openSectionAndFocusItem('areas', `[data-area-id="${areaId}"]`);
        });

        this.map.setMarkpointSelectCallback((markpointId) => {
          this.openSectionAndFocusItem('markpoints', `.geofs-mp-item[data-action="gotoMarkpoint"][data-id="${markpointId}"]`);
        });
      }

      init() {
        const hasLocalMission = this.store.loadLocal();
        if (hasLocalMission && Array.isArray(this.store.mission.flightPlan) && this.store.mission.flightPlan.length) {
          this.applyMissionFlightPlanToGeoFS();
        }
        this.injectStyles();
        this.createButton();
        this.createPanel();
        this.startFlightPlanSync();
        this.startButtonVisibilitySync();
        this.render();
      }

      startButtonVisibilitySync() {
        this.syncButtonVisibilityToFlightPlan();
        setInterval(() => this.syncButtonVisibilityToFlightPlan(), 300);
      }

      syncButtonVisibilityToFlightPlan() {
        if (!this.button) {
          return;
        }
        const flightPlanPad = document.querySelector('.geofs-flightPlan-pad');
        if (!flightPlanPad) {
          this.button.style.display = 'none';
          this.panel.classList.remove('geofs-visible');
          this.button.classList.remove('blue-pad');
          return;
        }
        const style = window.getComputedStyle(flightPlanPad);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        this.button.style.display = isVisible ? '' : 'none';
        if (!isVisible) {
          this.panel.classList.remove('geofs-visible');
          this.button.classList.remove('blue-pad');
        }
      }

      getFlightPlanSignature() {
        return geofs.flightPlan.waypointArray.map((wp) => `${wp.id}|${wp.ident}|${wp.lat}|${wp.lon}|${wp.type}|${wp.alt}|${wp.spd}|${wp.heading}|${wp.track}`).join(';');
      }

      resetAreaNameAndOrder(nextOrder) {
        this.areaFormState.name = `Area ${this.store.mission.areas.length + 1}`;
        this.areaFormState.order = Number.isFinite(nextOrder) ? nextOrder : (this.store.mission.areas.length + 1);
      }

      applyMissionFlightPlanToGeoFS() {
        geofs.flightPlan.waypointArray = this.store.mission.flightPlan.map((wp, index) => ({
          id: index,
          ident: wp.ident,
          lat: wp.lat,
          lon: wp.lon,
          type: wp.type,
          alt: wp.alt,
          spd: wp.spd,
          heading: wp.heading,
          track: wp.track
        }));
        geofs.flightPlan.refreshWaypoints();
      }

      startFlightPlanSync() {
        this.store.syncFlightPlan();
        this.flightPlanSignature = this.getFlightPlanSignature();
        setInterval(() => {
          const signature = this.getFlightPlanSignature();
          if (signature !== this.flightPlanSignature) {
            this.flightPlanSignature = signature;
            this.store.syncFlightPlan();
            this.render();
          }
        }, 500);
      }

      injectStyles() {
        if (document.getElementById('geofs-mission-planner-style-v2')) {
          return;
        }
        const style = document.createElement('style');
        style.id = 'geofs-mission-planner-style-v2';
        style.textContent = `
          .geofs-missionPlanner-pad{width:156px;height:21px;text-align:center;position:fixed;top:7px;left:121px;z-index:200;background:#58636d !important;color:#d8e6f2;font-size:9pt;padding-top:2px;cursor:pointer;user-select:none;font-family:Arial,sans-serif}
          .geofs-missionPlanner-panel{position:absolute;top:39px;left:10px;width:360px;max-height:calc(100% - 20px);overflow:auto;z-index:10000;background:rgba(12,16,20,.93);color:#e6eef7;border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:10px;font-family:Arial,sans-serif;display:none;box-shadow:0 4px 16px rgba(0,0,0,.35)}
          .geofs-missionPlanner-panel.geofs-visible{display:block}
          .geofs-mp-title{font-size:14px;font-weight:700;margin-bottom:8px}
          .geofs-mp-row{display:flex;gap:6px;margin-bottom:6px}.geofs-mp-row>*{flex:1 1 0;min-width:0}
          .geofs-mp-section{margin-top:10px;border-top:1px solid rgba(255,255,255,.2);padding-top:8px}
          .geofs-mp-section h4{margin:0 0 6px 0;font-size:12px;color:#b8ccde;display:flex;justify-content:space-between;cursor:pointer}
          .geofs-mp-list{display:flex;flex-direction:column;gap:4px;font-size:11px}
          .geofs-mp-item{border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:4px;background:rgba(255,255,255,.04)}
          .geofs-mp-item.geofs-mp-focus{border-color:#69b7ff;box-shadow:0 0 0 1px rgba(105,183,255,.6) inset;background:rgba(105,183,255,.12)}
          .geofs-mp-line{display:flex;align-items:center;gap:6px}
          .geofs-mp-line-main{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
          .geofs-mp-line-main>*{flex:1;min-width:0}
          .geofs-mp-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .geofs-mp-remove{flex:0 0 auto;min-width:26px;padding:4px 8px}
          .geofs-mp-line .geofs-mp-remove{width:10px !important;min-width:10px;flex:0 0 10px;padding:4px 0}
          .geofs-mp-small{font-size:10px;opacity:.8}
          .geofs-mp-actions{display:flex;gap:4px;margin-top:4px}
          .geofs-mp-actions button,.geofs-mp-row button,.geofs-mp-row select,.geofs-mp-row input,.geofs-mp-row textarea,.geofs-mp-line button,.geofs-mp-line select,.geofs-mp-line input{font-size:11px;background:rgba(255,255,255,.08);color:#e6eef7;border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:4px;box-sizing:border-box;width:100%}
          .geofs-mp-row select,.geofs-mp-line select{color:#e6eef7 !important;background:#1b2430 !important}
          .geofs-mp-row option,.geofs-mp-line option{color:#e6eef7 !important;background:#1b2430 !important}
          .geofs-mp-row select:focus,.geofs-mp-line select:focus{background:#1b2430 !important;color:#e6eef7 !important}
          .geofs-mp-row textarea{min-height:52px;resize:vertical}
          .geofs-mp-goto{cursor:pointer}
          .geofs-mp-cartridge{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.2)}
          .geofs-mp-cartridge-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;min-height:56px;background:linear-gradient(180deg,#1ccf5c,#17a84a) !important;color:#f3fff6 !important;border:1px solid rgba(0,0,0,.28) !important;border-radius:6px !important;font-weight:700 !important;letter-spacing:.4px !important;cursor:pointer}
          .geofs-mp-cartridge-btn small{font-size:10px;font-weight:400;opacity:.9;letter-spacing:0}
          .geofs-mp-cartridge-btn:hover{filter:brightness(1.04)}
        `;
        document.head.appendChild(style);
      }

      createButton() {
        const existing = document.querySelector('.geofs-missionPlanner-pad');
        const mapList = document.querySelector('.geofs-map-list');
        if (existing) {
          this.button = existing;
          if (mapList && existing.parentElement !== mapList) {
            mapList.appendChild(existing);
          }
          return;
        }
        this.button = document.createElement('div');
        this.button.className = 'geofs-missionPlanner-pad control-pad';
        this.button.textContent = 'MISSION PLANNER';
        this.button.addEventListener('click', () => {
          this.panel.classList.toggle('geofs-visible');
          this.button.classList.toggle('blue-pad');
        });
        (mapList || document.body).appendChild(this.button);
      }

      createPanel() {
        const root = document.querySelector('.geofs-map-viewport') || document.body;
        this.panel = document.createElement('div');
        this.panel.className = 'geofs-missionPlanner-panel';
        this.panel.addEventListener('click', (e) => e.stopPropagation());
        this.panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        this.panel.addEventListener('input', (e) => this.onInput(e));
        this.panel.addEventListener('keydown', (e) => this.blockGeoFSKeybinds(e), true);
        this.panel.addEventListener('keyup', (e) => this.blockGeoFSKeybinds(e), true);
        this.panel.addEventListener('keypress', (e) => this.blockGeoFSKeybinds(e), true);
        this.panel.addEventListener('change', (e) => this.onChange(e));
        this.panel.addEventListener('click', (e) => this.onClick(e));
        root.appendChild(this.panel);
      }

      onInput(event) {
        const target = event.target;
        if (target.id === 'mp-mission-name') {
          this.store.mission.name = target.value;
          this.store.touch();
          const titleNode = this.panel.querySelector('.geofs-mp-title');
          if (titleNode) {
            titleNode.textContent = `Mission Planner - ${this.store.mission.name}`;
          }
        }
      }

      blockGeoFSKeybinds(event) {
        const tagName = event.target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
          event.stopPropagation();
          event.stopImmediatePropagation();
        }
      }

      updateToolState(state) {
        this.toolState = state;
        const btn = this.panel.querySelector('[data-action="toggleDrawArea"]');
        if (btn) {
          btn.textContent = this.toolState.activeTool === 'NONE' ? 'Start Draw' : 'Finish Draw';
        }
      }

      handleAreaShape(shape) {
        const meta = this.pendingAreaMeta;
        const area = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          name: meta.name,
          variant: shape.variant,
          type: meta.type,
          group: meta.group,
          order: meta.order
        };
        if (shape.variant === 'CIRCLE') {
          area.center = shape.center;
          area.radius = shape.radius;
        } else {
          area.points = shape.points;
        }
        this.store.mission.areas.push(area);
        this.store.mission.areas.sort((a, b) => a.order - b.order);
        this.resetAreaNameAndOrder(meta.order + 1);
        this.store.touch();
        this.tools.stop();
        this.render();
      }

      getAreaMetaFromPanel() {
        const name = this.panel.querySelector('#mp-area-name').value || `Area ${this.store.mission.areas.length + 1}`;
        const variant = this.panel.querySelector('#mp-area-variant').value;
        const type = this.panel.querySelector('#mp-area-type').value;
        const group = this.panel.querySelector('#mp-area-group').value;
        const orderValue = Number(this.panel.querySelector('#mp-area-order').value);
        const order = Number.isFinite(orderValue) ? orderValue : (this.store.mission.areas.length + 1);
        this.areaFormState = { name, variant, type, group, order };
        return {
          name,
          variant,
          type,
          group,
          order
        };
      }

      sectionHeader(id, title, countText) {
        const arrow = this.sectionOpen[id] ? '▼' : '▶';
        return `<h4 data-action="toggleSection" data-section="${id}">${title}${countText ? ` (${countText})` : ''}<span>${arrow}</span></h4>`;
      }

      sectionBody(id, content) {
        return this.sectionOpen[id] ? content : '';
      }

      getActiveAddonForDataCartridge() {
        const aircraftId = String(window.geofs?.aircraft?.instance?.id ?? '');
        if (aircraftId === '27' && window.F18Addon?.dataCartridge) {
          return window.F18Addon;
        }
        if (aircraftId === '3591' && window.F15Addon?.dataCartridge) {
          return window.F15Addon;
        }
        if (window.F18Addon?.dataCartridge) {
          return window.F18Addon;
        }
        if (window.F15Addon?.dataCartridge) {
          return window.F15Addon;
        }
        return null;
      }

      loadDataCartridgeToAircraft() {
        const addon = this.getActiveAddonForDataCartridge();
        const cartridge = addon?.dataCartridge;
        if (!cartridge?.loadMissionData) {
          return false;
        }
        cartridge.loadMissionData(cloneData(this.store.mission), { source: 'mission-planner' });
        return true;
      }

      openSectionAndFocusItem(section, selector) {
        Object.keys(this.sectionOpen).forEach((key) => {
          this.sectionOpen[key] = false;
        });
        this.sectionOpen[section] = true;
        this.render();
        setTimeout(() => {
          const node = this.panel.querySelector(selector);
          if (!node) {
            return;
          }
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          node.classList.add('geofs-mp-focus');
          setTimeout(() => node.classList.remove('geofs-mp-focus'), 1200);
        }, 0);
      }

      render() {
        const mission = this.store.mission;
        this.map.renderMission(mission);

        this.panel.innerHTML = `
          <div class="geofs-mp-title">Mission Planner - ${mission.name}</div>

          <div class="geofs-mp-section">
            ${this.sectionHeader('mission', 'Mission')}
            ${this.sectionBody('mission', `
              <div class="geofs-mp-row"><input id="mp-mission-name" value="${mission.name}"><button data-action="newMission">New</button></div>
              <div class="geofs-mp-row"><button data-action="exportJson">Export to File</button><button data-action="importJson">Import from File</button><input type="file" id="mp-import-file" accept="application/json" style="display:none"></div>
            `)}
          </div>

          <div class="geofs-mp-section">
            ${this.sectionHeader('flightPlan', 'Flight Plan', mission.flightPlan.length)}
            ${this.sectionBody('flightPlan', `<div class="geofs-mp-list">${mission.flightPlan.map((wp, index) => `<div class="geofs-mp-item geofs-mp-goto" data-action="gotoWaypoint" data-id="${index}"><div class="geofs-mp-row"><input data-flightplan-index="${index}" value="${wp.ident}"><span class="geofs-mp-small" style="display:flex;align-items:center">${wp.type}</span></div></div>`).join('') || '<div class="geofs-mp-small">No waypoints</div>'}</div>`)}
          </div>

          <div class="geofs-mp-section">
            ${this.sectionHeader('markpoints', 'Markpoints', mission.markpoints.length)}
            ${this.sectionBody('markpoints', `
              <div class="geofs-mp-row"><input id="mp-mark-name" placeholder="Name"><input id="mp-mark-abbr" placeholder="Abbr"><select id="mp-mark-type">${MARKPOINT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></div>
              <div class="geofs-mp-row"><button data-action="addMarkpointCenter">Add at Map Center</button></div>
              <div class="geofs-mp-list">${mission.markpoints.map((m) => `<div class="geofs-mp-item geofs-mp-goto" data-action="gotoMarkpoint" data-id="${m.id}"><div class="geofs-mp-line"><div class="geofs-mp-line-main"><input data-markpoint-name="${m.id}" value="${m.name}"><input data-markpoint-abbr="${m.id}" value="${m.abbreviation}"><select data-markpoint-type="${m.id}">${MARKPOINT_TYPES.map((t) => `<option ${t === m.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div><button class="geofs-mp-remove" data-action="removeMarkpoint" data-id="${m.id}">X</button></div></div>`).join('')}</div>
            `)}
          </div>

          <div class="geofs-mp-section">
            ${this.sectionHeader('areas', 'Areas', mission.areas.length)}
            ${this.sectionBody('areas', `
              <div class="geofs-mp-row"><input id="mp-area-name" value="${this.areaFormState.name}"></div>
              <div class="geofs-mp-row"><select id="mp-area-variant">${AREA_VARIANTS.map((v) => `<option ${v === this.areaFormState.variant ? 'selected' : ''}>${v}</option>`).join('')}</select><select id="mp-area-type">${AREA_TYPES.map((t) => `<option ${t === this.areaFormState.type ? 'selected' : ''}>${t}</option>`).join('')}</select><select id="mp-area-group">${AREA_GROUPS.map((g) => `<option ${g === this.areaFormState.group ? 'selected' : ''}>${g}</option>`).join('')}</select><input id="mp-area-order" type="number" value="${this.areaFormState.order}"></div>
              <div class="geofs-mp-row"><button data-action="toggleDrawArea">${this.toolState.activeTool === 'NONE' ? 'Start Draw' : 'Finish Draw'}</button></div>
              <div class="geofs-mp-list">${mission.areas.map((a) => `<div class="geofs-mp-item" data-area-id="${a.id}">${a.name} [${a.variant}] (${a.type}/${a.group})<div class="geofs-mp-small">Order: ${a.order}</div><div class="geofs-mp-actions"><button data-action="removeArea" data-id="${a.id}">Remove</button></div></div>`).join('')}</div>
            `)}
          </div>

          <div class="geofs-mp-section">
            ${this.sectionHeader('navaids', 'Navaids', mission.navaids.length)}
            ${this.sectionBody('navaids', `<div class="geofs-mp-small">Select a navaid on the map and click “Add Navaid to Mission”.</div><div class="geofs-mp-list">${mission.navaids.map((n) => `<div class="geofs-mp-item"><div class="geofs-mp-line"><div class="geofs-mp-line-main"><span class="geofs-mp-label">${n.type} ${n.ident || n.icao} - ${n.name || ''}</span><select data-navaid-mission-type="${n.id}">${NAVAID_MISSION_TYPES.map((t) => `<option ${t === (n.missionType || 'FRIEND') ? 'selected' : ''}>${t}</option>`).join('')}</select></div><button class="geofs-mp-remove" data-action="removeNavaid" data-id="${n.id}">X</button></div></div>`).join('')}</div>`)}
          </div>

          <div class="geofs-mp-section">
            ${this.sectionHeader('checklists', 'Checklists', mission.checklists.length)}
            ${this.sectionBody('checklists', `
              <div class="geofs-mp-row"><input id="mp-checklist-title" placeholder="New checklist title"><button data-action="addChecklist">Add FLP</button></div>
              <div class="geofs-mp-list">${mission.checklists.map((c) => `<div class="geofs-mp-item"><div class="geofs-mp-row"><input data-checklist-title="${c.id}" value="${c.title}"><button data-action="saveChecklist" data-id="${c.id}">Save</button><button data-action="removeChecklist" data-id="${c.id}">Remove</button></div><div class="geofs-mp-row"><textarea data-checklist-items="${c.id}">${c.items.join('\n')}</textarea></div></div>`).join('')}</div>
            `)}
          </div>

          <div class="geofs-mp-section">
            ${this.sectionHeader('iff', 'IFF Codes')}
            ${this.sectionBody('iff', `<div class="geofs-mp-row"><button data-action="regenIff">Regenerate 14 codes</button></div><div class="geofs-mp-list">${mission.iffCodes.map((c) => `<div class="geofs-mp-item geofs-mp-row"><span style="width:40px;display:inline-block">${c.key}</span><input data-iff-key="${c.key}" value="${c.response}"></div>`).join('')}</div>`)}
          </div>

          <div class="geofs-mp-cartridge">
            <button class="geofs-mp-cartridge-btn" data-action="loadDataCartridge"><span>LOAD DATACARTRIDGE</span><small>Send to aircraft</small></button>
          </div>
        `;

        const fileInput = this.panel.querySelector('#mp-import-file');
        if (fileInput) {
          fileInput.onchange = () => {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = () => {
              this.store.mission = JSON.parse(reader.result);
              this.resetAreaNameAndOrder();
              this.store.touch();
              this.applyMissionFlightPlanToGeoFS();
              this.store.syncFlightPlan();
              this.flightPlanSignature = this.getFlightPlanSignature();
              this.render();
            };
            reader.readAsText(file);
          };
        }
      }

      onChange(event) {
        const target = event.target;
        if (target.id === 'mp-mission-name') {
          this.store.mission.name = target.value;
          this.store.touch();
          return;
        }
        if (target.dataset.flightplanIndex !== undefined) {
          const index = Number(target.dataset.flightplanIndex);
          if (this.store.mission.flightPlan[index]) {
            this.store.mission.flightPlan[index].ident = target.value;
          }
          if (geofs.flightPlan.waypointArray[index]) {
            geofs.flightPlan.waypointArray[index].ident = target.value;
            geofs.flightPlan.refreshWaypoints();
          }
          this.store.touch();
          this.flightPlanSignature = this.getFlightPlanSignature();
          return;
        }
        if (target.dataset.markpointName) {
          const id = Number(target.dataset.markpointName);
          const markpoint = this.store.mission.markpoints.find((m) => m.id === id);
          markpoint.name = target.value;
          this.store.touch();
          return;
        }
        if (target.dataset.markpointAbbr) {
          const id = Number(target.dataset.markpointAbbr);
          const markpoint = this.store.mission.markpoints.find((m) => m.id === id);
          markpoint.abbreviation = target.value;
          this.store.touch();
          return;
        }
        if (target.dataset.markpointType) {
          const id = Number(target.dataset.markpointType);
          const markpoint = this.store.mission.markpoints.find((m) => m.id === id);
          markpoint.type = target.value;
          this.store.touch();
          this.render();
          return;
        }
        if (target.id === 'mp-area-name') {
          this.areaFormState.name = target.value;
          return;
        }
        if (target.id === 'mp-area-variant') {
          this.areaFormState.variant = target.value;
          return;
        }
        if (target.id === 'mp-area-type') {
          this.areaFormState.type = target.value;
          return;
        }
        if (target.id === 'mp-area-group') {
          this.areaFormState.group = target.value;
          return;
        }
        if (target.id === 'mp-area-order') {
          const orderValue = Number(target.value);
          this.areaFormState.order = Number.isFinite(orderValue) ? orderValue : this.areaFormState.order;
          return;
        }
        if (target.dataset.navaidMissionType) {
          const id = Number(target.dataset.navaidMissionType);
          const navaid = this.store.mission.navaids.find((n) => n.id === id);
          if (navaid) {
            navaid.missionType = target.value;
            this.store.touch();
            this.render();
          }
          return;
        }
        if (target.dataset.iffKey) {
          const code = this.store.mission.iffCodes.find((i) => i.key === target.dataset.iffKey);
          code.response = target.value;
          this.store.touch();
        }
      }

      onClick(event) {
        const button = event.target.closest('button[data-action], h4[data-action], .geofs-mp-goto[data-action]');
        if (!button) {
          return;
        }
        const action = button.dataset.action;
        const id = Number(button.dataset.id);

        if (action === 'toggleSection') {
          const section = button.dataset.section;
          const willOpen = !this.sectionOpen[section];
          Object.keys(this.sectionOpen).forEach((key) => {
            this.sectionOpen[key] = false;
          });
          this.sectionOpen[section] = willOpen;
          this.render();
          return;
        }

        if (action === 'gotoWaypoint') {
          const tagName = event.target.tagName;
          if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON') {
            return;
          }
          const wp = this.store.mission.flightPlan[id];
          geofs.api.map._map.panTo([wp.lat, wp.lon]);
          return;
        }

        if (action === 'gotoMarkpoint') {
          const tagName = event.target.tagName;
          if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || tagName === 'BUTTON') {
            return;
          }
          const markpoint = this.store.mission.markpoints.find((m) => m.id === id);
          geofs.api.map._map.panTo([markpoint.lat, markpoint.lon]);
          return;
        }

        if (action === 'newMission') {
          const name = this.store.mission.name;
          this.store.mission = this.store.newMission(name);
          this.resetAreaNameAndOrder();
          this.store.syncFlightPlan();
          this.flightPlanSignature = this.getFlightPlanSignature();
        }
        if (action === 'exportJson') {
          const blob = new Blob([JSON.stringify(this.store.mission, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `mission-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
        if (action === 'importJson') {
          this.panel.querySelector('#mp-import-file').click();
          return;
        }
        if (action === 'addMarkpointCenter') {
          const center = geofs.api.map.getCenterLla();
          const markpoint = {
            id: this.store.mission.markpoints.length + 1,
            name: this.panel.querySelector('#mp-mark-name').value || 'Markpoint',
            abbreviation: this.panel.querySelector('#mp-mark-abbr').value || `MP${this.store.mission.markpoints.length + 1}`,
            lat: center[0],
            lon: center[1],
            type: this.panel.querySelector('#mp-mark-type').value
          };
          this.store.mission.markpoints.push(markpoint);
          this.store.touch();
        }
        if (action === 'removeMarkpoint') {
          this.store.mission.markpoints = this.store.mission.markpoints.filter((m) => m.id !== id);
          this.store.mission.markpoints.forEach((m, index) => { m.id = index + 1; });
          this.store.touch();
        }
        if (action === 'toggleDrawArea') {
          if (this.toolState.activeTool === 'NONE') {
            this.pendingAreaMeta = this.getAreaMetaFromPanel();
            this.tools.start(this.pendingAreaMeta.variant);
          } else {
            if (this.toolState.activeTool === 'POLYGON') {
              this.tools.finish();
            } else {
              this.tools.stop();
            }
          }
        }
        if (action === 'removeArea') {
          this.store.mission.areas = this.store.mission.areas.filter((a) => a.id !== id);
          this.store.touch();
        }
        if (action === 'removeNavaid') {
          this.store.mission.navaids = this.store.mission.navaids.filter((n) => n.id !== id);
          this.store.touch();
        }
        if (action === 'addChecklist') {
          const title = this.panel.querySelector('#mp-checklist-title').value;
          if (title) {
            const next = (this.store.mission.checklists[this.store.mission.checklists.length - 1]?.id || 0) + 1;
            this.store.mission.checklists.push({ id: next, type: 'FLP', title, items: [] });
            this.store.touch();
          }
        }
        if (action === 'saveChecklist') {
          const checklist = this.store.mission.checklists.find((c) => c.id === id);
          checklist.title = this.panel.querySelector(`[data-checklist-title="${id}"]`).value;
          const itemsRaw = this.panel.querySelector(`[data-checklist-items="${id}"]`).value;
          checklist.items = itemsRaw ? itemsRaw.split('\n') : [];
          this.store.touch();
        }
        if (action === 'removeChecklist') {
          this.store.mission.checklists = this.store.mission.checklists.filter((c) => c.id !== id);
          this.store.touch();
        }
        if (action === 'regenIff') {
          this.store.mission.iffCodes = makeIffCodes();
          this.store.touch();
        }
        if (action === 'loadDataCartridge') {
          const ok = this.loadDataCartridgeToAircraft();
          if (ok) {
            button.querySelector('small').textContent = 'Sent to aircraft';
            setTimeout(() => {
              const hint = button.querySelector('small');
              if (hint) {
                hint.textContent = 'Send to aircraft';
              }
            }, 1400);
          }
        }
        this.render();
      }
    }

    const waitReady = setInterval(() => {
      if (!(window.geofs && window.geofs.api && window.geofs.api.map && window.geofs.api.map._map && window.L && window.geofs.flightPlan)) {
        return;
      }
      clearInterval(waitReady);
      const app = new MissionPlannerAppV2();
      app.init();
      window.GeoFSMissionPlanner = {
        version: '0.3.0',
        apiVersion: API_VERSION_V2,
        app,
        getMissionData() {
          return cloneData(app.store.mission);
        },
        getMissionJson() {
          return JSON.stringify(app.store.mission);
        },
        getDataModel() {
          return {
            mission: {
              version: 1,
              fields: ['version', 'name', 'createdAt', 'updatedAt', 'flightPlan', 'markpoints', 'areas', 'navaids', 'checklists', 'iffCodes']
            },
            enums: {
              areaTypes: [...AREA_TYPES],
              areaGroups: [...AREA_GROUPS],
              areaVariants: [...AREA_VARIANTS],
              markpointTypes: [...MARKPOINT_TYPES],
              navaidMissionTypes: [...NAVAID_MISSION_TYPES]
            },
            defaults: {
              checklists: [...DEFAULT_FLP_CHECKLISTS],
              iffCodeCount: 14,
              storageKey: STORAGE_KEY_V2
            },
            colors: {
              areaStyleByType: cloneData(AREA_STYLE_BY_TYPE),
              markpointColorByType: cloneData(MARKPOINT_COLOR_BY_TYPE),
              navaidColorByMissionType: cloneData(NAVAID_COLOR_BY_MISSION_TYPE)
            }
          };
        },
        getMissionForDisplay() {
          const mission = cloneData(app.store.mission);
          return {
            mission,
            derived: {
              markpoints: mission.markpoints.map((m) => ({
                id: m.id,
                color: MARKPOINT_COLOR_BY_TYPE[m.type] || '#00bcd4'
              })),
              navaids: mission.navaids.map((n) => {
                const missionType = n.missionType || 'FRIEND';
                return {
                  id: n.id,
                  missionType,
                  color: NAVAID_COLOR_BY_MISSION_TYPE[missionType] || '#2196f3'
                };
              }),
              areas: mission.areas.map((a) => ({
                id: a.id,
                style: cloneData(AREA_STYLE_BY_TYPE[a.type] || AREA_STYLE_BY_TYPE.AREA)
              }))
            }
          };
        },
        onUpdate(callback) {
          if (typeof callback !== 'function') {
            return () => {};
          }
          const handler = (event) => callback(cloneData(event.detail));
          window.addEventListener('GeoFSMissionPlanner:updated', handler);
          return () => window.removeEventListener('GeoFSMissionPlanner:updated', handler);
        }
      };
    }, 400);
  }

  return;

  const POLL_MS = 500;
  const MAX_TRIES = 240;
  const STORAGE_KEY = 'GeoFSMissionPlanner.v1';

  class MapAdapter {
    constructor() {
      this._boundMap = null;
      this._layerGroups = new Map();
      this._doubleClickZoomWasEnabled = true;
    }

    isReady() {
      return !!(window.geofs && window.geofs.api && window.geofs.api.map && window.geofs.api.map._map && window.L);
    }

    getMap() {
      return this.isReady() ? window.geofs.api.map._map : null;
    }

    bindMap() {
      const map = this.getMap();
      if (!map) {
        return false;
      }
      this._boundMap = map;
      return true;
    }

    hasMapChanged() {
      const map = this.getMap();
      return !!(map && map !== this._boundMap);
    }

    ensureLayerGroup(name) {
      const map = this.getMap();
      if (!map) {
        return null;
      }

      let group = this._layerGroups.get(name);
      if (!group || !map.hasLayer(group)) {
        group = window.L.layerGroup().addTo(map);
        this._layerGroups.set(name, group);
      }
      return group;
    }

    clearLayerGroup(name) {
      const group = this._layerGroups.get(name);
      if (!group) {
        return;
      }
      group.clearLayers();
    }

    removeLayerGroup(name) {
      const map = this.getMap();
      const group = this._layerGroups.get(name);
      if (!group || !map) {
        return;
      }
      map.removeLayer(group);
      this._layerGroups.delete(name);
    }

    on(eventName, handler, context) {
      const map = this.getMap();
      if (!map) {
        return;
      }
      map.on(eventName, handler, context);
    }

    off(eventName, handler, context) {
      const map = this.getMap();
      if (!map) {
        return;
      }
      map.off(eventName, handler, context);
    }

    disableDoubleClickZoom() {
      const map = this.getMap();
      if (!map || !map.doubleClickZoom) {
        return;
      }
      this._doubleClickZoomWasEnabled = map.doubleClickZoom.enabled();
      map.doubleClickZoom.disable();
    }

    restoreDoubleClickZoom() {
      const map = this.getMap();
      if (!map || !map.doubleClickZoom) {
        return;
      }
      if (this._doubleClickZoomWasEnabled) {
        map.doubleClickZoom.enable();
      }
    }

    makePolyline(latlngs, options, groupName) {
      const group = this.ensureLayerGroup(groupName);
      if (!group) {
        return null;
      }
      return window.L.polyline(latlngs, options).addTo(group);
    }

    makePolygon(latlngs, options, groupName) {
      const group = this.ensureLayerGroup(groupName);
      if (!group) {
        return null;
      }
      return window.L.polygon(latlngs, options).addTo(group);
    }

    makeCircleMarker(latlng, options, groupName) {
      const group = this.ensureLayerGroup(groupName);
      if (!group) {
        return null;
      }
      return window.L.circleMarker(latlng, options).addTo(group);
    }
  }

  class MissionStore {
    constructor(storageKey) {
      this.storageKey = storageKey;
      this.mission = this.createNewMission('Untitled Mission');
    }

    createDefaultMission() {
      return {
        version: 1,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        flightPlan: [],
        markpoints: [],
        areas: [],
        navaids: [],
        checklists: DEFAULT_FLP_CHECKLISTS.map((title, index) => ({
          id: index + 1,
          type: 'FLP',
          title,
          items: []
        })),
        iffCodes: buildDefaultIffCodes()
      };
    }

    getMission() {
      return this.mission;
    }

    setMission(mission) {
      if (!mission || typeof mission !== 'object') {
        return;
      }
      this.mission = {
        version: 1,
        name: mission.name || 'Untitled Mission',
        createdAt: mission.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        polygons: Array.isArray(mission.polygons) ? mission.polygons : []
      };
    }

    addPolygon(points, meta) {
      const id = `poly-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const area = {
        version: 1,
        name: (meta && meta.name) || `Area ${this.mission.areas.length + 1}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        points: points.map((p) => [p.lat, p.lng]),
        style: AREA_STYLE_BY_TYPE[meta.type] || AREA_STYLE_BY_TYPE['UNRESTRICTED']
      };
      this.mission.areas.push(area);
      this.touch();
      return area;
    }

    clearPolygons() {
      this.mission.polygons = [];
      this.mission.areas = [];
      this.touch();
    }

    save() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.mission));
        return true;
      } catch (err) {
        console.warn('[GeoFS Mission Planner] save failed:', err);
        return false;
      }
    }

    load() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) {
          return false;
        }
        const parsed = JSON.parse(raw);
        this.setMission(parsed);
        return true;
      } catch (err) {
        console.warn('[GeoFS Mission Planner] load failed:', err);
        return false;
      }
    }
  }

  class PolygonTool {
    constructor(mapAdapter, callbacks) {
      this.mapAdapter = mapAdapter;
      this.callbacks = callbacks || {};
      this.active = false;
      this.points = [];

      this._handleClick = this._handleClick.bind(this);
      this._handleDblClick = this._handleDblClick.bind(this);

      this.previewLine = null;
      this.previewPolygon = null;
      this.vertexMarkers = [];
    }

    start() {
      if (this.active) {
        return;
      }
      this.active = true;
      this.mapAdapter.disableDoubleClickZoom();
      this.mapAdapter.on('click', this._handleClick, this);
      this.mapAdapter.on('dblclick', this._handleDblClick, this);
      this._notifyChange();
    }

    stop() {
      if (!this.active) {
        return;
      }
      this.active = false;
      this.mapAdapter.off('click', this._handleClick, this);
      this.mapAdapter.off('dblclick', this._handleDblClick, this);
      this.mapAdapter.restoreDoubleClickZoom();
      this._notifyChange();
    }

    _handleClick(e) {
      if (!this.active || !e || !e.latlng) {
        return;
      }
      this.addVertex(e.latlng);
    }

    _handleDblClick(e) {
      if (!this.active) {
        return;
      }
      if (e && e.originalEvent) {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
      }
      this.finish();
    }

    addVertex(latlng) {
      this.points.push(latlng);
      this._drawVertex(latlng);
      this._updatePreview();
      this._notifyChange();
    }

    undo() {
      if (!this.points.length) {
        return;
      }
      this.points.pop();
      const marker = this.vertexMarkers.pop();
      if (marker) {
        marker.remove();
      }
      this._updatePreview();
      this._notifyChange();
    }

    clearDraft() {
      this.points = [];
      this._clearPreviewLayers();
      this._notifyChange();
    }

    finish() {
      if (this.points.length < 3) {
        return null;
      }

      const finalPoints = this.points.slice();
      this.clearDraft();

      if (typeof this.callbacks.onFinish === 'function') {
        this.callbacks.onFinish(finalPoints);
      }

      this._notifyChange();
      return finalPoints;
    }

    _drawVertex(latlng) {
      const marker = this.mapAdapter.makeCircleMarker(latlng, {
        radius: 4,
        color: '#ffffff',
        weight: 1,
        fillColor: '#00e5ff',
        fillOpacity: 1
      }, 'mp-draft');

      if (marker) {
        this.vertexMarkers.push(marker);
      }
    }

    _clearPreviewLayers() {
      this.mapAdapter.clearLayerGroup('mp-draft');
      this.previewLine = null;
      this.previewPolygon = null;
      this.vertexMarkers = [];
    }

    _updatePreview() {
      if (this.previewLine) {
        this.previewLine.remove();
        this.previewLine = null;
      }
      if (this.previewPolygon) {
        this.previewPolygon.remove();
        this.previewPolygon = null;
      }

      if (this.points.length >= 2) {
        this.previewLine = this.mapAdapter.makePolyline(this.points, {
          color: '#00e5ff',
          weight: 2,
          opacity: 0.9,
          dashArray: '6 4'
        }, 'mp-draft');
      }

      if (this.points.length >= 3) {
        this.previewPolygon = this.mapAdapter.makePolygon(this.points, {
          color: '#00e5ff',
          weight: 2,
          fillColor: '#00bcd4',
          fillOpacity: 0.15
        }, 'mp-draft');
      }
    }

    _notifyChange() {
      if (typeof this.callbacks.onChange === 'function') {
        this.callbacks.onChange({
          active: this.active,
          vertexCount: this.points.length
        });
      }
    }
  }

  class ToolManager {
    constructor() {
      this.tools = new Map();
      this.activeToolName = null;
    }

    register(name, tool) {
      this.tools.set(name, tool);
    }

    activate(name) {
      if (this.activeToolName === name) {
        return;
      }
      this.deactivate();
      const tool = this.tools.get(name);
      if (!tool) {
        return;
      }
      tool.start();
      this.activeToolName = name;
    }

    deactivate() {
      if (!this.activeToolName) {
        return;
      }
      const current = this.tools.get(this.activeToolName);
      if (current) {
        current.stop();
      }
      this.activeToolName = null;
    }

    getActiveTool() {
      if (!this.activeToolName) {
        return null;
      }
      return this.tools.get(this.activeToolName) || null;
    }
  }

  class UIController {
    constructor(app) {
      this.app = app;
      this.button = null;
      this.panel = null;
      this.status = null;
      this.isVisible = false;
      this._initialized = false;
    }

    init() {
      if (this._initialized) {
        return;
      }

      this._injectStyles();
      this._createButton();
      this._createPanel();
      this._initialized = true;
      this.refresh();
    }

    _injectStyles() {
      if (document.getElementById('geofs-mission-planner-style')) {
        return;
      }

      const style = document.createElement('style');
      style.id = 'geofs-mission-planner-style';
      style.textContent = `
        .geofs-missionPlanner-pad {
          width: 156px;
          height: 21px;
          text-align: center;
          position: fixed;
          top: 7px;
          left: 121px;
          z-index: 200;
          background: #58636d !important;
          color: #d8e6f2;
          font-size: 9pt;
          padding-top: 2px;
          cursor: pointer;
          user-select: none;
        }
        .geofs-missionPlanner-panel {
          position: absolute;
          top: 54px;
          left: 10px;
          width: 260px;
          background: rgba(20, 20, 24, 0.94);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          padding: 10px;
          z-index: 10000;
          display: none;
          font-family: Arial, sans-serif;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        }
        .geofs-missionPlanner-panel.geofs-visible {
          display: block;
        }
        .geofs-missionPlanner-title {
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 8px;
          letter-spacing: 0.4px;
        }
        .geofs-missionPlanner-status {
          font-size: 12px;
          margin-bottom: 8px;
          opacity: 0.9;
        }
        .geofs-missionPlanner-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .geofs-missionPlanner-actions button {
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
          font-size: 11px;
          padding: 6px;
          border-radius: 4px;
          cursor: pointer;
        }
        .geofs-missionPlanner-actions button:hover {
          background: rgba(255, 255, 255, 0.16);
        }
      `;
      document.head.appendChild(style);
    }

    _createButton() {
      const existing = document.querySelector('.geofs-missionPlanner-pad');
      if (existing) {
        this.button = existing;
        return;
      }

      const flightPlanPad = document.querySelector('.geofs-flightPlan-pad');
      const button = document.createElement('div');
      button.className = 'geofs-missionPlanner-pad';
      button.textContent = 'MISSION PLANNER';
      button.title = 'Open Mission Planner';

      if (flightPlanPad) {
        button.className = `${flightPlanPad.className.replace(/\bgeofs-flightPlan-pad\b/g, '').trim()} geofs-missionPlanner-pad`;
        flightPlanPad.insertAdjacentElement('afterend', button);
      } else {
        const mapList = document.querySelector('.geofs-map-list') || document.querySelector('.geofs-map-viewport') || document.body;
        mapList.appendChild(button);
      }

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggle();
      });

      this.button = button;
    }

    _createPanel() {
      const existingPanel = document.querySelector('.geofs-missionPlanner-panel');
      if (existingPanel) {
        this.panel = existingPanel;
        this.status = existingPanel.querySelector('.geofs-missionPlanner-status');
        return;
      }

      const root = document.querySelector('.geofs-map-viewport') || document.querySelector('.geofs-map-list') || document.body;
      const panel = document.createElement('div');
      panel.className = 'geofs-missionPlanner-panel';
      panel.innerHTML = `
        <div class="geofs-missionPlanner-title">MISSION PLANNER (PoC)</div>
        <div class="geofs-missionPlanner-status">Status</div>
        <div class="geofs-missionPlanner-actions">
          <button data-action="start">Start Draw</button>
          <button data-action="stop">Stop Draw</button>
          <button data-action="finish">Finish</button>
          <button data-action="undo">Undo</button>
          <button data-action="clear">Clear Draft</button>
          <button data-action="clearSaved">Clear Saved</button>
          <button data-action="save">Save</button>
          <button data-action="load">Load</button>
        </div>
      `;

      panel.addEventListener('click', (event) => {
        event.stopPropagation();
        const button = event.target.closest('button[data-action]');
        if (!button) {
          return;
        }
        this._handleAction(button.getAttribute('data-action'));
      });

      root.appendChild(panel);
      this.panel = panel;
      this.status = panel.querySelector('.geofs-missionPlanner-status');
    }

    _handleAction(action) {
      switch (action) {
        case 'start':
          this.app.startDrawing();
          break;
        case 'stop':
          this.app.stopDrawing();
          break;
        case 'finish':
          this.app.finishPolygon();
          break;
        case 'undo':
          this.app.undoVertex();
          break;
        case 'clear':
          this.app.clearDraft();
          break;
        case 'clearSaved':
          this.app.clearSavedPolygons();
          break;
        case 'save':
          this.app.saveMission();
          break;
        case 'load':
          this.app.loadMission();
          break;
        default:
          break;
      }
      this.refresh();
    }

    toggle() {
      if (!this.panel) {
        return;
      }
      this.isVisible = !this.isVisible;
      this.panel.classList.toggle('geofs-visible', this.isVisible);
      if (this.button) {
        this.button.classList.toggle('blue-pad', this.isVisible);
      }
      this.refresh();
    }

    refresh() {
      if (!this.status || !this.app) {
        return;
      }
      const state = this.app.getUiState();
      this.status.textContent = `Tool: ${state.tool} | Vertices: ${state.vertexCount} | Saved polygons: ${state.savedPolygons}`;
    }
  }

  class MissionPlannerApp {
    constructor() {
      this.mapAdapter = new MapAdapter();
      this.store = new MissionStore(STORAGE_KEY);
      this.toolManager = new ToolManager();
      this.ui = new UIController(this);

      this.renderedPolygonLayers = [];
      this.currentToolState = {
        active: false,
        vertexCount: 0
      };

      this._mapHealthTimer = null;
    }

    init() {
      if (!this.mapAdapter.bindMap()) {
        return false;
      }

      this.store.load();

      this.polygonTool = new PolygonTool(this.mapAdapter, {
        onChange: (state) => {
          this.currentToolState = state;
          this.ui.refresh();
        },
        onFinish: (points) => {
          const polygon = this.store.addPolygon(points, null);
          this._renderPolygon(polygon);
          this.ui.refresh();
        }
      });

      this.toolManager.register('polygon', this.polygonTool);
      this.mapAdapter.ensureLayerGroup('mp-draft');
      this.mapAdapter.ensureLayerGroup('mp-final');
      this._renderAllStoredPolygons();

      this.ui.init();
      this._startMapHealthCheck();

      console.log('[GeoFS Mission Planner] Initialized');
      return true;
    }

    _startMapHealthCheck() {
      if (this._mapHealthTimer) {
        clearInterval(this._mapHealthTimer);
      }

      this._mapHealthTimer = setInterval(() => {
        if (!this.mapAdapter.isReady()) {
          return;
        }

        if (!this.ui._initialized) {
          this.ui.init();
        }

        if (this.mapAdapter.hasMapChanged()) {
          this.mapAdapter.bindMap();
          this.mapAdapter.ensureLayerGroup('mp-draft');
          this.mapAdapter.ensureLayerGroup('mp-final');
          this._renderAllStoredPolygons();
          this.ui.init();
        }
      }, 1000);
    }

    _renderPolygon(polygon) {
      if (!polygon || !Array.isArray(polygon.points) || polygon.points.length < 3) {
        return;
      }

      const latlngs = polygon.points.map((p) => ({ lat: p[0], lng: p[1] }));
      const style = Object.assign({
        color: '#00e5ff',
        fillColor: '#00bcd4',
        fillOpacity: 0.2,
        weight: 2
      }, polygon.style || {});

      const layer = this.mapAdapter.makePolygon(latlngs, style, 'mp-final');
      if (layer) {
        layer.bindTooltip(polygon.name || 'Polygon', { permanent: false });
        this.renderedPolygonLayers.push(layer);
      }
    }

    _renderAllStoredPolygons() {
      this.mapAdapter.clearLayerGroup('mp-final');
      this.renderedPolygonLayers = [];

      const mission = this.store.getMission();
      mission.polygons.forEach((polygon) => this._renderPolygon(polygon));
      this.ui.refresh();
    }

    startDrawing() {
      this.toolManager.activate('polygon');
      this.ui.refresh();
    }

    stopDrawing() {
      this.toolManager.deactivate();
      this.ui.refresh();
    }

    finishPolygon() {
      const tool = this.toolManager.getActiveTool();
      if (!tool || typeof tool.finish !== 'function') {
        return;
      }
      tool.finish();
      this.ui.refresh();
    }

    undoVertex() {
      const tool = this.toolManager.getActiveTool();
      if (!tool || typeof tool.undo !== 'function') {
        return;
      }
      tool.undo();
      this.ui.refresh();
    }

    clearDraft() {
      const tool = this.toolManager.getActiveTool();
      if (!tool || typeof tool.clearDraft !== 'function') {
        return;
      }
      tool.clearDraft();
      this.ui.refresh();
    }

    clearSavedPolygons() {
      this.store.clearPolygons();
      this._renderAllStoredPolygons();
      this.ui.refresh();
    }

    saveMission() {
      this.store.save();
      this.ui.refresh();
    }

    loadMission() {
      this.store.load();
      this._renderAllStoredPolygons();
      this.ui.refresh();
    }

    getUiState() {
      const mission = this.store.getMission();
      return {
        tool: this.currentToolState.active ? 'polygon (active)' : 'none',
        vertexCount: this.currentToolState.vertexCount || 0,
        savedPolygons: Array.isArray(mission.polygons) ? mission.polygons.length : 0
      };
    }
  }

  function bootstrap() {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;

      const hasGeoFS = !!(window.geofs && window.geofs.api && window.geofs.api.map && window.L);
      if (!hasGeoFS) {
        if (tries >= MAX_TRIES) {
          clearInterval(timer);
          console.warn('[GeoFS Mission Planner] GeoFS map API not found in time.');
        }
        return;
      }

      const app = new MissionPlannerApp();
      const initialized = app.init();
      if (!initialized) {
        if (tries >= MAX_TRIES) {
          clearInterval(timer);
          console.warn('[GeoFS Mission Planner] Map instance not ready in time.');
        }
        return;
      }

      clearInterval(timer);
      window.GeoFSMissionPlanner = {
        version: '0.1.0',
        app,
        start: () => app.startDrawing(),
        stop: () => app.stopDrawing(),
        save: () => app.saveMission(),
        load: () => app.loadMission()
      };
    }, POLL_MS);
  }

  bootstrap();
})();
