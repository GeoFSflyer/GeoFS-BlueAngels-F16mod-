
  class RecorderModule {
    FLIGHT_RECORDER_MIN_VERSION = '1.2.0';

    constructor(dependencies = {}) {
      this.dependencies = dependencies ?? {};
    }

    registerMfdPages(mfdModule) {
      mfdModule.registerPage({
        title: 'REC',
        leftButtons: [
          {
            key: 'STATE',
            label: 'REC',
            states: ['OFF'],
            stateIndex: 0,
            managedExternally: true,
            onClick: () => {
              this.toggleRecordingFromMfd();
            }
          },
        ],
        rightButtons: [
          {
            key: 'PLAYBACK',
            label: 'START',
            states: ['START'],
            stateIndex: 0,
            managedExternally: true,
            combinedAction: true,
            combinedGroupLabel: 'PLAYBACK',
            onClick: () => {
              this.controlPlaybackFromMfd('START');
            }
          },
          {
            key: 'PLAYBACK',
            label: 'PAUSE',
            states: ['PAUSE'],
            stateIndex: 0,
            managedExternally: true,
            combinedAction: true,
            combinedGroupLabel: 'PLAYBACK',
            onClick: () => {
              this.controlPlaybackFromMfd('PAUSE');
            }
          },
          {
            key: 'PLAYBACK',
            label: 'STOP',
            states: ['STOP'],
            stateIndex: 0,
            managedExternally: true,
            combinedAction: true,
            combinedGroupLabel: 'PLAYBACK',
            onClick: () => {
              this.controlPlaybackFromMfd('STOP');
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

          const status = window.F18Addon?.recorder?.getFlightRecorderMfdStatus?.() ?? { installed: false, compatible: false, recordingState: 'OFF', playbackState: 'STOPPED' };
          const cx = w * 0.5;

          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          if (!status.compatible) {
            ctx.font = `bold ${Math.round(h * 0.042)}px monospace`;
            ctx.fillText('Install Flight Recorder', cx, h * 0.58);
            ctx.fillText('v1.2.0 or higher', cx, h * 0.66);
            ctx.restore();
            return;
          }

          ctx.font = `bold ${Math.round(h * 0.042)}px monospace`;
          ctx.fillText(`FR v${status.version ?? 'unknown'}`, cx, h * 0.56);
          ctx.fillText(`REC ${status.recordingState}`, cx, h * 0.64);
          ctx.fillText(`PLAY ${status.playbackState}`, cx, h * 0.72);
          ctx.restore();
        }
      });
      return true;
    }

    isFlightRecorderCompatible() {
      return HelperModule.isSemverAtLeast(window.FlightRecorder?.api.getVersion() ?? '0.0.0', this.FLIGHT_RECORDER_MIN_VERSION);
    }

    getFlightRecorderMfdStatus() {
      const installed = Boolean(window.FlightRecorder?.api);
      const version = window.FlightRecorder?.api.getVersion();
      const compatible = this.isFlightRecorderCompatible();

      if (!installed || !compatible) {
        return {
          installed,
          compatible: false,
          version,
          recordingState: 'OFF',
          playbackState: 'STOPPED',
          message: 'Install Flight Recorder v1.2.0 or higher'
        };
      }

      return {
        installed,
        compatible: true,
        version,
        recordingState: window.FlightRecorder?.api.recording.getState().state,
        playbackState: window.FlightRecorder?.api.playback.getState().state,
        message: ''
      };
    }

    toggleRecordingFromMfd() {
      if (!this.isFlightRecorderCompatible()) return false;

      const currentState = window.FlightRecorder?.api.recording.getState().state;
      if (currentState === 'RECORDING') {
        window.FlightRecorder?.api.recording.stop();
      } else {
        window.FlightRecorder?.api.recording.start();
      }
      return true;
    }

    controlPlaybackFromMfd(action) {
      if (!this.isFlightRecorderCompatible()) return false;

      if (action === 'START') {
        window.FlightRecorder?.api.playback.start();
        return true;
      }
      if (action === 'PAUSE') {
        window.FlightRecorder?.api.playback.pause();
        return true;
      }
      if (action === 'STOP') {
        window.FlightRecorder?.api.playback.stop();
        return true;
      }
      return false;
    }
  }

