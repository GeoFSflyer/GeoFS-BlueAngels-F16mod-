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