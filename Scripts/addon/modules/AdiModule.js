class AdiModule {
  registerMfdPages(mfdModule) {
    mfdModule.registerPage({
      title: 'ADI',
      leftButtons: [],
      rightButtons: [],
      lines: [],
      render: (renderer, renderContext) => {
        const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
        const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
        const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
        const layout = renderContext?.layout;
        const color = renderContext?.color ?? '#00ff66';
        if (!ctx) return;

        const pitch = Number(window.geofs?.animation?.values?.atilt) || 0;
        const roll = Number(window.geofs?.animation?.values?.aroll) || 0;
        const kias = Math.round(Number(window.geofs?.animation?.values?.kias) || 0);
        const alt = Math.round((Number(window.geofs?.animation?.values?.altitude) || 0));
        const vsi = Math.round(Number(window.geofs?.animation?.values?.climbrate) || 0);

        const frame = layout?.frame ?? { left: 0, top: 0, width: w, height: h };

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        const cx = frame.left + frame.width * 0.5;
        const cy = frame.top + frame.height * 0.54;
        const radius = frame.width * 0.31;
        const pScale = 8;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();

        ctx.translate(cx, cy);
        ctx.rotate((roll * Math.PI) / 180);
        ctx.translate(0, -pitch * pScale);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 4; i < radius * 4; i += 8) {
          ctx.moveTo(-radius * 3, i);
          ctx.lineTo(radius * 3, i);
        }
        ctx.stroke();

        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-radius * 3, 0);
        ctx.lineTo(radius * 3, 0);
        ctx.stroke();

        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -radius * 5);
        ctx.lineTo(0, radius * 5);
        ctx.stroke();

        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let p = -90; p <= 90; p += 10) {
          if (p === 0) continue;
          const py = -p * pScale;
          const lineW = (p % 20 === 0) ? 50 : 25;
          ctx.beginPath();
          ctx.moveTo(-lineW, py);
          ctx.lineTo(lineW, py);
          ctx.stroke();
          ctx.fillStyle = '#000000';
          ctx.fillRect(-18, py - 9, 36, 18);
          ctx.fillStyle = color;
          ctx.fillText(Math.abs(p), 0, py + 1);
        }
        ctx.restore();

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        const wx = cx;
        const wy = cy;
        const ww = w * 0.027;
        const wh = h * 0.016;
        const stub = w * 0.010;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wx - ww, wy);
        ctx.lineTo(wx - ww * 0.55, wy + wh);
        ctx.lineTo(wx, wy - wh * 0.15);
        ctx.lineTo(wx + ww * 0.55, wy + wh);
        ctx.lineTo(wx + ww, wy);
        ctx.moveTo(wx - ww - stub, wy);
        ctx.lineTo(wx - ww, wy);
        ctx.moveTo(wx + ww, wy);
        ctx.lineTo(wx + ww + stub, wy);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const boxY = cy - radius - h * 0.012;
        const spdX = w * 0.18;
        const altX = w * 0.82;

        ctx.lineWidth = 2;
        ctx.strokeRect(spdX - 42, boxY - 20, 84, 40);
        ctx.font = 'bold 26px monospace';
        ctx.fillText(kias, spdX, boxY + 2);

        ctx.strokeRect(altX - 52, boxY - 22, 104, 44);
        const altRounded = Math.max(0, Math.round(alt));
        const thousands = Math.floor(altRounded / 1000);
        const hundredsText = String(altRounded % 1000).padStart(3, '0');
        const rightX = altX + 52 - w * 0.014;
        const altCenterY = boxY + 1;

        ctx.textAlign = 'right';
        ctx.font = 'bold 22px monospace';
        const hundredsWidth = ctx.measureText(hundredsText).width;
        ctx.fillText(hundredsText, rightX, altCenterY);
        ctx.font = 'bold 30px monospace';
        ctx.fillText(String(thousands), rightX - hundredsWidth - w * 0.006, altCenterY);

        const vsiText = `${vsi >= 0 ? ' ' : ''}${vsi}`;
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(vsiText, altX - w * 0.07, boxY - h * 0.08);

        ctx.restore();
      }
    });

    return true;
  }
}
