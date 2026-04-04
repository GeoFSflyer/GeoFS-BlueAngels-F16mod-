
  class ChecklistModule {
    static loadDefaults(presetName = 'fighter') {
      const defaultsApi = window.ChecklistModuleDefaults;
      const createFromDefaults = defaultsApi?.createModule;
      if (typeof createFromDefaults !== 'function') {
        return null;
      }
      const module = createFromDefaults(presetName);
      return module instanceof ChecklistModule ? module : null;
    }

    constructor(dependencies = {}) {
      this.dependencies = dependencies ?? {};
      this.types = ['PROC', 'EMER', 'OPS', 'FLP'];
      this.checklistsByType = Object.create(null);
      this.currentIndexByType = Object.create(null);

      for (const type of this.types) {
        this.checklistsByType[type] = [];
        this.currentIndexByType[type] = 0;
      }
    }

    registerMfdPages(mfdModule) {
      mfdModule.registerPage({
        title: 'CHK',
        leftButtons: [
          {
            key: 'PREV',
            label: 'PREV',
            states: [''],
            stateIndex: 0,
            managedExternally: true,
            onClick: () => {
              const type = OptionModule.getOption('CHK', 'TYPE', 'PROC');
              this.prevChecklist(type);
            }
          },
          { key: 'N/A1', label: '', states: [''], stateIndex: 0 },
          { key: 'ALL', label: 'SHOW', states: ['ONE', 'ALL'], stateIndex: 0 },
          { key: 'N/A2', label: '', states: [''], stateIndex: 0 },
          {
            key: 'TYPE',
            label: 'TYPE',
            states: ['PROC', 'EMER', 'OPS', 'FLP'],
            stateIndex: 0,
            onClick: ({ nextState }) => {
              OptionModule.setOption('CHK', 'ALL', 'ALL');
              this.setCurrentIndex(nextState, 0);
            }
          },
        ],
        rightButtons: [
          {
            key: 'NEXT',
            label: 'NEXT',
            states: [''],
            stateIndex: 0,
            managedExternally: true,
            onClick: () => {
              const type = OptionModule.getOption('CHK', 'TYPE', 'PROC');
              this.nextChecklist(type);
            }
          },
          { key: 'N/A3', label: '', states: [''], stateIndex: 0 },
          { key: 'N/A31', label: '', states: [''], show: () => { return OptionModule.getOption('CHK', 'ALL', 'ONE') !== 'ONE'; }, stateIndex: 0 },
          {
            key: 'CHECK_ITEM',
            label: 'CHK',
            states: [''],
            stateIndex: 0,
            managedExternally: true,
            show: () => { return OptionModule.getOption('CHK', 'ALL', 'ONE') === 'ONE'; },
            onClick: () => {
              const type = OptionModule.getOption('CHK', 'TYPE', 'PROC');
              this.markNextCurrentItem(type);
            }
          },
          {
            key: 'RESET',
            label: 'RST',
            states: [''],
            stateIndex: 0,
            managedExternally: true,
            onClick: () => {
              const isAllMode = OptionModule.getOption('CHK', 'ALL', 'ONE') === 'ALL';
              const type = OptionModule.getOption('CHK', 'TYPE', 'PROC');

              if (isAllMode) {
                this.resetType(type);
                return;
              }

              this.resetCurrent(type);
            }
          },
          {
            key: 'COMPLETE',
            label: 'DONE',
            states: [''],
            stateIndex: 0,
            managedExternally: true,
            onClick: () => {
              const isAllMode = OptionModule.getOption('CHK', 'ALL', 'ONE') === 'ALL';
              const type = OptionModule.getOption('CHK', 'TYPE', 'PROC');

              if (isAllMode) {
                this.toggleCurrentCompleted(type);
                this.nextChecklistNoWrap(type);
                return;
              }

              this.setCurrentCompleted(type, true);
              this.nextChecklistNoWrap(type);
            }
          },
        ],
        lines: [],
        render: (renderer, renderContext) => {
          const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
          const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
          const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
          const color = renderContext?.color ?? '#00ff66';
          if (!ctx) return;

          const selectedType = OptionModule.getOption('CHK', 'TYPE', 'PROC');
          const showAll = OptionModule.getOption('CHK', 'ALL', 'ONE') === 'ALL';
          const checklists = this.getChecklists(selectedType);

          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = color;
          ctx.strokeStyle = color;
          ctx.textBaseline = 'middle';
          const contentX = w * 0.22;
          const textPx = Math.round(h * 0.045);

          ctx.textAlign = 'left';
          ctx.font = `bold ${textPx}px monospace`;
          ctx.fillText(`TYPE ${selectedType}  MODE ${showAll ? 'ALL' : 'ONE'}`, contentX, h * 0.16);

          if (!checklists.length) {
            ctx.font = `bold ${textPx}px monospace`;
            ctx.fillText('NO CHECKLISTS', contentX, h * 0.24);
            ctx.restore();
            return;
          }

          if (showAll) {
            const startX = contentX;
            const startY = h * 0.22;
            const rowStep = h * 0.062;
            const boxSize = h * 0.032;

            ctx.textAlign = 'left';
            ctx.font = `bold ${textPx}px monospace`;

            for (let i = 0; i < checklists.length; i++) {
              const rowY = startY + i * rowStep;
              if (rowY > h * 0.88) break;

              const checklist = checklists[i];
              ctx.strokeRect(startX, rowY - boxSize * 0.5, boxSize, boxSize);
              if (checklist?.completed) {
                ctx.fillRect(startX + 2, rowY - boxSize * 0.5 + 2, Math.max(0, boxSize - 4), Math.max(0, boxSize - 4));
              }

              const currentMark = i === this.getCurrentIndex(selectedType) ? '>' : ' ';
              ctx.fillText(`${currentMark} ${checklist?.title ?? `Checklist ${i + 1}`}`, startX + boxSize + w * 0.02, rowY);
            }
          } else {
            const current = this.getCurrentChecklist(selectedType);
            const completedTag = current?.completed ? '[X]' : '[ ]';

            ctx.textAlign = 'left';
            ctx.font = `bold ${textPx}px monospace`;
            ctx.fillText(`${completedTag} ${current?.title ?? 'Checklist'}`, contentX, h * 0.24);

            ctx.textAlign = 'left';
            ctx.font = `bold ${textPx}px monospace`;
            const items = Array.isArray(current?.items) ? current.items : [];
            const itemCompleted = this.getCurrentItemCompleted(selectedType);
            let y = h * 0.295;
            for (let i = 0; i < items.length; i++) {
              if (y > h * 0.88) break;
              const marker = itemCompleted[i] ? 'v' : '-';
              ctx.fillText(`${marker} ${items[i]}`, contentX, y);
              y += h * 0.055;
            }
          }

          ctx.restore();
        }
      });
      return true;
    }

    getTypeList(type) {
      const list = this.checklistsByType[type];
      if (!Array.isArray(list)) {
        throw new Error(`Unsupported checklist type: ${type}`);
      }
      return list;
    }

    ensureItemStates(checklist) {
      const states = checklist.itemCompleted;
      if (!Array.isArray(states) || states.length !== checklist.items.length) {
        throw new Error('Checklist itemCompleted must be an array matching items length');
      }
      return states;
    }

    addChecklist(definition) {
      const type = definition.type;
      const list = this.getTypeList(type);

      const title = String(definition?.title ?? '').trim();
      if (!title) return false;

      const items = Array.isArray(definition?.items)
        ? definition.items.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [];

      const id = String(definition?.id ?? `${type}-${list.length + 1}`);
      const checklist = {
        id,
        type,
        title,
        items,
        itemCompleted: Array.isArray(definition?.itemCompleted)
          ? definition.itemCompleted.slice(0, items.length)
          : new Array(items.length).fill(false),
        completed: Boolean(definition?.completed)
      };

      this.ensureItemStates(checklist);
      if (checklist.completed && checklist.itemCompleted.length) {
        checklist.itemCompleted = checklist.itemCompleted.map(() => true);
      }

      list.push(checklist);

      const idx = this.currentIndexByType[type] ?? 0;
      this.currentIndexByType[type] = Math.max(0, Math.min(idx, list.length - 1));
      return true;
    }

    getChecklists(type) {
      return this.getTypeList(type);
    }

    getCurrentIndex(type) {
      const list = this.getChecklists(type);
      if (!list.length) return 0;
      const idx = Number(this.currentIndexByType[type]);
      if (!Number.isFinite(idx)) return 0;
      return Math.max(0, Math.min(list.length - 1, Math.floor(idx)));
    }

    setCurrentIndex(type, index) {
      const list = this.getChecklists(type);
      if (!list.length) {
        this.currentIndexByType[type] = 0;
        return 0;
      }
      const idx = Number(index);
      const clamped = Number.isFinite(idx)
        ? Math.max(0, Math.min(list.length - 1, Math.floor(idx)))
        : 0;
      this.currentIndexByType[type] = clamped;
      return clamped;
    }

    nextChecklist(type) {
      const list = this.getChecklists(type);
      if (!list.length) return null;
      const next = (this.getCurrentIndex(type) + 1) % list.length;
      this.currentIndexByType[type] = next;
      return list[next];
    }

    prevChecklist(type) {
      const list = this.getChecklists(type);
      if (!list.length) return null;
      const next = (this.getCurrentIndex(type) - 1 + list.length) % list.length;
      this.currentIndexByType[type] = next;
      return list[next];
    }

    getCurrentChecklist(type) {
      const list = this.getChecklists(type);
      if (!list.length) return null;
      return list[this.getCurrentIndex(type)] ?? null;
    }

    hasNextChecklist(type) {
      const list = this.getChecklists(type);
      if (!list.length) return false;
      return this.getCurrentIndex(type) < (list.length - 1);
    }

    nextChecklistNoWrap(type) {
      const list = this.getChecklists(type);
      if (!list.length) return null;

      const current = this.getCurrentIndex(type);
      if (current >= list.length - 1) {
        return list[current] ?? null;
      }

      const next = current + 1;
      this.currentIndexByType[type] = next;
      return list[next] ?? null;
    }

    setCurrentCompleted(type, completed) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return false;
      const nextCompleted = Boolean(completed);
      checklist.completed = nextCompleted;

      const states = this.ensureItemStates(checklist);
      for (let i = 0; i < states.length; i++) {
        states[i] = nextCompleted;
      }

      return true;
    }

    toggleCurrentCompleted(type) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return false;
      return this.setCurrentCompleted(type, !checklist.completed);
    }

    getCurrentItemCompleted(type) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return [];
      return this.ensureItemStates(checklist);
    }

    markNextCurrentItem(type) {
      const checklist = this.getCurrentChecklist(type);
      if (!checklist) return false;

      const states = this.ensureItemStates(checklist);
      const nextItemIndex = states.findIndex((value) => !value);
      if (nextItemIndex < 0) {
        if (states.length) {
          checklist.completed = true;
        }
        return false;
      }

      states[nextItemIndex] = true;
      checklist.completed = states.length > 0 && states.every(Boolean);
      return true;
    }

    resetCurrent(type) {
      return this.setCurrentCompleted(type, false);
    }

    resetType(type) {
      const list = this.getChecklists(type);
      for (const checklist of list) {
        checklist.completed = false;
        this.ensureItemStates(checklist).fill(false);
      }
      this.currentIndexByType[type] = 0;
      return true;
    }
  }


