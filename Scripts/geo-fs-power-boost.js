// ==UserScript==
// @name         GeoFS Engine Power
// @namespace    http://tampermonkey.net/
// @version      2025-10-05
// @description  Give your engines a boost. Press Y to change. Use the Flight Info Display script to see the mode you're in.
// @author       Natrium
// @match        https://geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=geo-fs.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let changeModeKey = "y"; // The key to press to see/hide the info.
    let engineMode = parseInt(localStorage.getItem("engineMode") ?? 0, 10);
    let normalRpm;
    let engineModes;

    function setEngineModes() {
        // Check the aircraft anytime, as it can be changed while flying.
        let aircraftId = geofs?.aircraft?.instance?.id ?? '27';
        normalRpm = aircraftId == '12' ? 6000 : 10000;
        engineModes =
            [
                { "name": "Normal", "maxRpm": normalRpm },
                { "name": "Boost", "maxRpm": normalRpm * 1.5 },
                { "name": "Overdrive", "maxRpm": normalRpm * 2.5 },
                { "name": "Warp", "maxRpm": normalRpm * 5 },
            ];
    }

    function changeEngineMode(mode) {
        setEngineModes();
        engineMode = mode;
        localStorage.setItem("engineNormalRpm", normalRpm);
        localStorage.setItem("engineMode", engineMode);
        localStorage.setItem("engineModeName", engineModes[mode].name);

        geofs.aircraft.instance.definition.maxRPM = engineModes[mode].maxRpm;
    }

    window.addEventListener("keyup", function (e) {
        if (e.key == changeModeKey) {
            engineMode++;
            engineMode = engineMode % engineModes.length;

            changeEngineMode(engineMode);
        }
    });

    changeEngineMode(engineMode);
})();