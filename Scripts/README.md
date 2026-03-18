// Speak chat test
const utterance = new SpeechSynthesisUtterance("Hello this is a test.");
utterance.lang = "en-US"; // or "nl-NL" for Dutch
speechSynthesis.speak(utterance);


// Standaard 500, voor minder lag.
geofs.MPSMinUpdateDelay = 100

// Send message in chat
window.multiplayer.setChatMessage("Test");

// Update met +1 elke keer als er een nieuwe chat is ontvangen
window.multiplayer.chatMessageId

// Go a bit down in cockpit view, so the fpv aligns with 0
geofs.camera.modes[1].position[2] = 1

// Check: is in cockpit view
geofs.camera.currentDefinition.name == 'cockpit'
geofs.camera.currentDefinition.insideView == true


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

// Set opacity of instruments
instruments.setOpacity(0.9)

// FLAPS zelf precies besturen // BIJ MAN. terug zetten naar 0
controls.flaps.positionTarget = 0.1;
controls.setPartAnimationDelta(controls.flaps);

/*
Flaps and Slats
There are three positions that the pilot can select for the flaps and slats.

AUTO: flaps and slats operate independently and asymmetrically based on many factors such as angle of attack, g-load and Mach-number. On high-g maneuvers the flaps and slats deflect down to increase lift. This decreases the turn radius. Slats deflect automatically at high angles of attack to increase the stall margin.

HALF: flaps and slats deflect down to the half way position, depending on airspeed. Above 250kts they stay up. Below 250kts they gradually extend as speed decreases to maximize lift. The half position is selected for takeoff or approach.

FULL: flaps and slats can deflect to the full position, again depending on airspeed. This position is selected for landing.
*/


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
















// Definitions
// Nose cam looking back
geofs.camera.definitions.nosecam =
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

geofs.camera.definitions.cockpitrear =
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

geofs.camera.definitions.wingman =
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

geofs.camera.definitions.rear =
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







// Explanation

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










geo-fs doet elke x ms een request naar https://mps.geo-fs.com/update?l=4. Daarin zitten chatMessages

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
        },
        {
            "id": "4338563070605",
            "acid": 913603,
            "ac": 24,
            "cs": "OO-LAU",
            "st": {
                "gr": 1,
                "as": 0,
                "lv": "2"
            },
            "co": [
                51.166148,
                5.4655171,
                54.87,
                50.68,
                0.01,
                0.15
            ],
            "ve": [
                0,
                0,
                -0.00002592,
                0,
                0,
                0
            ],
            "ti": 1762433925338.8145
        },
        {
            "id": "4339147230124",
            "acid": 1498757,
            "ac": 5193,
            "cs": "DLH364",
            "st": {
                "gr": 0,
                "as": 527,
                "lv": 10001
            },
            "co": [
                51.0257086,
                4.2860397,
                10363.06,
                -65.7,
                -2.5,
                0.07
            ],
            "ve": [
                0.00000103,
                -0.00000352,
                0.00001959,
                0,
                0,
                0
            ],
            "ti": 1762433917867.3506
        },
        {
            "id": "4331581242194",
            "acid": null,
            "ac": 25,
            "cs": "Foo",
            "st": {
                "gr": 0,
                "as": 373,
                "lv": "0"
            },
            "co": [
                51.7766412,
                4.9090215,
                6261.9,
                169.22,
                -2.56,
                0
            ],
            "ve": [
                -0.00000169,
                5.2e-7,
                0.00389392,
                0,
                0,
                0
            ],
            "ti": 1762433925057.9087
        }
    ],
    "chatMessages": [
        {
            "uid": "4338763347782",
            "acid": 458448,
            "cs": "DR-IA[furry][trans]",
            "rs": "r1",
            "msg": "how%20the%20hell%20do%20you%20get%20banned%20from%20discord"
        }
    ],
    "lastMsgId": 2062,
    "serverTime": 1762433925624
}


// HUD F-18 benaderen
const hudOpts =
  geofs.aircraft.instance.definition
    .parts[87]
    .object3d
    ._parent
    ._children[83]
    ._children[0]
    ._options;

Render hud:
geofs.aircraft.instance.definition.parts[87].object3d._parent._children[83]._children[0].render()

// Verander positie:
geofs.aircraft.instance.definition.parts[87].object3d._parent._children[83]._children[0]._initialPosition = [100, 100, 100]

Gevolgd door render().

// Locatie van HUD
geofs.aircraft.instance.definition.parts[87].object3d._parent._children[83]._children[0].htr

// PFD

instruments.renderers = {
    PFDBoeing(e) {
        let t = exponentialSmoothing("smoothKias", geofs.animation.getValue("kias"), .1)
          , a = [893, 980]
          , o = .25;
        a = V2.parseInt(V2.scale(a, o));
        let n = e.canvasAPI.context;
        e.canvasAPI.clear("#000000"),
        e.canvasAPI.drawRotatedSprite({
            image: e.images.attitude,
            origin: [0, 0],
            size: [350, 1400],
            center: [175, 700],
            destination: a,
            rotation: geofs.animation.getValue("aroll") * DEGREES_TO_RAD,
            translation: [0, 5 * geofs.animation.getValue("atilt")]
        }),
        e.canvasAPI.drawRotatedSprite({
            image: e.images.overlays,
            origin: [245, 56],
            size: [23, 21],
            center: [11, 120],
            destination: a,
            rotation: geofs.animation.getValue("aroll") * DEGREES_TO_RAD,
            translation: [0, 0]
        }),
        n.drawImage(e.images.background, 0, 0),
        n.fillStyle = "#00ff08",
        n.textAlign = "center",
        n.font = "18px sans-serif";
        let r = ""
          , s = ""
          , c = "";
        geofs.autopilot.on && (r = "SPD",
        "NAV" == geofs.autopilot.mode ? (s = "LNAV",
        c = geofs.autopilot.VNAV ? "V/S" : "ALT") : (s = "HDG SEL",
        c = "ALT")),
        n.fillText(r, 133, 20),
        n.fillText(s, 230, 20),
        n.fillText(c, 325, 20),
        n.fillStyle = "#ffffff",
        n.textAlign = "center",
        n.font = "14px sans-serif";
        let d = ""
          , u = "";
        "GPS" == geofs.animation.getValue("NAVMODE") && (d = "GPS"),
        "NAV" == geofs.animation.getValue("NAVMODE") && (d = "VOR/LOC"),
        geofs.autopilot.VNAV && (u = "G/S"),
        n.fillText(d, 230, 33),
        n.fillText(u, 325, 33),
        2500 >= geofs.animation.getValue("haglFeet") && (n.fillStyle = "#ffffff",
        n.textAlign = "right",
        n.font = "bold 20px sans-serif",
        n.fillText(Math.floor(geofs.animation.getValue("haglFeet")), 350, 95)),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [101, 0],
            size: [13, 20],
            center: [6, 10],
            destination: [355, a[1]],
            translation: [0, clamp(-107 * geofs.animation.getValue("NAVGlideAngleDeviation"), -75, 75)]
        }),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [114, 0],
            size: [20, 13],
            center: [10, 6],
            destination: [a[0], 390],
            translation: [clamp(6.5 * geofs.animation.getValue("NAVCourseDeviation"), -75, 75), 0]
        }),
        e.canvasAPI.drawRotatedSprite({
            image: e.images.overlays,
            origin: [101, 101],
            size: [310, 310],
            center: [155, 155],
            destination: [a[0], 602],
            rotation: -geofs.animation.getValue("heading") * DEGREES_TO_RAD
        }),
        e.canvasAPI.drawRotatedSprite({
            image: e.images.overlays,
            origin: [243, 88],
            size: [26, 13],
            center: [12, 165],
            destination: [a[0], 602],
            rotation: (-geofs.animation.getValue("heading") + geofs.autopilot.values.course) * DEGREES_TO_RAD
        }),
        n.lineWidth = 2,
        n.fillStyle = "#FFFFFF",
        n.strokeStyle = "#FFFFFF",
        n.textAlign = "right",
        n.font = "22px sans-serif",
        n.save(),
        n.beginPath(),
        n.rect(11, 60, 90, 381),
        n.rect(5, 210, 50, 70),
        n.clip("evenodd"),
        e.drawGrads(e.canvasAPI, {
            position: [64, 60],
            zero: [0, 190],
            size: [90, 380],
            orientation: "y",
            direction: -1,
            value: t,
            interval: 10,
            pixelRatio: 3.16,
            pattern: [[{
                length: 10,
                legend: !0,
                legendOffset: {
                    x: -8,
                    y: 7
                }
            }], [{
                length: 10
            }]],
            sprites: [{
                image: e.images.overlays,
                origin: [134, 0],
                size: [31, 19],
                center: [5, 10],
                value: geofs.autopilot.values.speed,
                clamp: !0
            }]
        }),
        n.restore(),
        n.save(),
        n.beginPath(),
        n.rect(365, 60, 84, 381),
        n.rect(400, 210, 65, 70),
        n.clip("evenodd"),
        n.font = "16px sans-serif",
        e.drawGrads(e.canvasAPI, {
            position: [385, 60],
            zero: [0, 190],
            size: [84, 380],
            orientation: "y",
            direction: -1,
            value: geofs.animation.getValue("altitude"),
            interval: 100,
            pixelRatio: .475,
            pattern: [[{
                length: 10,
                legend: !0,
                legendOffset: {
                    x: 60,
                    y: 7
                }
            }], [{
                length: 10
            }]],
            sprites: [{
                image: e.images.overlays,
                origin: [223, 0],
                size: [33, 56],
                center: [5, 28],
                value: geofs.autopilot.values.altitude,
                clamp: !0
            }, {
                image: e.images.overlays,
                origin: [256, 0],
                size: [64, 25],
                center: [2, 0],
                value: geofs.animation.getValue("groundElevationFeet")
            }]
        }),
        n.restore(),
        n.save(),
        n.beginPath(),
        n.rect(7, 220, 48, 50),
        n.rect(404, 220, 65, 50),
        n.rect(475, 116, 28, 262),
        n.clip(),
        n.beginPath(),
        n.lineWidth = 3,
        n.strokeStyle = "#FFFFFF";
        let p = clamp(35 * Math.log(Math.abs(geofs.animation.getValue("verticalSpeed") / 1e3)) + 60, 0, 125) * Math.sign(geofs.animation.getValue("verticalSpeed"));
        n.moveTo(530, a[1]),
        n.lineTo(482, a[1] - p),
        n.stroke(),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [166, 0],
            size: [13, 5],
            center: [0, 2],
            destination: [480, a[1]],
            translation: [0, -clamp(35 * Math.log(Math.abs(geofs.autopilot.values.verticalSpeed / 1e3)) + 60, 0, 125) * Math.sign(geofs.autopilot.values.verticalSpeed)]
        }),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [0, 0],
            size: [16, 512],
            center: [0, 512],
            destination: [8, 256],
            translation: [0, 48 * geofs.utils.stickyRounding(t % 1e3 * .01, .01)]
        }),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [0, 0],
            size: [16, 512],
            center: [0, 512],
            destination: [24, 256],
            translation: [0, 48 * geofs.utils.stickyRounding(t % 100 * .1, .1)]
        }),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [16, 0],
            size: [16, 512],
            center: [0, 487],
            destination: [40, 256],
            translation: [0, t % 10 * 25]
        }),
        geofs.animation.getValue("altTenThousands") > 9999 ? e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [0, 0],
            sprite: [16, 512],
            size: [14, 512],
            center: [0, 512],
            destination: [406, 256],
            translation: [0, 48 * geofs.utils.stickyRounding(1e-4 * geofs.animation.getValue("altTenThousands"), .01)]
        }) : e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [70, 490],
            size: [16, 21],
            center: [0, 21],
            destination: [406, 256],
            translation: [0, 0]
        }),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [0, 0],
            sprite: [16, 512],
            size: [14, 512],
            center: [0, 512],
            destination: [420, 256],
            translation: [0, 48 * geofs.utils.stickyRounding(.001 * geofs.animation.getValue("altThousands"), .01)]
        }),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [32, 0],
            size: [12, 512],
            center: [0, 512],
            destination: [434, 253],
            translation: [0, 40 * geofs.utils.stickyRounding(.01 * geofs.animation.getValue("altHundreds"), .1)]
        }),
        e.canvasAPI.drawSprite({
            image: e.images.overlays,
            origin: [44, 0],
            size: [24, 512],
            center: [0, 496],
            destination: [445, 256],
            translation: [0, .8 * geofs.animation.getValue("altTens")]
        }),
        n.restore()
    },