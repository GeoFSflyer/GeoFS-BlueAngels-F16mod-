class RadarModule {
  constructor(dependencies = {}) {
    this.navModule = dependencies.navModule ?? null;
  }

  setNavModule(navModule) {
    this.navModule = navModule;
    return this;
  }

  registerMfdPages(mfdModule) {
    const radarModule = this;

    mfdModule.registerPage({
      title: 'RDR',
      leftButtons: [
        {
          key: 'RADAR',
          label: 'RDR',
          states: ['OFF', 'ON'],
          stateIndex: 0,
          onClick: ({ nextState }) => {
            if (String(nextState ?? '').toUpperCase() !== 'ON') return;
            window.addonRuntime = window.addonRuntime || {};
            window.addonRuntime.navRdrRuntime = window.addonRuntime.navRdrRuntime || { bootStartMs: 0 };
            window.addonRuntime.navRdrRuntime.bootStartMs = Date.now();
          }
        },
        {
          key: 'FOO',
          label: 'FOO',
          states: ['SHOW', 'HIDE'],
          stateIndex: 0
        }
      ],
      rightButtons: [
        {
          key: 'RNG',
          label: 'RNG',
          states: ['20', '40', '80'],
          values: [20, 40, 80],
          stateIndex: 1
        }
      ],
      lines: [],
      render: (renderer, renderContext) => {
        const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
        const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
        const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
        const color = renderContext?.color ?? '#00ff66';
        if (!ctx) return;

        window.addonRuntime = window.addonRuntime || {};
        window.addonRuntime.navRdrRuntime = window.addonRuntime.navRdrRuntime || { bootStartMs: 0 };

        const engOn = Boolean(window.geofs?.animation?.values?.enginesOn);
        if (!engOn) {
          window.addonRuntime.navRdrRuntime.bootStartMs = 0;
        } else if (!window.addonRuntime.navRdrRuntime.bootStartMs) {
          window.addonRuntime.navRdrRuntime.bootStartMs = Date.now();
        }

        const elapsedMs = engOn ? (Date.now() - window.addonRuntime.navRdrRuntime.bootStartMs) : 0;
        const bootReady = engOn && elapsedMs >= 5000;

        const contentX = w * 0.19;
        const contentY = h * 0.13;
        const contentW = w * 0.62;
        const contentH = h * 0.74;

        const rangeNmRaw = Number(OptionModule.getOptionValue('RDR', 'RNG', 40));
        const rangeNm = Number.isFinite(rangeNmRaw) && rangeNmRaw > 0 ? rangeNmRaw : 40;
        const radarEnabled = OptionModule.getOptionValue('RDR', 'RADAR', 'OFF') === 'ON';

        const distanceMeters = (a, b) => {
          const distanceFn = window.geofs?.utils?.distanceInMeters;
          if (typeof distanceFn === 'function') {
            return Number(distanceFn(a, b)) || 0;
          }
          if (!Array.isArray(a) || !Array.isArray(b)) return 0;
          const latAvgRad = (((Number(a[0]) || 0) + (Number(b[0]) || 0)) * 0.5) * (Math.PI / 180);
          const dx = (((Number(b[1]) || 0) - (Number(a[1]) || 0)) * 111320) * Math.cos(latAvgRad);
          const dy = (((Number(b[0]) || 0) - (Number(a[0]) || 0)) * 110540);
          const dz = ((Number(b[2]) || 0) - (Number(a[2]) || 0));
          return Math.sqrt(dx * dx + dy * dy + dz * dz);
        };

        const bearingDeg = (a, b) => {
          const bearingFn = window.geofs?.utils?.bearingInDegrees;
          if (typeof bearingFn === 'function') {
            return Number(bearingFn(a, b)) || 0;
          }
          if (!Array.isArray(a) || !Array.isArray(b)) return 0;
          const lat1 = (Number(a[0]) || 0) * Math.PI / 180;
          const lat2 = (Number(b[0]) || 0) * Math.PI / 180;
          const dLon = ((Number(b[1]) || 0) - (Number(a[1]) || 0)) * Math.PI / 180;
          const y = Math.sin(dLon) * Math.cos(lat2);
          const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
          return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
        };

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#000000';
        ctx.fillRect(contentX, contentY, contentW, contentH);

        if (!engOn) {
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
          ctx.fillText('RDR OFF', contentX + contentW * 0.5, contentY + contentH * 0.5);
          ctx.restore();
          return;
        }

        if (!bootReady) {
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.046)}px monospace`;
          ctx.fillText('RADAR BIT TEST...', contentX + contentW * 0.5, contentY + contentH * 0.5);
          ctx.restore();
          return;
        }

        if (!radarEnabled) {
          ctx.fillStyle = '#ffff33';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.round(h * 0.075)}px monospace`;
          ctx.fillText('Radar OFF', contentX + contentW * 0.5, contentY + contentH * 0.5);
          ctx.restore();
          return;
        }

        const myPos = window.geofs?.aircraft?.instance?.llaLocation;
        const myHeading = Number(window.geofs?.animation?.values?.heading) || 0;
        const navModule = radarModule.navModule;
        const visibleUsersAll = Object.values(window.multiplayer?.visibleUsers ?? {});
        const visibleUsers = navModule?.filterMultiplayerContacts
          ? navModule.filterMultiplayerContacts(visibleUsersAll)
          : visibleUsersAll;

        const radarTop = contentY;
        const radarBottom = contentY + contentH;
        const radarHeight = Math.max(0, radarBottom - radarTop);
        const cx = contentX + contentW * 0.5;
        const cy = radarTop + radarHeight * 0.5;
        const radius = Math.max(200, Math.min(contentW * 0.5, radarHeight * 0.5));

        ctx.strokeStyle = '#004422';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
        ctx.stroke();

        const sweepAngle = ((Date.now() % 3000) / 3000) * Math.PI * 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sweepAngle) * radius, cy + Math.sin(sweepAngle) * radius);
        ctx.stroke();

        if (Array.isArray(myPos)) {
          for (const user of visibleUsers) {
            const co = user?.lastUpdate?.co;
            if (!Array.isArray(co) || co.length < 3) continue;

            const targetPos = [Number(co[0]) || 0, Number(co[1]) || 0, Number(co[2]) || 0];
            const distanceNm = distanceMeters(myPos, targetPos) / 1609.34;
            if (!Number.isFinite(distanceNm) || distanceNm <= 0 || distanceNm >= rangeNm) continue;

            const bearing = bearingDeg(myPos, targetPos);
            const relative = (bearing - myHeading - 90) * Math.PI / 180;
            const ratio = distanceNm / rangeNm;
            const px = cx + (ratio * radius) * Math.cos(relative);
            const py = cy + (ratio * radius) * Math.sin(relative);

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(px - 4, py - 4, 8, 8);
            ctx.font = `${Math.round(h * 0.020)}px monospace`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const altKft = Math.round(((Number(co[2]) || 0) * 3.28084) / 1000);
            ctx.fillText(String(altKft), px + 10, py);
          }
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    });

    return true;
  }
}
