// ==UserScript==
// @name         GeoFS F-18 Flightplan
// @namespace    https://www.geo-fs.com/
// @version      0.1.0
// @description  Add your own flight plans and procedures for the F-18.
// @match        https://www.geo-fs.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const POLL_MS = 500;
  const MAX_TRIES = 120; // 60s

  function customizeF18Checklist(api) {
    // 1) Add a checklist.
    api.addChecklist({
      type: 'OPS',
      title: 'MyAF Procedures',
      items: [
        'State date/time/loc on login',
        'State type of mission',
      ],
      completed: false
    });

    // 2) Edit an existing checklist (fe. overwrite the IFF Codebook with your own codes).
    const proc = api.getChecklists('OPS');
    const iffChecklist = Array.isArray(proc)
      ? proc.find((c) => String(c?.title || '').toLowerCase() === 'iff codebook')
      : null;

    if (iffChecklist) {
      iffChecklist.title = 'IFF Codebook (MyAF)'; // Change the title.
      iffChecklist.items = ['Say \'IFF [CS] - Code [NO.]\'', 'Respond with \'IFF [Code]\'', '┌─────────────────────┐', '│  01: 749 │  02: 225 │ ', '│  03: 516 │  04: 837 │ ', '│  05: 501 │  06: 480 │ ', '│  07: 384 │  08: 784 │ ', '│  09: 216 │  10: 402 │ ', '│  11: 827 │  12: 314 │ ', '│  13: 482 │  14: 878 │ ', '└─────────────────────┘'];
    }
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;

    // Check if the F18Addon checklist API is available already.
    const api = window.F18Addon?.checklists;
    if (!api) {
      if (tries >= MAX_TRIES) {
        clearInterval(timer);
        console.warn('[F18 Checklist Demo] F18Addon.checklists not found.');
      }
      return;
    }

    clearInterval(timer);
    customizeF18Checklist(api);
  }, POLL_MS);
})();
