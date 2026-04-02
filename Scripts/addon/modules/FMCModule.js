
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

    getSpeedbrakeCapNormalized() {
      const raw = String(OptionModule.getOption('SYS', 'SPEEDBRAKE', 'MAX') ?? 'MAX').trim().toUpperCase();
      if (raw === 'MAX') return 1;

      const percentMatch = raw.match(/^(\d+(?:\.\d+)?)%$/);
      if (percentMatch) {
        const pct = Number(percentMatch[1]);
        if (Number.isFinite(pct)) {
          return HelperModule.clampValue(pct / 100, 0, 1);
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
        ? Math.pow(HelperModule.clampValue((250 - kias) / 120, 0, 1), 2.6)
        : 0;
      const aoaFactor = Number.isFinite(aoa)
        ? HelperModule.clampValue((aoa - 6) / 10, 0, 1)
        : 0;
      const gFactor = Number.isFinite(gLoad)
        ? HelperModule.clampValue((gLoad - 1.15) / 3.0, 0, 1)
        : 0;

      // Mach contributes only at very low Mach, so it won't dominate around ~200 KIAS.
      const machFactor = Number.isFinite(mach)
        ? Math.pow(HelperModule.clampValue((0.28 - mach) / 0.12, 0, 1), 2)
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
      const clampedTarget = HelperModule.clampValue(Number(target) || 0, 0, maxPosition);

      if (this.lastAutoTarget != null && Math.abs(this.lastAutoTarget - clampedTarget) < 0.015) {
        return;
      }

      flaps.positionTarget = clampedTarget;
      controlsApi.setPartAnimationDelta(flaps);
      this.lastAutoTarget = clampedTarget;
    }

    tick() {
      if (!window.BasePlugin?.getActivePlugin?.()?.isAircraftActive?.()) {
        this.lastFlapsMode = null;
        this.lastAutoTarget = null;
        return;
      }

      const controlsApi = window.controls;
      if (!controlsApi) return;

      this.installAirbrakeDeltaHook(controlsApi);

      if (controlsApi.flaps) {
        const flapsMode = OptionModule.getOption('SYS', 'FLAPS', 'MAN');
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

      if (window.BasePlugin?.getActivePlugin?.()?.isAircraftActive?.()) {
        this.lastAutoTarget = null;
        this.applyFlapsTarget(0);
      }

      this.lastFlapsMode = null;
      this.installed = false;
    }
  }


