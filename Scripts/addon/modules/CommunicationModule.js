
  class CommunicationModule {
    static HISTORY_LIMIT = 120;
    static HUD_MESSAGE_VISIBLE_MS = 10000;
    static VOICE_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3];

    // Initializes communication state and hook references.
    constructor(dependencies = {}) {
      this.dependencies = dependencies ?? {};
      this.installed = false;
      this.multiplayerRef = null;
      this.originalUpdateCallback = null;
      this.wrappedUpdateCallback = null;
      this.messages = [];
      this.hudMessage = null;
      this.lastVoiceMode = 'NONE';
      this.voiceEnabledAtServerTime = null;
      this.voiceEnabledAtLocalMs = 0;
    }

    // Installs the multiplayer update hook used for incoming chat messages.
    ensureLoaded() {
      if (this.installed) return true;
      return this.installMultiplayerHook();
    }

    // Registers the COMM MFD page.
    registerMfdPages(mfdModule) {
      const communicationModule = this;
      mfdModule.registerPage({
        title: 'COMM',
        leftButtons: [
          { key: 'SHOW', label: 'SHOW', states: ['MSG', 'CFG'], stateIndex: 0 },
          { key: 'N/A1', label: '', states: [''], stateIndex: 0 },
          {
            key: 'DISPLAY',
            label: 'DISP',
            states: ['NO', 'ALL', 'GRP', 'FLT', 'W/M'],
            values: ['NONE', 'ALL', 'GROUP', 'FLIGHT', 'WINGMAN'],
            stateIndex: 0,
            show: () => OptionModule.getOption('COMM', 'SHOW', 'MSG') === 'MSG'
          },
          { key: 'N/A2', label: '', states: [''], stateIndex: 0 },
          {
            key: 'HUD',
            label: 'HUD',
            states: ['NO', 'ALL', 'GRP', 'FLT', 'W/M'],
            values: ['NONE', 'ALL', 'GROUP', 'FLIGHT', 'WINGMAN'],
            stateIndex: 0,
            show: () => OptionModule.getOption('COMM', 'SHOW', 'MSG') === 'MSG'
          }
        ],
        rightButtons: [
          {
            key: 'VOICE',
            label: 'VOICE',
            states: ['NONE', 'ALL', 'GROUP', 'FLIGHT', 'WINGMAN'],
            stateIndex: 0,
            show: () => OptionModule.getOption('COMM', 'SHOW', 'MSG') === 'CFG'
          },
          { key: 'N/A3', label: '', states: [''], stateIndex: 0 },
          {
            key: 'RATE',
            label: 'RATE',
            states: ['0.75', '1', '1.25', '1.5', '2', '2.5', '3'],
            values: [0.75, 1, 1.25, 1.5, 2, 2.5, 3],
            stateIndex: 3,
            show: () => OptionModule.getOption('COMM', 'SHOW', 'MSG') === 'CFG'
          }
        ],
        lines: [],
        render: (renderer, renderContext) => {
          const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
          const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
          const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
          const color = renderContext?.color ?? '#00ff66';
          if (!ctx) return;

          const profile = communicationModule.getProfile();
          const voiceLanguage = communicationModule.getVoiceLanguage();
          const voiceRate = communicationModule.getVoiceRate();
          const voiceMode = OptionModule.getOptionValue('COMM', 'VOICE', 'NONE');
          const displayMode = OptionModule.getOptionValue('COMM', 'DISPLAY', 'NONE');
          const hudMode = OptionModule.getOptionValue('COMM', 'HUD', 'NONE');
          const showMode = OptionModule.getOption('COMM', 'SHOW', 'MSG');
          const mfdMessageMode = displayMode === 'ALL' ? 'ANY' : displayMode;

          const recentMessages = communicationModule.getMessagesByMode(mfdMessageMode, 5);

          const fmt = (value, withBrackets = false) => {
            const token = String(value ?? '').trim();
            if (!token) return '-';
            return withBrackets ? `[${token}]` : token;
          };
          const trimMessageLine = (text, maxChars = 64) => communicationModule.trimLine(text, maxChars);
          const wrapFixed = (text, lineLen = 32, maxLines = 2) => {
            const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
            if (!cleaned) return [''];
            const lines = [];
            let cursor = 0;
            while (cursor < cleaned.length && lines.length < maxLines) {
              const remaining = cleaned.slice(cursor);
              if (remaining.length <= lineLen) {
                lines.push(remaining);
                cursor = cleaned.length;
                break;
              }

              let cut = lineLen;
              const lastSpace = remaining.slice(0, lineLen + 1).lastIndexOf(' ');
              if (lastSpace > Math.floor(lineLen * 0.6)) {
                cut = lastSpace;
              }

              lines.push(remaining.slice(0, cut).trim());
              cursor += cut;
              while (cleaned[cursor] === ' ') cursor += 1;
            }

            if (cursor < cleaned.length && lines.length) {
              const last = lines.length - 1;
              lines[last] = trimMessageLine(lines[last], lineLen);
            }

            return lines.slice(0, maxLines);
          };

          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = color;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.2, w * 0.0022);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';

          if (showMode === 'CFG') {
            const cfgX = w * 0.33;
            let y = h * 0.16;
            const cfgTextPx = Math.round(h * 0.045);
            const colorGroup = communicationModule.getMfdCallsignColor({ category: 'GROUP' });
            const colorFlight = communicationModule.getMfdCallsignColor({ category: 'FLIGHT' });
            const colorWingman = communicationModule.getMfdCallsignColor({ category: 'WINGMAN' });

            ctx.font = `bold ${cfgTextPx}px monospace`;
            ctx.fillStyle = color;
            ctx.fillText(`VOICE ${voiceMode}`, cfgX, y);
            y += h * 0.046;
            ctx.fillText(`DISP ${displayMode}`, cfgX, y);
            y += h * 0.046;
            ctx.fillText(`HUD ${hudMode}`, cfgX, y);

            y += h * 0.056;
            ctx.fillStyle = colorGroup;
            ctx.fillText(`GROUP ${fmt(profile.group, true)}`, cfgX, y);

            y += h * 0.046;
            ctx.fillStyle = colorFlight;
            ctx.fillText(`FLIGHT ${fmt(profile.flight, true)}`, cfgX, y);

            y += h * 0.046;
            ctx.fillStyle = colorWingman;
            ctx.fillText(`WINGMAN ${fmt(profile.wingman, false)}`, cfgX, y);

            y += h * 0.046;
            ctx.fillStyle = color;
            ctx.fillText(`LANG ${fmt(voiceLanguage, false)}`, cfgX, y);

            y += h * 0.046;
            ctx.fillText(`RATE ${fmt(String(voiceRate), false)}`, cfgX, y);
          } else {
            const panelX = w * 0.19;
            const panelW = w * 0.78;
            const rowH = h * 0.145;
            const rowTopMargin = h * 0.11;
            const rowBottomMargin = h * 0.11;
            const firstRowCenterY = rowTopMargin + rowH * 0.5;
            const lastRowCenterY = h - rowBottomMargin - rowH * 0.5;
            const rowStep = (lastRowCenterY - firstRowCenterY) / 4;
            const rowStartY = firstRowCenterY;

            const callsignFontPx = Math.round(h * 0.038);
            const messageFontPx = Math.round(h * 0.044);
            const msgLineStep = h * 0.040;

            for (let i = 0; i < 5; i++) {
              const rowY = rowStartY + i * rowStep;
              const rowTop = rowY - rowH * 0.48;

              const item = recentMessages[recentMessages.length - 1 - i] ?? null;
              const rowColor = item
                ? (communicationModule?.getMfdCallsignColor?.(item) ?? '#ffffff')
                : color;
              ctx.strokeStyle = rowColor;
              ctx.strokeRect(panelX, rowTop, panelW, rowH);

              if (!item) {
                ctx.fillStyle = color;
                ctx.font = `bold ${messageFontPx}px monospace`;
                ctx.fillText('--', panelX + w * 0.012, rowY);
                continue;
              }

              const callsignLine = trimMessageLine(`[${item.category}] ${item.callsign}`, 56);
              const wrappedMessageLines = wrapFixed(item.message, 35, 2);

              ctx.fillStyle = rowColor;
              ctx.font = `bold ${callsignFontPx}px monospace`;
              ctx.fillText(callsignLine, panelX + w * 0.012, rowY - h * 0.036);

              ctx.fillStyle = rowColor;
              ctx.font = `bold ${messageFontPx}px monospace`;
              ctx.fillText(wrappedMessageLines[0] ?? '', panelX + w * 0.012, rowY - h * 0.001);
              ctx.fillText(wrappedMessageLines[1] ?? '', panelX + w * 0.012, rowY - h * 0.001 + msgLineStep);
            }
          }

          ctx.restore();
        }
      });

      return true;
    }

    // Restores multiplayer callbacks and clears volatile communication state.
    restore() {
      this.uninstallMultiplayerHook();
      this.hudMessage = null;
      this.lastVoiceMode = 'NONE';
      this.voiceEnabledAtServerTime = null;
      this.voiceEnabledAtLocalMs = 0;
      this.installed = false;
    }

    // Installs a safe wrapper around multiplayer.updateCallback.
    installMultiplayerHook() {
      const multiplayerRef = window.multiplayer;
      if (!multiplayerRef || typeof multiplayerRef.updateCallback !== 'function') return false;

      if (this.wrappedUpdateCallback && multiplayerRef.updateCallback === this.wrappedUpdateCallback) {
        this.installed = true;
        return true;
      }

      const original = multiplayerRef.updateCallback;
      const self = this;
      this.originalUpdateCallback = original;
      this.multiplayerRef = multiplayerRef;
      this.wrappedUpdateCallback = function (payload) {
        self.onMultiplayerUpdatePayload(payload);
        return original.apply(this, arguments);
      };

      multiplayerRef.updateCallback = this.wrappedUpdateCallback;
      this.installed = true;
      return true;
    }

    // Restores the original multiplayer.updateCallback.
    uninstallMultiplayerHook() {
      if (!this.multiplayerRef) {
        this.originalUpdateCallback = null;
        this.wrappedUpdateCallback = null;
        return;
      }

      if (this.wrappedUpdateCallback && this.multiplayerRef.updateCallback === this.wrappedUpdateCallback) {
        this.multiplayerRef.updateCallback = this.originalUpdateCallback;
      }

      this.originalUpdateCallback = null;
      this.wrappedUpdateCallback = null;
      this.multiplayerRef = null;
    }

    // Returns the configured communication profile.
    getProfile() {
      return {
        group: String(OptionModule.getOption('COMM', 'GROUP', '') ?? ''),
        flight: String(OptionModule.getOption('COMM', 'FLIGHT', '') ?? ''),
        wingman: String(OptionModule.getOption('COMM', 'WINGMAN', '') ?? '')
      };
    }

    // Stores the configured communication group token.
    setGroup(value) {
      OptionModule.setOption('COMM', 'GROUP', value);
      return value;
    }

    // Stores the configured communication flight token.
    setFlight(value) {
      OptionModule.setOption('COMM', 'FLIGHT', value);
      return value;
    }

    // Stores the configured wingman token.
    setWingman(value) {
      OptionModule.setOption('COMM', 'WINGMAN', value);
      return value;
    }

    // Stores multiple communication profile filters in one call.
    setProfile(profile = {}) {
      return {
        group: this.setGroup(profile.group),
        flight: this.setFlight(profile.flight),
        wingman: this.setWingman(profile.wingman)
      };
    }

    // Reads the configured voice synthesis language.
    getVoiceLanguage() {
      return String(OptionModule.getOption('COMM', 'VOICE_LANG', 'en-US') ?? 'en-US') || 'en-US';
    }

    // Stores the voice synthesis language.
    setVoiceLanguage(language) {
      OptionModule.setOption('COMM', 'VOICE_LANG', language);
      return language;
    }

    // Reads the configured speech rate.
    getVoiceRate() {
      return Number(OptionModule.getOptionValue('COMM', 'RATE', 1.5));
    }

    // Stores the configured speech rate.
    setVoiceRate(rate) {
      OptionModule.setOption('COMM', 'RATE', String(rate));
      return rate;
    }

    // Decodes URL-encoded multiplayer chat text.
    decodeChatText(value) {
      return decodeURIComponent(value.replace(/\+/g, '%20'));
    }

    // Extracts the spoken callsign by removing all bracketed tags.
    getSpokenCallsign(callsign) {
      const withoutTags = callsign.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      return withoutTags || 'UNKNOWN';
    }

    // Resolves profile match flags for one callsign.
    resolveMatches(callsign) {
      const profile = this.getProfile();

      const groupMatch = Boolean(profile.group && callsign.includes(`[${profile.group}]`));
      const flightMatch = Boolean(profile.flight && callsign.includes(`[${profile.flight}]`));
      const wingmanMatch = Boolean(profile.wingman && callsign.includes(profile.wingman));
      const allMatch = !groupMatch && !flightMatch && !wingmanMatch;

      return {
        groupMatch,
        flightMatch,
        wingmanMatch,
        allMatch
      };
    }

    // Checks if a message matches a selected communication mode.
    matchesMode(mode, entry) {
      if (mode === 'NONE') return false;
      if (mode === 'ALL') return !!entry?.allMatch;
      if (mode === 'GROUP') return !!entry?.groupMatch;
      if (mode === 'FLIGHT') return !!entry?.flightMatch;
      if (mode === 'WINGMAN') return !!entry?.wingmanMatch;
      return false;
    }


    // Returns a short category tag for a classified chat message.
    getCategoryTag(entry) {
      if (entry?.wingmanMatch) return 'WINGMAN';
      if (entry?.flightMatch) return 'FLIGHT';
      if (entry?.groupMatch) return 'GROUP';
      return 'ALL';
    }

    // Returns the callsign color used on the COMM MFD message list.
    getMfdCallsignColor(entry) {
      if (entry?.category === 'GROUP') return '#ff4444';
      if (entry?.category === 'FLIGHT') return '#3da2ff';
      if (entry?.category === 'WINGMAN') return '#33ff66';
      return '#ffffff';
    }

    // Trims a line to a fixed character budget.
    trimLine(text, maxChars = 72) {
      const value = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!value) return '';
      if (value.length <= maxChars) return value;
      return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
    }

    // Handles raw payloads from GeoFS multiplayer updates.
    onMultiplayerUpdatePayload(payload) {
      const messages = Array.isArray(payload?.chatMessages) ? payload.chatMessages : [];
      if (!messages.length) return;

      for (const message of messages) {
        this.processIncomingMessage(message, payload);
      }
    }

    // Updates the voice activation anchor used to suppress old messages.
    refreshVoiceActivationWindow(voiceMode, payloadServerTime) {
      const mode = String(voiceMode ?? 'NONE');
      const previousMode = this.lastVoiceMode;

      if (mode !== 'NONE' && previousMode === 'NONE') {
        const serverTime = Number(payloadServerTime);
        this.voiceEnabledAtServerTime = Number.isFinite(serverTime) ? serverTime : null;
        this.voiceEnabledAtLocalMs = Date.now();
      }

      if (mode === 'NONE') {
        this.voiceEnabledAtServerTime = null;
        this.voiceEnabledAtLocalMs = 0;
      }

      this.lastVoiceMode = mode;
    }

    // Returns true when a message arrived after voice mode was enabled.
    isMessageNewForVoice(entry) {
      if (Number.isFinite(this.voiceEnabledAtServerTime) && Number.isFinite(entry?.serverTime)) {
        return entry.serverTime > this.voiceEnabledAtServerTime;
      }
      if (Number.isFinite(this.voiceEnabledAtLocalMs) && this.voiceEnabledAtLocalMs > 0) {
        return Number(entry?.timestampMs) > this.voiceEnabledAtLocalMs;
      }
      return false;
    }

    // Processes one incoming chat message and dispatches side effects.
    processIncomingMessage(message, payload) {
      const callsign = message?.cs || 'UNKNOWN';
      const text = this.decodeChatText(message?.msg ?? '').trim();
      if (!text) return;

      const matches = this.resolveMatches(callsign);
      const entry = {
        uid: String(message?.uid ?? ''),
        acid: Number(message?.acid),
        callsign,
        message: text,
        serverTime: Number(payload?.serverTime) || null,
        timestampMs: Date.now(),
        category: this.getCategoryTag(matches),
        ...matches
      };

      this.messages.push(entry);
      if (this.messages.length > CommunicationModule.HISTORY_LIMIT) {
        this.messages.splice(0, this.messages.length - CommunicationModule.HISTORY_LIMIT);
      }

      const voiceMode = OptionModule.getOptionValue('COMM', 'VOICE', 'NONE');
      this.refreshVoiceActivationWindow(voiceMode, payload?.serverTime);
      if (this.matchesMode(voiceMode, entry) && this.isMessageNewForVoice(entry)) {
        this.speakMessage(entry);
      }

      const hudMode = OptionModule.getOptionValue('COMM', 'HUD', 'NONE');
      if (this.matchesMode(hudMode, entry)) {
        const formatted = [
          `[${entry.category}]`,
          this.trimLine(entry.callsign, 44),
          this.trimLine(entry.message, 88)
        ].join('\n');
        this.hudMessage = {
          text: formatted,
          expiresAtMs: Date.now() + CommunicationModule.HUD_MESSAGE_VISIBLE_MS
        };
      }
    }

    // Speaks one chat message using the browser speech synthesis API.
    speakMessage(entry) {
      const synth = window.speechSynthesis;
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return false;

      const spokenCallsign = this.getSpokenCallsign(entry.callsign);
      const utterance = new window.SpeechSynthesisUtterance(`${spokenCallsign}. ${entry.message}`);
      utterance.lang = this.getVoiceLanguage();
      utterance.rate = this.getVoiceRate();
      synth.speak(utterance);
      return true;
    }

    // Returns the latest messages for the selected communication mode.
    getMessagesByMode(mode = 'ALL', limit = 5) {
      const modeToken = String(mode ?? 'ALL').toUpperCase();
      const max = Math.max(1, Math.min(50, Number(limit) || 5));
      const filtered = modeToken === 'ANY'
        ? this.messages.slice()
        : this.messages.filter((entry) => this.matchesMode(modeToken, entry));
      return filtered.slice(Math.max(0, filtered.length - max));
    }

    // Returns the active HUD overlay text while its visibility timer is valid.
    getHudOverlayText() {
      if (!this.hudMessage?.text) return null;
      if (!Number.isFinite(this.hudMessage.expiresAtMs) || Date.now() > this.hudMessage.expiresAtMs) {
        this.hudMessage = null;
        return null;
      }
      return this.hudMessage.text;
    }
  }


