// Keeps a small diary of the pages you visit, so the lantern can read it back to you.
// It lives only in your browser's localStorage. Nothing is sent anywhere.
//
// Each entry is { p: path, t: timestamp }.

(function () {
  'use strict';

  const TRAIL_KEY = 'm.trace';
  const MAX_ENTRIES = 60;

  try {
    const trail = JSON.parse(localStorage.getItem(TRAIL_KEY) || '[]');
    const path = location.pathname.replace(/index\.html$/, ''); // "/notes/index.html" → "/notes/"

    const lastVisit = trail[trail.length - 1];
    if (!lastVisit || lastVisit.p !== path) {
      trail.push({ p: path, t: Date.now() }); // don't log the same page twice in a row (e.g. a refresh)
    }

    localStorage.setItem(TRAIL_KEY, JSON.stringify(trail.slice(-MAX_ENTRIES)));
  } catch (err) {
    // Private browsing or storage turned off: the site still works, the diary just stays empty.
  }
})();
