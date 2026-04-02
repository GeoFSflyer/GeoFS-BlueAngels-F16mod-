
  class ControlModule {
    static UPDATE_INTERVAL_MS = 50;
    
    constructor(helperModule = null) {
      this.helperModule = helperModule;
      this.installed = false;
      this.timer = null;
      this.controls = new Map();
      this.lastAircraftId = null;
    }

    registerControl(definition) {
      const key = String(definition?.key || '');
      if (!key) return false;

      const control = {
        key,
        padLabel: String(definition?.padLabel || ''),
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
      if (this.timer) {
        this.installPadControlFor(control);
      }
      return true;
    }

    ensureLoaded() {
      if (this.installed) return true;
      this.installed = true;
      return true;
    }

    start() {
      if (!this.installed) this.ensureLoaded();
      this.installPadControls();
      this.startLoop();
      return true;
    }

    stop() {
      this.stopLoop();
      this.removePadControls();
      this.lastAircraftId = null;
      for (const control of this.controls.values()) {
        control.runtime.initialized = false;
      }
      return true;
    }

    setControlState(control, state) {
      const tokens = this.parseConfigKey(control.key);
      if (!tokens.page || !tokens.key) return false;
      OptionModule.setOption(tokens.page, tokens.key, state);
      return true;
    }

    createPadButton(label, id, onClick, outerStyle = {}, innerStyle = {}) {
      return this.helperModule?.createPadButton({
        label,
        id,
        onClick,
        outerStyle,
        innerStyle
      }) ?? null;
    }

    getPadControlWrapperId(control) {
      return `control-pad-${control.key}`;
    }

    installPadControlFor(control) {
      if (!this.helperModule) return false;
      if (!control.padLabel) return false;

      const wrapperId = this.getPadControlWrapperId(control);
      if (document.getElementById(wrapperId)) return true;

      const wrapper = document.createElement('div');
      wrapper.id = wrapperId;
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '0px';
      wrapper.style.alignItems = 'flex-start';

      const openButton = this.createPadButton('OPEN', `${wrapperId}-open`, () => {
        this.setControlState(control, 'OPEN');
      }, {
        borderBottom: '1px solid #333',
        borderRadius: '15px 15px 0 0'
      });

      const centerLabel = this.createPadButton(control.padLabel, `${wrapperId}-label`, () => {}, {
        marginTop: '-9px',
        borderRadius: '0',
        borderTop: '0',
        cursor: 'default',
        pointerEvents: 'none'
      }, {
        fontWeight: '700'
      });

      const closeButton = this.createPadButton('CLOSE', `${wrapperId}-close`, () => {
        this.setControlState(control, 'CLOSED');
      }, {
        marginTop: '-9px',
        borderRadius: '0 0 15px 15px',
        borderTop: '0'
      });

      if (!openButton || !centerLabel || !closeButton) return false;

      wrapper.appendChild(openButton);
      wrapper.appendChild(centerLabel);
      wrapper.appendChild(closeButton);

      return this.helperModule.installPadControl({
        id: wrapper.id,
        element: wrapper,
        prepend: true
      });
    }

    installPadControls() {
      for (const control of this.controls.values()) {
        this.installPadControlFor(control);
      }
      return true;
    }

    removePadControls() {
      for (const control of this.controls.values()) {
        this.helperModule?.removePadControl(this.getPadControlWrapperId(control));
      }
    }

    startLoop() {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick(), ControlModule.UPDATE_INTERVAL_MS);
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
      const raw = OptionModule.getOption(tokens.page, tokens.key, null);
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
      partDef.channels[valueKey] = partDef.channels[valueKey] || {};
      partDef.channels[valueKey][state] = numericValue;
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

      const nodesByName = model._nodesByName || model._runtime?.nodesByName;
      if (nodesByName) {
        const exact = nodesByName[target] || nodesByName[target.toLowerCase()] || nodesByName[target.toUpperCase()];
        if (exact) return String(exact.name || exact._name || exact.id || target);
      }

      const wantedLow = target.toLowerCase();
      const arr = Array.isArray(model._runtime?.nodes)
        ? model._runtime.nodes
        : Array.isArray(model._nodes)
          ? model._nodes
          : [];
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
      this.stop();
      this.installed = false;
    }
  }


