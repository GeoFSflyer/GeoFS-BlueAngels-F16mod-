# Developer documentation
Learn more on how to write GeoFS Addons in [this short manual](GeoFS.md).

## F-18 Addon
The main F-18 Addon will be updated from time to time with new functionality. Unless you want to directly contribute to the plugin, it's best to customize it with your own Tampermonkey script. [This script](geo-fs-f18-mod-flightplan.js) is an example on how to add checklists, briefings and a custom IFF Codebook to the F-18.

## F18Addon API (public)
The addon now exposes a single global namespace:

```js
window.F18Addon
```

### Modules overview

#### `window.F18Addon.lifecycle`
- `start()`
- `stop()`
- `restart()`
- `isRunning()`

#### `window.F18Addon.options`
- `buildKey(pageTitle, buttonKey)`
- `read()`
- `get(pageTitle, buttonKey, fallback?)`
- `set(pageTitle, buttonKey, value)`
- `getValue(pageTitle, buttonKey, fallback?)`

#### `window.F18Addon.checklists`
- `getModule()`
- `addChecklist(definition)`
- `getChecklists(type)`
- `getCurrentChecklist(type)`
- `getCurrentItemCompleted(type)`
- `markNextCurrentItem(type)`
- `setCurrentIndex(type, index)`
- `nextChecklist(type)`
- `nextChecklistNoWrap(type)`
- `prevChecklist(type)`
- `setCurrentCompleted(type, completed)`
- `toggleCurrentCompleted(type)`
- `resetCurrent(type)`
- `resetType(type)`

#### `window.F18Addon.weapons`
- `getMode()`
- `getLoadout()`
- `getSelectedWeapon()`
- `selectNext(minimumQuantity?)`
- `fireSelected()`
- `jettisonSelected()`
- `startRearm(config)`
- `getRearmState()`

#### `window.F18Addon.controls`
- `setProbeState(state)` // `OPEN` or `CLOSED`
- `getProbeState()`

#### `window.F18Addon.nav`
- `getModule()`
- `getCurrentNavUnit()`
- `getReadouts()`
- `getNavaidLabel()`
- `getAutopilotHeading()`

#### `window.F18Addon.map`
- `getModule()`
- `getRangeNm()`
- `setRangeNm(rangeNm)`
- `stepRange(step)`
- `getSceneData()`

#### `window.F18Addon.communication`
- `getModule()`
- `getProfile()`
- `setProfile({ group, flight, wingman })`
- `getGroup()`
- `setGroup(value)`
- `getFlight()`
- `setFlight(value)`
- `getWingman()`
- `setWingman(value)`
- `getVoiceLanguage()`
- `setVoiceLanguage(language)`
- `getMessages(mode?, limit?)` // mode: `ALL`, `GROUP`, `FLIGHT`, `WINGMAN`, `NONE`
- `getHudMessage()`

`window.F18Addon.nav.getReadouts()` returns a shared snapshot used by both HUD and MFD NAV rendering:

```js
{
  navUnit,
  dme,            // number | null
  bearing,        // number | null
  course,         // number | null
  timeToSignal,   // number | null
  navaidLabel,    // string, e.g. "ILS KJFK", "VOR ABC"
  autopilotHeading // number | null
}
```

`window.F18Addon.map.getSceneData()` returns shared geometric data used by NAV `HSI` and `MAP` rendering:

```js
{
  ownship: { lat, lon, alt, heading } | null,
  rangeNm,        // selected NAV range
  traffic: [      // multiplayer aircraft in heading-relative NM offsets
    { uid, callsign, lat, lon, alt, forwardNm, rightNm }
  ],
  waypoints: [    // flightplan waypoints in heading-relative NM offsets
    { index, ident, selected, type, lat, lon, forwardNm, rightNm }
  ]
}
```

#### `window.F18Addon.mfd`
- `getSlots()`
- `addPage(pageDefinition, insertIndex?)`
- `setPageDefinition(target, pageDefinition)`
- `addDisplay(config?)`
- `getDisplayState(slotName)`
- `setPage(slotName, pageIndex)`
- `nextPage(slotName)`
- `toggleButton(slotName, side, index)`

### MFD page/button definition options
When you add or overwrite an MFD page, use this structure:

```js
{
  title: 'PAGE',
  leftButtons: [/* button defs */],
  rightButtons: [/* button defs */],
  lines: [],
  render: (renderer, renderContext) => {}
}
```

Each button object can use:

- `key`: logical option key (stored as `PAGE.KEY`)
- `label`: button label shown on MFD
- `states`: selectable states (cycled on click)
- `stateIndex`: default state index
- `values`: optional mapped values for states (used by `options.getValue`)
- `onClick(ctx)`: custom click callback
- `show(ctx)`: conditionally show/hide button
- `managedExternally: true`: do not auto-cycle/persist after click (you handle it in `onClick`)
- `combinedAction: true`: mark as part of a grouped action block
- `combinedGroupLabel`: label shown for grouped block
- `minimal: true`: for combined groups, hide bracket/group label and show only a centered state/value between the grouped buttons

`onClick` and `show` receive a context object with:
- `page`
- `button`
- `uiState`
- `side`
- `index`
- (for `onClick`) `currentIndex`, `nextIndex`, `nextState`

### Example: conditional button with `show()`

```js
{
  key: 'FIRE',
  label: 'FIRE',
  states: ['N/A'],
  stateIndex: 0,
  show: () => window.F18Addon.options.get('WPN', 'MASTER', 'OFF') !== 'OFF',
  onClick: () => window.F18Addon.weapons.fireSelected()
}
```

### Example: grouped buttons (`combinedAction`)

```js
rightButtons: [
  {
    key: 'PLAYBACK',
    label: 'START',
    states: ['START'],
    combinedAction: true,
    combinedGroupLabel: 'PLAYBACK',
    managedExternally: true,
    onClick: () => window.FlightRecorder?.api?.playback?.start?.()
  },
  {
    key: 'PLAYBACK',
    label: 'PAUSE',
    states: ['PAUSE'],
    combinedAction: true,
    combinedGroupLabel: 'PLAYBACK',
    managedExternally: true,
    onClick: () => window.FlightRecorder?.api?.playback?.pause?.()
  },
  {
    key: 'PLAYBACK',
    label: 'STOP',
    states: ['STOP'],
    combinedAction: true,
    combinedGroupLabel: 'PLAYBACK',
    managedExternally: true,
    onClick: () => window.FlightRecorder?.api?.playback?.stop?.()
  }
]
```

### Shared option keys (via `F18Options`)
The MFD writes and reads shared options using normalized keys like `PAGE.BUTTON`.

Known keys used by the addon:

- `REC.STATE`
- `REC.PLAYBACK`
- `HUD.BRIGHT`
- `HUD.LEVEL`
- `HUD.MAX_G`
- `HUD.COLOR`
- `SYS.FLAPS`
- `SYS.SPEEDBRAKE`
- `SYS.REFUELING`
- `CHK.PREV`
- `CHK.N_A1`
- `CHK.ALL`
- `CHK.N_A2`
- `CHK.TYPE`
- `CHK.NEXT`
- `CHK.N_A3`
- `CHK.N_A31`
- `CHK.CHECK_ITEM`
- `CHK.RESET`
- `CHK.COMPLETE`
- `WPN.MASTER`
- `WPN.SELECT`
- `WPN.CONFIG`
- `WPN.MODE`
- `WPN.FIRE`
- `WPN.JETTISON`
- `WPN.REARM`
- `COMM.VOICE`
- `COMM.DISPLAY`
- `COMM.HUD`
- `COMM.GROUP`
- `COMM.FLIGHT`
- `COMM.WINGMAN`
- `COMM.VOICE_LANG`

### Weapon state storage
Weapon runtime state is stored separately in `F18WpnState`.

### Example: wait for addon + add checklist

```js
const poll = setInterval(() => {
  const api = window.F18Addon?.checklists;
  if (!api) return;
  clearInterval(poll);

  api.addChecklist({
    type: 'OPS',
    title: 'My Procedures',
    items: ['Briefing complete', 'Weather checked'],
    completed: false,
  });
}, 500);
```

### Example: shared options

```js
const addon = window.F18Addon;
if (!addon) throw new Error('F18Addon not ready');

// Set the WPN.MASTER (Master arm switch) to ON.
addon.options.set('WPN', 'MASTER', 'ON');

// Get the WPN.MASTER state, with a default value of OFF if it isn't set.
console.log(addon.options.get('WPN', 'MASTER', 'OFF')); // Returns ON
```

### Example: per-display MFD state

```js
const addon = window.F18Addon;
if (!addon) throw new Error('F18Addon not ready');

addon.mfd.setPage('LEFT', 3);  // only LEFT display changes page
addon.mfd.setPage('RIGHT', 1); // only RIGHT display changes page
```

### Example: add an extra MFD via API

```js
const addon = window.F18Addon;
if (!addon) throw new Error('F18Addon not ready');

const extra = addon.mfd.addDisplay({
  name: 'CENTER',
  position: [0, 6.158, 0.584],
  rotation: [8, 0, 0],
  scale: [0.29, 0.29, 0.285],
  defaultPageTitle: 'HUD'
});

console.log('Added MFD slot:', extra.slotName, 'part:', extra.partName);
```

### Example: add a custom MFD page

```js
const addon = window.F18Addon;
if (!addon) throw new Error('F18Addon not ready');

addon.mfd.addPage({
  title: 'TACT',
  leftButtons: [
    { key: 'MODE', label: 'MODE', states: ['A', 'B', 'C'], stateIndex: 0 }
  ],
  rightButtons: [
    { key: 'RNG', label: 'RNG', states: ['10', '20', '40'], stateIndex: 1 }
  ],
  lines: [],
  render: (renderer, renderContext) => {
    const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
    const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
    const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
    if (!ctx) return;

    ctx.save();
    ctx.fillStyle = renderContext?.color ?? '#00ff66';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.06)}px monospace`;
    ctx.fillText('TACTICAL PAGE', w * 0.5, h * 0.5);
    ctx.restore();
  }
});
```

### Example: overwrite an existing page

```js
const addon = window.F18Addon;
if (!addon) throw new Error('F18Addon not ready');

addon.mfd.setPageDefinition('AUX1', {
  title: 'MAP',
  leftButtons: [
    { key: 'LAYER', label: 'MAP', states: ['OFF', 'ON'], stateIndex: 1 }
  ],
  rightButtons: [
    { key: 'ZOOM', label: 'ZOOM', states: ['1X', '2X', '4X'], stateIndex: 0 }
  ],
  lines: [],
  render: (renderer, renderContext) => {
    const ctx = renderContext?.ctx ?? renderer?.canvasAPI?.context;
    const w = renderContext?.w ?? renderer?.canvasAPI?.canvas?.width ?? 512;
    const h = renderContext?.h ?? renderer?.canvasAPI?.canvas?.height ?? 512;
    if (!ctx) return;

    ctx.save();
    ctx.fillStyle = renderContext?.color ?? '#00ff66';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.06)}px monospace`;
    ctx.fillText('CUSTOM MAP PAGE', w * 0.5, h * 0.5);
    ctx.restore();
  }
});
```

### Example: configure communication filters + voice

```js
const addon = window.F18Addon;
if (!addon) throw new Error('F18Addon not ready');

addon.communication.setProfile({
  group: 'BlueAngels',
  flight: 'FlightAlpha',
  wingman: 'BA2'
});

addon.communication.setVoiceLanguage('en-US');

// Read the latest 5 messages that are outside your configured filters.
const outsideMessages = addon.communication.getMessages('ALL', 5);
console.log(outsideMessages);
```

## Flight Recorder API
The Flight Recorder now exposes a public API on `window.FlightRecorder.api` so other scripts/plugins can control recording and playback.

You can always check if it is available:

```js
if (window.FlightRecorder?.api) {
	// API ready
}
```

As a lot of GeoFS files get loaded when you start GeoFS, it might take a while before my addons are available. In [this script](geo-fs-f18-mod-flightplan.js) you can see how to wait until a specific API is available.

### Version
- `window.FlightRecorder.api.getVersion()`

### State
- `window.FlightRecorder.api.getState(trackIds?)`
- `window.FlightRecorder.api.recording.getState()`
- `window.FlightRecorder.api.playback.getState(trackIds?)`

### Recording controls
- `window.FlightRecorder.api.recording.start()`
- `window.FlightRecorder.api.recording.stop()`

### Playback controls
- `window.FlightRecorder.api.playback.start(trackIds?)`
- `window.FlightRecorder.api.playback.pause(trackIds?)`
- `window.FlightRecorder.api.playback.stop(trackIds?)`

`trackIds` is optional and can be:
- omitted (all playable tracks)
- a single track id string (example: `"T0001"`)
- an array of track ids (example: `["T0001", "T0002"]`)

### Return values
Control methods return an object with fields like:
- `ok` (boolean)
- `state` (global playback or recording state)
- `reason` (when not successful, e.g. `"NO_TRACKS"`)
- `trackIds` (affected track ids, for playback methods)

Example:

```js
const api = window.FlightRecorder?.api;
if (!api) throw new Error('Flight Recorder API not available');

console.log('FR version:', api.getVersion());
console.log('Current state:', api.getState());

api.recording.start();
// ...
api.recording.stop();

api.playback.start();
api.playback.pause();
api.playback.stop();
```


# TODO
## Controls (like fuel probe)
V Have control buttons bottom right in GeoFS UI (like PROBE OPEN/CLOSED)
- Add option to keybind controls

## Seats
- Add seat reset button
- Move to SeatModule

## Modules
Alle functionaliteit in aparte modules, zodat je later dit ook naar andere vliegtuigen kan brengen.

## Spoiler
V Option to set max spoiler position (10% to FULL) with combined buttons

## LIMITS
- Add limits based on config in MFD (weapon config, or probe in/out, current speed, etc.)
- If limit is exceeded send warning state, led HUD and MFD module display warning

## DAMAGE
- If limit is exceeded, simulate failure (fe. gear cannot change state anymore, or flaps go to 0)
- Change SYS page to show damaged parts + change current indicators to F-18 with red faults.

## FUEL
- Manage fuel flow (calculate in PFC). If fuel is 0, engine off. 
- Allow in flight refueling by extending probe and fly without autopilot in a certain box (fe. speed 250, alt 10,000, heading 255). When conditions are met, fuel is replenished.

## Speech
- Make a seperate speach plugin to read out chat + API to use it
  - Integrate this in MFD with VOICE ON/OFF button

## Pages
### RADAR
- Add Radar page + control to turn it on/off.
- Add HSI page with option to change course/heading

### Scratchpad
- Add scratchpad and buttons to center
  - The scratchpad can be in a mode (fe. HDGSELECT). The mode is displayed. When pressing enter the scratched heading is used.
- Add push buttons below to select display. On the right of the scratchpad a few displays with a button show data. WHen pressing the button you can change the value in the scratchpad.
  - FE. AP button. You push it and see on the displays on the right alt/speed/heading. You push a button heading, and you go into heading select mode for the scratchpad.
  - FE. IFF button. You can type in your IFF number. IFF is displayed on the right.

## IFF
- Should be a seperate module, with custom API.
- Integration with MfdModule: Add page. Let you set shared IFF code.
- If on and target locked, change username to username[IFF-id-other-aircraft+code]. The other aircraft should calculate response based on their IFF number and the code. And change their username to [IFFR+response-code]. If the interrogating aircraft receives this response, it changes to [IFF-FRIEND-id-other-aircraft] (or FOO)


























