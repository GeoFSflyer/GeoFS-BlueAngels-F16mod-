# Developer documentation
Learn more on how to write GeoFS Addons in [this short manual](GeoFS.md).

## F-18 Addon
The main F-18 Addon will be updated from time to time with new functionality. Unless you want to directly contribute to the plugin, it's best to customize it with your own Tampermonkey script. [This script](geo-fs-f18-mod-flightplan.js) is an example on how to add checklists, briefings and a custom IFF Codebook to the F-18.

## F18Addon API (public)
The addon now exposes a single global namespace:

```js
window.F18Addon
```

### Design rules
- **One global only**: `window.F18Addon`
- **MFD state is per display** (LEFT/RIGHT are independent)
- **Options are shared** between displays through `F18Options` storage
- Addon logic is still F-18-only (aircraft id check), but module API names are generic

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

#### `window.F18Addon.mfd`
- `getSlots()`
- `getDisplayState(slotName)`
- `setPage(slotName, pageIndex)`
- `nextPage(slotName)`
- `toggleButton(slotName, side, index)`

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

addon.options.set('WPN', 'MASTER', 'ON');
console.log(addon.options.get('WPN', 'MASTER', 'OFF')); // ON
```

### Example: per-display MFD state

```js
const addon = window.F18Addon;
if (!addon) throw new Error('F18Addon not ready');

addon.mfd.setPage('LEFT', 3);  // only LEFT display changes page
addon.mfd.setPage('RIGHT', 1); // only RIGHT display changes page
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

```
// Speak chat test
const utterance = new SpeechSynthesisUtterance("Hello this is a test.");
utterance.lang = "en-US"; // or "nl-NL" for Dutch
speechSynthesis.speak(utterance);


// Standaard 500, voor minder lag.
geofs.MPSMinUpdateDelay = 1000

// Send message in chat
window.multiplayer.setChatMessage("Test");

// Updates with +1 every time a chat is received.
window.multiplayer.chatMessageId

// Go a bit down in cockpit view, so the fpv aligns with 0
geofs.camera.modes[1].position[2] = 1

// Check: is in cockpit view
geofs.camera.currentDefinition.name == 'cockpit'
geofs.camera.currentDefinition.insideView == true

// F-18 Throttle + Joystick cam
geofs.camera.modes[1].position = [-0.17, 5.4, 0.3];
geofs.camera.modes[1].orientations['current'] = [0, -8, 0];
geofs.camera.modes[1].FOV = 1.7;
geofs.camera.modes[1].insideView = true;

// Cockpit next to seat cam
geofs.camera.modes[1].position = [0.38, 5, 0.8];
geofs.camera.modes[1].orientations['current'] = [-20, -13, 0];
geofs.camera.modes[1].FOV = 2;
geofs.camera.modes[1].insideView = true;

// Next to cocpit looking back
geofs.camera.modes[1].position = [0.9, 4.86, 0.6];
geofs.camera.modes[1].orientations['current'] = [-211, -2.3, 0];

// Set opacity of instruments
instruments.setOpacity(0.9)
```

You can add your custom cameras to GeoFS like this:

```
geofs.camera.modes.push(
{
  "FOV": 10, // 1 = zoomed in, 10 = zoomed out
  "insideView": true, // true = sounds of inside, false sound of outside
  "mode": 6,
  "name": "Look back",
  "offsetBounds": [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
  "offsets":
  {
    "current": [0, 0, 0],
    "last": [0, 0, 0],
    "neutral": [0, 0, 0],
  },
  "orientation": [180, -20, 0], // Repeat current
  "orientations":
  {
    "current": [180, -20, 0], // 180 = turn around 180 degrees, look back. -20 = look a bit downward
    "last": [180, 0, 0],
    "neutral": [180, 0, 0],
  },
  "position" [0, 3.2, 1.25], // 0 = left/right: 0 = center, 3.2 = forward/rearward: 3.2 = to rear, 1.25 = up/down, 1 = neutral
  "view": "Look back"
});
```

Here is how we added F-18 camera angles:

```
// Nose cam looking back
geofs.camera.modes[6] =
{
  "distance": 0,
  "FOV": 10,
  "insideView": false,
  "mode": 6,
  "name": "Nose cam",
  "offsetBounds": [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
  "offsets":
  {
    "current": [0, 0.5, -1],
    "last": [0, 0.5, 0],
    "neutral": [0, 0.5, 0],
  },
  "orientation": [180, 20, -1.5],
  "orientations":
  {
    "current": [180, 20, 0],
    "last": [180, 20, 0],
    "neutral": [180, 20, 0],
  },
  "position": [0, 11.55, -1.5],
  "view": "Nose cam"
};

geofs.camera.modes[7] =
{
  "distance": 0,
  "FOV": 10,
  "insideView": false,
  "mode": 7,
  "name": "Cockpit Rear",
  "offsetBounds": [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
  "offsets":
  {
    "current": [0, 0.5, -1],
    "last": [0, 0.5, 0],
    "neutral": [0, 0.5, 0],
  },
  "orientation": [180, -15, -1.5],
  "orientations":
  {
    "current": [180, -15, 0],
    "last": [180, -15, 0],
    "neutral": [180, -15, 0],
  },
  "position": [0, 5, 3.4],
  "view": "Cockpit Rear"
};

geofs.camera.modes[8] =
{
  "distance": 0,
  "FOV": 10,
  "insideView": false,
  "mode": 8,
  "name": "Wingman",
  "offsetBounds": [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
  "offsets":
  {
    "current": [0, 0.5, -1],
    "last": [0, 0.5, 0],
    "neutral": [0, 0.5, 0],
  },
  "orientation": [115, -12, 0],
  "orientations":
  {
    "current": [115, -15, 0],
    "last": [115, -15, 0],
    "neutral": [115, -15, 0],
  },
  "position": [1, 4, -0.3],
  "view": "Wingman"
};

geofs.camera.modes[9] =
{
  "distance": 0,
  "FOV": 2,
  "insideView": false,
  "mode": 9,
  "name": "Down Rear",
  "offsetBounds": [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
  "offsets":
  {
    "current": [0, 0.5, -1],
    "last": [0, 0.5, 0],
    "neutral": [0, 0.5, 0],
  },
  "orientation": [180, 20, -1.5],
  "orientations":
  {
    "current": [180, 20, 0],
    "last": [180, 20, 0],
    "neutral": [180, 20, 0],
  },
  "position": [0, 4, -1],
  "view": "Down Rear"
};

geofs.camera.modes[10] =
{
  "distance": 0,
  "FOV": 2,
  "insideView": false,
  "mode": 10,
  "name": "Gun cam",
  "offsetBounds": [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
  "offsets":
  {
    "current": [0, -6, -1],
    "last": [0, 0.5, 0],
    "neutral": [0, 0.5, 0],
  },
  "orientation": [10, 0, 0],
  "orientations":
  {
    "current": [10, 0, 0],
    "last": [0, 20, 0],
    "neutral": [0, 20, 0],
  },
  "position": [3, 4.5, 1.85],
  "view": "Gun cam"
};

geofs.camera.modes[11] =
{
  "distance": 0,
  "FOV": 10,
  "insideView": false,
  "mode": 11,
  "name": "Wing cam",
  "offsetBounds": [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
  "offsets":
  {
    "current": [0, -5, -1],
    "last": [0, 0.5, 0],
    "neutral": [0, 0.5, 0],
  },
  "orientation": [30, 35, 0],
  "orientations":
  {
    "current": [30, 35, 0],
    "last": [0, 20, 0],
    "neutral": [0, 20, 0],
  },
  "position": [-6, 0, 0.1],
  "view": "Wing cam"
};

geofs.camera.modes[12] =
{
  "distance": 0,
  "FOV": 1.7,
  "insideView": true,
  "mode": 12,
  "name": "Throttle cam",
  "offsetBounds": [-0.4, 0.4, 0, 0.1, -0.3, 0.3],
  "offsets":
  {
    "current": [0, 0, 0],
    "last": [0, 0, 0],
    "neutral": [0, 0, 0],
  },
  "orientation": [0, -8, 0],
  "orientations":
  {
    "current": [0, -8, 0],
    "last": [0, -8, 0],
    "neutral": [0, -8, 0],
  },
  "position": [-0.17, 5.4, 0.3],
  "view": "Throttle cam",
};

// Only mode[1] shows the detailed cockpit layout. So you can set one mode at a time.
// Throttle + Joystick cam
geofs.camera.modes[1].position = [-0.17, 5.4, 0.3];
geofs.camera.modes[1].orientations['current'] = [0, -8, 0];
geofs.camera.modes[1].FOV = 1.7;
geofs.camera.modes[1].insideView = true;

// Cockpit next to seat cam
geofs.camera.modes[1].position = [0.38, 5, 0.8];
geofs.camera.modes[1].orientations['current'] = [-20, -13, 0];
geofs.camera.modes[1].FOV = 2;
geofs.camera.modes[1].insideView = true;

// Next to cocpit looking back
geofs.camera.modes[1].position = [0.9, 4.86, 0.6];
geofs.camera.modes[1].orientations['current'] = [-211, -2.3, 0];
```
























# Multiplayer

GeoFS sends a request to https://mps.geo-fs.com/update?l=4 every 500 ms. There you can see locations of nearby airplanes and newly arrived chat messages:

```

{
    "myId": "4335605638136",
    "userCount": 1054,
    "users": [
        {
            "id": "4335605638136",
            "acid": 1376210,
            "ac": 27,
            "cs": "Natrium[BlueAngels2]",
            "st": {
                "gr": 1,
                "as": 0,
                "lv": {
                    "url": "https://raw.githubusercontent.com/ArjanKw/GeoFS-BlueAngels/refs/heads/main/airline.json",
                    "idx": 1
                }
            },
            "co": [
                51.4475079,
                4.3341316,
                25.77,
                -3.83,
                1.42,
                0.07
            ],
            "ve": [
                0,
                0,
                0.00000495,
                0,
                0,
                0
            ],
            "ti": null
        },
        {
            "id": "4337881690137",
            "acid": 1230474,
            "ac": 7,
            "cs": "THY2010",
            "st": {
                "gr": 0,
                "as": 651
            },
            "co": [
                50.8228118,
                4.5613882,
                18474.65,
                0.31,
                -4.07,
                11.36
            ],
            "ve": [
                0.000003,
                1.1e-7,
                0.01175915,
                0,
                0,
                0
            ],
            "ti": 1762433925272.2065
        }
    ],
    "chatMessages": [
        {
            "uid": "4338763347782",
            "acid": 458448,
            "cs": "NameOfChatter",
            "rs": "r1",
            "msg": "The%20message."
        }
    ],
    "lastMsgId": 2062,
    "serverTime": 1762433925624
}
```