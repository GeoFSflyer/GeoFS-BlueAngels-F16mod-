# GeoFS Developer Docs
GeoFS does not have much plugin documentation, so this is a practical beginner guide for writing your own Tampermonkey scripts.

The examples below are based on what I've learned while building the F-18 addon in this repository.

---

## 1) Your first Tampermonkey script

Use this as a safe starter template:

```js
// ==UserScript==
// @name         GeoFS My First Addon
// @namespace    https://www.geo-fs.com/
// @version      0.1.0
// @description  My first GeoFS script
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @match        https://*.geo-fs.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  console.log('[MyAddon] Loaded');
})();
```

## 2) Wait for GeoFS objects to be ready

GeoFS loads a lot after page load. Do not assume objects are immediately available.

```js
const POLL_MS = 400;
const MAX_TRIES = 150;

let tries = 0;
const timer = setInterval(() => {
  tries += 1;

  const ready = Boolean(window.geofs?.aircraft?.instance && window.controls);
  if (ready) {
    clearInterval(timer);
    console.log('[MyAddon] GeoFS ready');
    return;
  }

  if (tries >= MAX_TRIES) {
    clearInterval(timer);
    console.warn('[MyAddon] GeoFS not ready in time');
  }
}, POLL_MS);
```

Tip: use optional chaining (`?.`) in addon code if the object might not be available yet.

## 3) Running logic every frame (safely)

For continuous updates, use frame callbacks or small intervals.

```js
const callbackId = geofs.api.addFrameCallback(() => {
  // Keep logic lightweight here.
});

// Later: remove callback if your script supports unload.
// geofs.api.removeFrameCallback(callbackId);
```

Best practice: keep per-frame logic minimal and cache lookups when possible.

## 4) Animating parts on your airplane.
Some basic controls can be easily adjusted via the `controls` object in GeoFS:

```js
controls.airbrakes.position = 0.5 // Airbrakes out halfway.
```

But other controls (like the flaps), you can't control directly, because GeoFS constantly sets the value it needs to animate to, thus overwriting your `controls.flaps.position = 1`. Luckily you can set the target it needs to animate to, and execute the animation:

```js
controls.flaps.positionTarget = 0.5; // Position 0.5 out of 2 (controls.flaps.maxPosition).
controls.setPartAnimationDelta(controls.flaps);
```

Then there are parts that are not primary flight controls, but you would like to animate. Luckily you can access all GeoFS parts of your aircraft in `geofs?.aircraft.instance.parts`. When you execute this in console, you'll see a list of parts for your aircraft.
When you open a part, you can see some have an animation tied to it:

![Flap animation](../Images/scripts/flap-animation.png)

But as GeoFS sets the values for these animations, you can't overwrite them (as they get reset every frame to the value GeoFS wants). So if you want to animate a specific part, you'll have to add your own animation to the array.

Here is a little demo script to show how to add your own animation to an aircraft part, and set it with every frame.

```js
  let partName = 'tailHook'; // <-- Modify with the name of your part.
  let part = geofs?.aircraft?.instance?.parts?.[partName];

  part.animations = part.animations || [];
    part.animations.push({
      name: partName + 'RotXDeg',
      type: 'rotate',
      axis: 'X',
      value: partName + 'RotXDeg', // custom animation key
      rotationMethod: part.object3d.setRotationX.bind(part.object3d)
    });

  // Example: set the value of the airhook based on the throttle position. Silly, but just for testing ;).
  geofs.api.addFrameCallback(() => {
    const throttlePosition = controls?.throttle || 0;
    geofs.animation.setValue(partName + 'RotXDeg', throttlePosition * 270);
  });
```

Additionally, the 3D model can contain parts that the developer didnt' include in `geofs.aircraft.instance.parts` (like the Fuel probe in the F-18). But they are available in the 3D model, which you can find here `geofs?.aircraft.instance.parts['root'].object3d._children` or here `geofs?.aircraft.instance.object3d._children`. You can also access the part (called a node in CesiumJS) like this: `geofs?.aircraft.instance.object3d.model._model.getNode('Probe')`

With below script you can search for any part (even those who are not in geofs.aircraft.instance.parts), and add your custom animations to it, so you can animate anypart in any direction:

```js
(() => {
  const partName = 'Probe'; // aanpassen indien nodig

  const ac = geofs.aircraft.instance;
  const model = ac.object3d.model._model;

  const findNodeNameLoose = (wanted) => {
    const tries = [wanted, wanted.toLowerCase(), wanted.toUpperCase()];
    for (const n of tries) {
      try {
        const node = model.getNode(n);
        if (node) return String(node.name || node._name || node.id || wanted);
      } catch {}
    }
    return null;
  };

  const realNodeName = findNodeNameLoose(partName);
  if (!realNodeName) throw new Error(`Node niet gevonden: ${partName}`);

  // Part ophalen of toevoegen
  let part = ac.parts?.[partName];

  if (!part) {
    const partDef = {
      name: partName,
      node: realNodeName,
      parent: 'root',
      animations: []
    };

    ac.definition.parts = Array.isArray(ac.definition.parts) ? ac.definition.parts : [];
    if (!ac.definition.parts.some(p => String(p?.name) === partName)) {
      ac.definition.parts.push(partDef);
    }

    ac.addParts([partDef], ac.aircraftRecord?.fullPath, ac.definition?.scale || 1, ac.definition?.orientation);
    part = ac.parts?.[partName];
  }

  if (!part?.object3d) throw new Error(`Part/object3d niet beschikbaar: ${partName}`);

  part.animations = Array.isArray(part.animations) ? part.animations : [];

  const addRotAnim = (axis) => {
    const animKey = `${partName}Rot${axis}Deg`;
    if (part.animations.some(a => a?.name === animKey)) return;

    const method = part.object3d[`rotate${axis}`];
    if (typeof method !== 'function') {
      console.warn(`rotate${axis} niet beschikbaar op object3d`);
      return;
    }

    part.animations.push({
      name: animKey,
      type: 'rotate',
      axis: axis,
      value: animKey,
      rotationMethod: method
    });
  };

  addRotAnim('X');
  addRotAnim('Y');
  addRotAnim('Z');

  console.log(`OK: part=${partName}, node=${realNodeName}, anims X/Y/Z added`);
})();
```

Now if your part is called 'Probe', you can animate it on the X, Y and Z axis like this:

```js
geofs.animation.setValue('ProbeRotXDeg', -40);
geofs.animation.setValue('ProbeRotYDeg', 10);
geofs.animation.setValue('ProbeRotZDeg', 20);
```

## 5) HUD basics

HUD rendering can be overridden by replacing renderer functions (advanced).

From our addon, a safer strategy is:
- keep reference to original renderer
- install custom renderer only when target aircraft is active
- restore original renderer when disabling your module

This prevents breaking HUD rendering when switching aircraft.

## 6) Local settings (plugin options)

Use `localStorage` for persistent options and normalize keys.

```js
const STORAGE_KEY = 'MyAddonOptions';

function normalizeToken(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildKey(page, key) {
  return `${normalizeToken(page)}.${normalizeToken(key)}`;
}
```

This keeps keys consistent and predictable.

---

## 7) Extending the F18 addon from your own script

If `window.F18Addon` is present, you can extend features without editing core code.

## 8) Checklist

Before shipping your script:

1. Guard GeoFS access with `?.` and readiness checks when the plugin is still initializing.
2. Keep intervals/frame callbacks lightweight.
3. Use clear storage keys.
4. Avoid hard crashes (`try/catch` around optional integrations).
5. Clean up anything you install (handlers, callbacks, render overrides).

## 9) Useful console snippets

```js
// Current aircraft id
geofs?.aircraft?.instance?.id

// All known parts
Object.keys(geofs?.aircraft?.instance?.parts || {})

// Current camera mode
geofs?.camera?.currentModeName

// Animation values (live)
geofs?.animation?.values

// Speak chat test
const utterance = new SpeechSynthesisUtterance("Hello this is a test.");
utterance.lang = "en-US"; // or "nl-NL" for Dutch
speechSynthesis.speak(utterance);

// Standaard 500, the number of ms in between updates.
geofs.MPSMinUpdateDelay = 1000

// Send message in chat.
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

```js
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

```js
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

If you are new: start with one small feature (for example one button or one animated part), test it, then expand.# GeoFS Developer Docs
GeoFS lacks some documentation on how to write good plugins for it. That's why I'm sharing what I've learned here.

## 10) Changing the HUD
```js
// Access the F-18 HUD (which is the genericHUD):
const hudOpts =
  geofs.aircraft.instance.definition
    .parts[87]
    .object3d
    ._parent
    ._children[83]
    ._children[0]
    ._options;

// Call this to rerender the HUD:
geofs.aircraft.instance.definition.parts[87].object3d._parent._children[83]._children[0].render()

// Example: change the position of the HUD:
geofs.aircraft.instance.definition.parts[87].object3d._parent._children[83]._children[0]._initialPosition = [100, 100, 100]
// Call render to render the change.

// Get the location of the HUD:
geofs.aircraft.instance.definition.parts[87].object3d._parent._children[83]._children[0].htr

## 11) Multiplayer
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
