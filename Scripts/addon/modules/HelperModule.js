
  class HelperModule {
    static parseSemver(version) {
      const [major, minor, patch] = version.split('.').map(Number);
      return { major, minor, patch };
    }

    static isSemverAtLeast(version, minimumVersion) {
      const a = HelperModule.parseSemver(version);
      const b = HelperModule.parseSemver(minimumVersion);
      if (a.major !== b.major) return a.major > b.major;
      if (a.minor !== b.minor) return a.minor > b.minor;
      return a.patch >= b.patch;
    }

    static deepCloneJson(value) {
      return JSON.parse(JSON.stringify(value));
    }

    static angleDiffDeg(a, b) {
      let d = a - b;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return d;
    }

    static clampValue(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

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


