class FlightModule {
  static DISPLAY_MODES = ['ADI', 'FLP', 'MRK', 'MSS', 'IFF'];
  static MARKPOINT_TYPES = ['TARGET', 'FRIENDLY', 'RESQUE', 'CIVILIAN'];
  static MISSION_PAGE_STATES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

  constructor(getAddon = () => null) {
    this.getAddon = getAddon;
    this.selectedFlpIndex = 0;
    this.selectedMarkpointIndex = 0;
    this.missionPageIndex = 0;
  }

  getDisplayMode() {
    return OptionModule.getOption('FLT', 'DISPLAY', OptionModule.getOption('ADI', 'DISPLAY', 'ADI'));
  }

  getDataCartridge() {
    return this.getAddon()?.dataCartridge ?? null;
  }

  getFlightPlanItems() {
    return window.geofs?.flightPlan?.waypointArray ?? [];
  }

  getMarkpointItems() {
    const cartridge = this.getDataCartridge();
    return cartridge?.getMarkpoints?.() ?? [];
  }

  getSelectedFlpIndex(items) {
    if (!items.length) {
      this.selectedFlpIndex = 0;
      return 0;
    }
    this.selectedFlpIndex = Math.max(0, Math.min(this.selectedFlpIndex, items.length - 1));
    return this.selectedFlpIndex;
  }

  getSelectedMarkpointIndex(items) {
    if (!items.length) {
      this.selectedMarkpointIndex = 0;
      return 0;
    }
    this.selectedMarkpointIndex = Math.max(0, Math.min(this.selectedMarkpointIndex, items.length - 1));
    return this.selectedMarkpointIndex;
  }

  stepSelectedFlightPlan(step) {
    const items = this.getFlightPlanItems();
    if (!items.length) return false;

    const current = this.getSelectedFlpIndex(items);
    const next = (current + step + items.length) % items.length;
    this.selectedFlpIndex = next;
    return true;
  }

  stepSelectedMarkpoint(step) {
    const items = this.getMarkpointItems();
    if (!items.length) return false;

    const current = this.getSelectedMarkpointIndex(items);
    const next = (current + step + items.length) % items.length;
    this.selectedMarkpointIndex = next;
    return true;
  }

  activateSelectedFlightPlan() {
    const items = this.getFlightPlanItems();
    if (!items.length) return false;

    const index = this.getSelectedFlpIndex(items);
    window.geofs.flightPlan.selectWaypoint(index);
    return true;
  }

  activateSelectedMarkpoint() {
    const items = this.getMarkpointItems();
    if (!items.length) return false;

    const index = this.getSelectedMarkpointIndex(items);
    const markpoint = items[index];
    const cartridge = this.getDataCartridge();
    cartridge?.setActiveMarkpoint?.(index);
    const targetingPod = this.getAddon()?.targetingPod;
    if (targetingPod?.trackMarkpoint) {
      targetingPod.trackMarkpoint(markpoint);
    }
    return true;
  }

  deleteSelectedFlightPlan() {
    const items = this.getFlightPlanItems();
    if (!items.length) return false;

    const index = this.getSelectedFlpIndex(items);
    window.geofs.flightPlan.deleteWaypoint(index);
    const nextItems = this.getFlightPlanItems();
    this.selectedFlpIndex = Math.max(0, Math.min(index, Math.max(0, nextItems.length - 1)));
    return true;
  }

  deleteSelectedMarkpoint() {
    const items = this.getMarkpointItems();
    if (!items.length) return false;

    const index = this.getSelectedMarkpointIndex(items);
    const cartridge = this.getDataCartridge();
    cartridge.deleteMarkpoint(index);
    const nextItems = this.getMarkpointItems();
    this.selectedMarkpointIndex = Math.max(0, Math.min(index, Math.max(0, nextItems.length - 1)));
    return true;
  }

  setSelectedMarkpointType(type) {
    const items = this.getMarkpointItems();
    if (!items.length) return false;

    const index = this.getSelectedMarkpointIndex(items);
    const cartridge = this.getDataCartridge();
    return cartridge.setMarkpointType(index, type);
  }

  cycleSelectedMarkpointType() {
    const items = this.getMarkpointItems();
    if (!items.length) return false;

    const index = this.getSelectedMarkpointIndex(items);
    const current = items[index]?.type;
    const states = FlightModule.MARKPOINT_TYPES;
    const currentIndex = states.findIndex((type) => type === current);
    const nextIndex = (currentIndex + 1 + states.length) % states.length;
    return this.setSelectedMarkpointType(states[nextIndex]);
  }

  getMissionSections() {
    const data = this.getDataCartridge()?.getMissionData?.() ?? {};
    const rawNotes = String(data.notes ?? data.cruise?.notes ?? '').replace(/\r?\n/g, ' ');
    const noteLines = rawNotes.match(/.{1,38}/g) ?? [''];
    const positions = Array.isArray(data.positions) ? data.positions : [];
    const positionRows = positions.length
      ? positions.map((position, index) => [
        `#${index + 1}`,
        position?.callsign ?? position?.name ?? position?.pilot ?? ''
      ])
      : [['#1', '']];

    return {
      mission: {
        title: 'MISSION',
        rows: [
          ['Name', data.missionName ?? data.name ?? 'Untitled'],
          ['Group', data.group ?? ''],
          ['Flight', data.flight ?? ''],
          ['Wingman', data.wingman ?? '']
        ]
      },
      times: {
        title: 'TIMES',
        rows: [
          ['Start', data.flightData?.startTimeZ ?? ''],
          ['Taxi', data.flightData?.startTaxiZ ?? ''],
          ['T/O', data.flightData?.startToZ ?? ''],
          ['TOT', data.flightData?.timeOverTargetZ ?? ''],
          ['End', data.flightData?.endTimeZ ?? '']
        ]
      },
      cruise: {
        title: 'CRUISE',
        rows: [
          ['Altitude', data.cruise?.altitude ?? ''],
          ['Speed', data.cruise?.speed ?? '']
        ]
      },
      notes: {
        title: 'NOTES',
        rows: noteLines.map((line) => ['', line])
      },
      positions: {
        title: 'POSITIONS',
        rows: positionRows
      },
      landing: {
        title: 'LANDING',
        rows: [
          ['Airport', data.landing?.airportIcao ?? ''],
          ['Runway', data.landing?.runway ?? ''],
          ['NAV1', data.landing?.nav1 ?? ''],
          ['Pattern', data.landing?.pattern ?? ''],
          ['Form', data.landing?.formation ?? '']
        ]
      },
      landingPerf: {
        title: 'LANDING PERF',
        rows: [
          ['Entry AGL', data.landing?.altEntryAgl ?? ''],
          ['Entry SPD', data.landing?.speedEntryKn ?? ''],
          ['Pitch Int', data.landing?.pitchIntervalS ?? ''],
          ['Downwind', data.landing?.speedDownwindKn ?? '']
        ]
      }
    };
  }

  getMissionPages() {
    const sections = this.getMissionSections();
    return [
      {
        rowHeights: [0.38, 0.16, 0.46],
        blocks: [
          { section: sections.mission, col: 0, row: 0, colSpan: 1 },
          { section: sections.times, col: 1, row: 0, colSpan: 1 },
          { section: sections.cruise, col: 0, row: 1, colSpan: 2 },
          { section: sections.notes, col: 0, row: 2, colSpan: 2 }
        ]
      },
      {
        rowHeights: [0.333, 0.333, 0.334],
        blocks: [
          { section: sections.landing, col: 0, row: 0, colSpan: 2 },
          { section: sections.landingPerf, col: 0, row: 1, colSpan: 2 },
          { section: sections.positions, col: 0, row: 2, colSpan: 2 }
        ]
      }
    ];
  }

  getMissionPageCount() {
    return this.getMissionPages().length;
  }

  renderAdi(ctx, w, h, color, layout) {
    const pitch = Number(window.geofs?.animation?.values?.atilt) || 0;
    const roll = Number(window.geofs?.animation?.values?.aroll) || 0;
    const kias = Math.round(Number(window.geofs?.animation?.values?.kias) || 0);
    const alt = Math.round(Number(window.geofs?.animation?.values?.altitude) || 0);
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
    const spdX = w * 0.25;
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

  renderSelectableList(ctx, w, h, items, selectedIndex, title, rowBuilder, color, options = {}) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.045)}px monospace`;
    ctx.fillText(title, w * 0.22, h * 0.16);

    if (!items.length) {
      ctx.fillText('NO ITEMS', w * 0.22, h * 0.26);
      ctx.restore();
      return;
    }

    const keyX = w * (options.keyXRatio ?? 0.24);
    const valueX = w * (options.valueXRatio ?? 0.62);
    const prefixOffset = w * (options.prefixOffsetRatio ?? 0.018);
    let y = h * 0.25;
    for (let i = 0; i < items.length; i++) {
      if (y > h * 0.88) break;
      const item = items[i];
      const prefix = i === selectedIndex ? '>' : ' ';
      const row = rowBuilder(item, i) ?? {};
      const rowColor = options.rowColorBuilder ? options.rowColorBuilder(item, i) : color;
      ctx.fillStyle = rowColor;
      ctx.fillText(prefix, keyX - prefixOffset, y);
      ctx.fillText(String(row.key ?? ''), keyX, y);
      ctx.fillText(String(row.value ?? ''), valueX, y);
      y += h * 0.055;
    }

    ctx.restore();
  }

  renderMissionGroup(ctx, group, x, y, width, height, color) {
    const rows = group?.rows ?? [];
    const keyValueOffsetRatio = 0.52;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(String(group?.title ?? ''), x + 10, y + 16);

    if (group?.title === 'NOTES') {
      let lineY = y + 40;
      ctx.font = 'bold 16px monospace';
      for (const [, value] of rows) {
        if (lineY > y + height - 12) break;
        ctx.fillText(String(value ?? ''), x + 10, lineY);
        lineY += 20;
      }
      return;
    }

    if (group?.title === 'CRUISE') {
      const left = rows[0] ?? ['Altitude', ''];
      const right = rows[1] ?? ['Speed', ''];
      const colWidth = width * 0.5;
      const leftX = x + 10;
      const rightX = x + colWidth + 10;
      const leftValueX = leftX + colWidth * keyValueOffsetRatio;
      const rightValueX = rightX + colWidth * keyValueOffsetRatio;
      const rowY = y + 44;

      ctx.font = 'bold 16px monospace';
      ctx.fillText(String(left[0] ?? ''), leftX, rowY);
      ctx.fillText(String(left[1] ?? ''), leftValueX, rowY);
      ctx.fillText(String(right[0] ?? ''), rightX, rowY);
      ctx.fillText(String(right[1] ?? ''), rightValueX, rowY);
      return;
    }

    if (group?.title === 'POSITIONS') {
      const shown = rows.slice(0, 8);
      const twoColumns = shown.length > 4;
      const colWidth = twoColumns ? width * 0.5 : width;
      const leftPad = 10;
      const valueOffset = twoColumns ? colWidth * keyValueOffsetRatio : width * keyValueOffsetRatio;
      ctx.font = 'bold 16px monospace';

      for (let i = 0; i < shown.length; i++) {
        const column = twoColumns ? Math.floor(i / 4) : 0;
        const rowIndex = twoColumns ? (i % 4) : i;
        const rowY = y + 40 + rowIndex * 20;
        if (rowY > y + height - 12) break;
        const colX = x + column * colWidth;
        const keyX = colX + leftPad;
        const valueX = colX + leftPad + valueOffset;
        ctx.fillText(String(shown[i][0] ?? ''), keyX, rowY);
        ctx.fillText(String(shown[i][1] ?? ''), valueX, rowY);
      }
      return;
    }

    const keyX = x + 10;
    const valueX = x + width * keyValueOffsetRatio;
    let rowY = y + 40;
    ctx.font = 'bold 16px monospace';
    for (const [key, value] of rows) {
      if (rowY > y + height - 12) break;
      ctx.fillText(String(key ?? ''), keyX, rowY);
      ctx.fillText(String(value ?? ''), valueX, rowY);
      rowY += 20;
    }
  }

  renderMissionData(ctx, w, h, color, renderContext) {
    const pages = this.getMissionPages();
    const pageCount = Math.max(1, pages.length);
    const pageButton = renderContext?.page?.leftButtons?.find((button) => button?.key === 'PAGE');

    this.missionPageIndex = Math.max(0, Math.min(this.missionPageIndex, pageCount - 1));
    if (pageButton) {
      pageButton.stateIndex = this.missionPageIndex;
    }

    const activePage = pages[this.missionPageIndex] ?? { rowHeights: [0.333, 0.333, 0.334], blocks: [] };
    const pageBlocks = activePage.blocks ?? [];

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.043)}px monospace`;
    ctx.fillText(`MISSION DATA ${this.missionPageIndex + 1}/${pageCount}`, w * 0.22, h * 0.12);

    const gridLeft = w * 0.22;
    const gridTop = h * 0.17;
    const gapX = w * 0.02;
    const gapY = h * 0.03;
    const gridW = w * 0.70;
    const gridH = h * 0.74;
    const boxW = (gridW - gapX) / 2;
    const availableH = gridH - gapY * 2;
    const rowHeights = activePage.rowHeights ?? [0.333, 0.333, 0.334];
    const rowSizes = [
      availableH * (rowHeights[0] ?? 0.333),
      availableH * (rowHeights[1] ?? 0.333),
      availableH * (rowHeights[2] ?? 0.334)
    ];
    const rowOffsets = [
      0,
      rowSizes[0] + gapY,
      rowSizes[0] + gapY + rowSizes[1] + gapY
    ];

    for (const block of pageBlocks) {
      const column = block.col ?? 0;
      const row = block.row ?? 0;
      const colSpan = block.colSpan ?? 1;
      const x = gridLeft + column * (boxW + gapX);
      const y = gridTop + (rowOffsets[row] ?? rowOffsets[0]);
      const width = colSpan === 2 ? (boxW * 2 + gapX) : boxW;
      const height = rowSizes[row] ?? rowSizes[0];
      this.renderMissionGroup(ctx, block.section, x, y, width, height, color);
    }

    ctx.restore();
  }

  renderIff(ctx, w, h, color) {
    const codes = this.getDataCartridge()?.getIffCodes?.() ?? [];

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.045)}px monospace`;
    ctx.fillText('IFF CODEBOOK', w * 0.22, h * 0.16);

    ctx.font = `bold ${Math.round(h * 0.024)}px monospace`;
    ctx.fillText('Interrogate: Say "IFF [CS] - Code [NO.]"', w * 0.22, h * 0.20);
    ctx.fillText('Response: "IFF [Code]"', w * 0.22, h * 0.235);

    if (!codes.length) {
      ctx.fillText('NO IFF CODES', w * 0.22, h * 0.26);
      ctx.restore();
      return;
    }

    const firstColumnLimit = 7;
    const shown = codes.slice(0, firstColumnLimit * 2);
    const baseX = w * 0.22;
    const columnGap = w * 0.31;
    const responseOffset = w * 0.12;
    const lineHeight = h * 0.053;
    ctx.font = `bold ${Math.round(h * 0.043)}px monospace`;

    for (let i = 0; i < shown.length; i++) {
      const column = i >= firstColumnLimit ? 1 : 0;
      const row = i % firstColumnLimit;
      const y = h * 0.29 + row * lineHeight;
      if (y > h * 0.88) break;
      const code = shown[i];
      const keyX = baseX + column * columnGap;
      const valueX = keyX + responseOffset;
      ctx.fillText(String(code.key ?? ''), keyX, y);
      ctx.fillText(String(code.response ?? ''), valueX, y);
    }

    ctx.restore();
  }

  registerMfdPages(mfdModule) {
    mfdModule.registerPage({
      title: 'FLT',
      leftButtons: [
        {
          key: 'DISPLAY',
          label: 'DISP',
          states: FlightModule.DISPLAY_MODES,
          stateIndex: 0
        },
        {
          key: 'N/A20',
          label: '',
          states: [''],
          stateIndex: 0,
          show: () => this.getDisplayMode() === 'MSS' && this.getMissionPageCount() > 1
        },
        {
          key: 'PAGE',
          label: 'PAGE',
          states: FlightModule.MISSION_PAGE_STATES,
          stateIndex: 0,
          managedExternally: true,
          show: () => this.getDisplayMode() === 'MSS' && this.getMissionPageCount() > 1,
          onClick: ({ button }) => {
            const pageCount = this.getMissionPageCount();
            if (pageCount <= 1) {
              this.missionPageIndex = 0;
              if (button) button.stateIndex = 0;
              return;
            }
            this.missionPageIndex = (this.missionPageIndex + 1) % pageCount;
            if (button) button.stateIndex = this.missionPageIndex;
          }
        },
        {
          key: 'PREV',
          label: '↑',
          states: [''],
          stateIndex: 0,
          managedExternally: true,
          show: () => {
            const mode = this.getDisplayMode();
            return mode === 'FLP' || mode === 'MRK';
          },
          onClick: () => {
            if (this.getDisplayMode() === 'FLP') {
              this.stepSelectedFlightPlan(-1);
              return;
            }
            this.stepSelectedMarkpoint(-1);
          }
        },
        {
          key: 'NEXT',
          label: '↓',
          states: [''],
          stateIndex: 0,
          managedExternally: true,
          show: () => {
            const mode = this.getDisplayMode();
            return mode === 'FLP' || mode === 'MRK';
          },
          onClick: () => {
            if (this.getDisplayMode() === 'FLP') {
              this.stepSelectedFlightPlan(1);
              return;
            }
            this.stepSelectedMarkpoint(1);
          }
        },
        {
          key: 'TYPE',
          label: 'TYPE',
          states: [''],
          stateIndex: 0,
          managedExternally: true,
          show: () => this.getDisplayMode() === 'MRK',
          onClick: () => {
            this.cycleSelectedMarkpointType();
          }
        }
      ],
      rightButtons: [
        {
          key: 'N/A30',
          label: '',
          states: [''],
          stateIndex: 0,
          show: () => {
            const mode = this.getDisplayMode();
            return mode === 'FLP' || mode === 'MRK';
          }
        },
        {
          key: 'ACTIVATE',
          label: 'ACTIVATE',
          states: [''],
          stateIndex: 0,
          managedExternally: true,
          show: () => {
            const mode = this.getDisplayMode();
            return mode === 'FLP' || mode === 'MRK';
          },
          onClick: () => {
            if (this.getDisplayMode() === 'FLP') {
              this.activateSelectedFlightPlan();
              return;
            }
            this.activateSelectedMarkpoint();
          }
        },
        {
          key: 'N/A31',
          label: '',
          states: [''],
          stateIndex: 0,
          show: () => {
            const mode = this.getDisplayMode();
            return mode === 'FLP' || mode === 'MRK';
          }
        },
        {
          key: 'N/A32',
          label: '',
          states: [''],
          stateIndex: 0,
          show: () => {
            const mode = this.getDisplayMode();
            return mode === 'FLP' || mode === 'MRK';
          }
        },
        {
          key: 'DELETE',
          label: 'DEL',
          states: [''],
          stateIndex: 0,
          managedExternally: true,
          show: () => {
            const mode = this.getDisplayMode();
            return mode === 'FLP' || mode === 'MRK';
          },
          onClick: () => {
            if (this.getDisplayMode() === 'FLP') {
              this.deleteSelectedFlightPlan();
              return;
            }
            this.deleteSelectedMarkpoint();
          }
        }
      ],
      lines: [],
      render: (renderer, renderContext) => {
        const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
        const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
        const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
        const color = renderContext?.color ?? '#00ff66';
        const layout = renderContext?.layout;
        if (!ctx) return;

        const displayMode = this.getDisplayMode();

        if (displayMode === 'ADI') {
          this.renderAdi(ctx, w, h, color, layout);
          return;
        }

        if (displayMode === 'FLP') {
          const items = this.getFlightPlanItems();
          const selectedIndex = this.getSelectedFlpIndex(items);
          this.renderSelectableList(
            ctx,
            w,
            h,
            items,
            selectedIndex,
            'FLIGHTPLAN',
            (item, index) => ({
              key: `WP${index + 1} ${item.ident ?? ''}`.trim(),
              value: `${item.type ?? ''}${item?.selected ? ' (ACTIVE)' : ''}`
            }),
            color,
            {
              keyXRatio: 0.23,
              valueXRatio: 0.60,
              prefixOffsetRatio: 0.028
            }
          );
          return;
        }

        if (displayMode === 'MRK') {
          const items = this.getMarkpointItems();
          const selectedIndex = this.getSelectedMarkpointIndex(items);
          this.renderSelectableList(
            ctx,
            w,
            h,
            items,
            selectedIndex,
            'MARKPOINTS',
            (item, index) => ({
              key: `MRK${index + 1} ${item.abbreviation ?? item.name ?? ''}`.trim(),
              value: `${item.type ?? ''}${item?.active ? ' (ACTIVE)' : ''}`
            }),
            color,
            {
              keyXRatio: 0.23,
              valueXRatio: 0.56,
              prefixOffsetRatio: 0.028,
              rowColorBuilder: (item) => this.getDataCartridge()?.getMarkpointColor(item?.type) ?? color
            }
          );
          return;
        }

        if (displayMode === 'MSS') {
          this.renderMissionData(ctx, w, h, color, renderContext);
          return;
        }

        this.renderIff(ctx, w, h, color);
      }
    });

    return true;
  }
}

window.FlightModule = FlightModule;
