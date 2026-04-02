  class SystemModule {
    registerMfdPages(mfdModule) {
      mfdModule.registerPage({
        title: 'SYS',
        leftButtons: [
          { key: 'FLAPS', label: 'FLAP', states: ['MAN', 'AUTO'], stateIndex: 0 },
          { key: 'NA', label: '', states: [''], stateIndex: 0 },
          { key: 'SPEEDBRAKE', label: 'SPLR', states: ['MAX', '25%', '50%', '75%'], stateIndex: 0 },
        ],
        rightButtons: [
          { key: 'REFUELING', label: 'FUEL', states: ['CLOSED', 'OPEN'], stateIndex: 0 },
          { key: 'NA2', label: '', states: [''], stateIndex: 0 },
          { key: 'CANOPY', label: 'CANOPY', states: ['CLOSED', 'OPEN'], stateIndex: 0 },
        ],
        lines: [],
        render: (renderer, renderContext) => {
          const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
          const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
          const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
          const color = renderContext?.color ?? '#00ff66';
          if (!ctx) return;

          F18HudModule.drawGearAndFlapIndicators(ctx, w, h, color, { target: 'mfd' });
        }
      });
      return true;
    }
  }
