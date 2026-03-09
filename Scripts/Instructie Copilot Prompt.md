/*
FLIGHT RECORDER 0.9.8 BETA — BUILD SPEC (READ THIS FIRST)

Goal: Tampermonkey userscript for https://www.geo-fs.com/ that records flight position/orientation and exact aircraft animations, and replays them with perfect fidelity. Constraints and key requirements:

- RECORDING (default 60 Hz):
  - Capture pose: lla (lat, lon, alt), htr (hdg, pitch, roll).
  - Capture animations via exact matrices per animated node, using DELTA COMPRESSION: per sample, store only matrices that changed vs previous sample, with epsilon (~1e-6).
  - Auto-detect animated node names from geofs.aircraft.instance.definition.parts via tokens:
    ["gear","door","flap","slat","aileron","elevator","rudder","brake","airbrake","canopy","hook","piston","leg","suspension","wheel","bogie","truck","hatch","bay","oleo","shock","ladder","ladderdoor"].
  - Optional warm-up capture (2–3s @10Hz) to include nodes that will change later.
  - Do NOT record ladder/ladderDoor; we will always keep them hidden in playback.
  - Store samples in BLOCKS (e.g., 3000 samples per block) to keep memory stable for 15+ minute recordings.

- PLAYBACK:
  - Spawn ghost via geofs.api.Model using the original modelUrl; passively wait for ghost._model.ready by skipping frames in RAF loop (no setInterval).
  - For each frame/sample: set all changed matrices for that sample onto node.matrix (Cesium.Matrix4.fromArray).
  - Keep last-applied matrices for nodes that don't change this sample.
  - For pose: use plane-spline (Catmull-Rom over XY meters vs base) + RC motion smoothing; fallback to LLA linear; shortest-path for longitude.
  - ALWAYS hide ladder & ladderDoor (node.show=false) after applying matrices each frame.

- STATE MACHINES:
  - recordState: "IDLE" | "RECORDING"
  - playState:   "IDLE" | "PLAYING"
  - The only overlap is the “Start Formation + Start Recording” button.
  - New recordings must NOT appear in the flight list until STOP was pressed.

- UI:
  - Big red START RECORDING button at top; when active => blue STOP RECORDING.
  - Gray centered status: "REC • {samples} • {Hz}"
  - Default rate: 60 Hz.
  - Playback section: Start Formation (selected), Start Formation + New Recording, Stop All.
  - Flights list cards: [Select][Name input + Rename][Duration s][Rate][Play/Pause][Stop][Delete]
  - Storage: Save/Load (localStorage) + Export/Import (JSON) + brief help text.
  - Model Test (debug): Build/Refresh Cache + Ladder Show/Hide.

- MULTI-GHOST ISOLATION:
  - Each track must own its node cache and “last-applied” matrices. Never share caches globally.

- LADDER POLICY:
  - Ladder and ladderDoor must ALWAYS be hidden (spawn, start, every frame), independent of gear/flaps.

- PERFORMANCE:
  - Single RAF loop; max catch-up steps (e.g., 10) and dt cap (~120 ms).
  - Avoid per-frame allocations. Reuse buffers where possible.

- STORAGE SCHEMA (localStorage + Export JSON):
  Project { version:"0.9.8", tracks:[{ id,name,modelUrl,sampleMs,base, lla[],htr[],xy[], blocks: [ {t, m:{nodeName:Matrix16}}[] ] }] }

- ERROR HANDLING:
  - Node not found => skip.
  - Ghost not ready => skip frame (no setInterval).
  - State guards: prevent illegal transitions.

Implement the above as one userscript with well-structured modules (functions). Keep code readable, comment key parts, and align variable names with this spec.
*/