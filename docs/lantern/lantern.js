// The lantern: a door that asks who you are.
//
// The right name is never written here. We hash whatever you type and compare
// it with SEALED.check (from sealed.js), and the same name is the key that
// decrypts the page behind the door (SEALED.body).

(function () {
  'use strict';

  const TRAIL_KEY = 'm.trace';
  const prefersStillness = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  // ---------------------------------------------------------------------------
  // 1. The session token
  //
  // Every visitor gets a "session token" in the address bar. It looks like
  // gibberish, but it's a JWT: just base64-encoded JSON that anyone can read.
  // ---------------------------------------------------------------------------

  function base64url(text) {
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    sub: 'guest',
    door: 'lantern',
    expects: 'the name of whoever took the last photograph in the attic',
    iat: 1552533164, // 14 March 2019, 03:12:44 UTC
  };
  const token = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload)) + '.';

  if (!location.hash.startsWith('#session=')) {
    try {
      history.replaceState(null, '', location.pathname + location.search + '#session=' + token);
    } catch (err) {
      location.hash = 'session=' + token;
    }
  }


  // ---------------------------------------------------------------------------
  // 2. Hashing and unsealing
  // ---------------------------------------------------------------------------

  async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return new Uint8Array(digest);
  }

  function toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // "Mary-Ann!" and "maryann" should count as the same answer.
  function normalise(name) {
    return String(name).toLowerCase().replace(/[^a-z]/g, '');
  }

  async function isTheRightName(name) {
    return toHex(await sha256('lantern|' + name)) === SEALED.check;
  }

  // The sealed text is XORed with a keystream made of SHA-256 blocks:
  // sha256(key + "|0"), sha256(key + "|1"), ... 32 bytes at a time.
  async function unseal(name) {
    const key = toHex(await sha256('lantern-key|' + name));
    const sealed = Uint8Array.from(atob(SEALED.body), (char) => char.charCodeAt(0));
    const opened = new Uint8Array(sealed.length);

    for (let start = 0, block = 0; start < sealed.length; start += 32, block++) {
      const keystream = await sha256(key + '|' + block);
      for (let i = 0; i < 32 && start + i < sealed.length; i++) {
        opened[start + i] = sealed[start + i] ^ keystream[i];
      }
    }

    return JSON.parse(new TextDecoder().decode(opened));
  }


  // ---------------------------------------------------------------------------
  // 3. The door
  // ---------------------------------------------------------------------------

  const form = document.getElementById('f');
  const input = document.getElementById('who');
  const status = document.getElementById('status');

  let wrongGuesses = 0;
  let hideStatusTimer;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = normalise(input.value);
    if (!name) return;

    if (await isTheRightName(name)) {
      clearTimeout(hideStatusTimer); // otherwise an earlier "403" timer would flip the title back
      document.title = '200 OK';
      input.blur();
      reveal(await unseal(name));
    } else {
      refuse();
    }
  });

  // Each wrong answer gets a slightly bigger nudge than the last.
  function refuse() {
    wrongGuesses++;
    document.title = '403 Forbidden';

    if (wrongGuesses < 2) {
      status.textContent = '403';
    } else if (wrongGuesses < 4) {
      status.textContent = '403 · the lantern doesn’t know that name';
    } else {
      status.textContent = '403 · it only opens for whoever took the last photograph';
    }
    status.classList.add('on');

    clearTimeout(hideStatusTimer);
    hideStatusTimer = setTimeout(() => {
      status.classList.remove('on');
      document.title = 'lantern';
    }, wrongGuesses < 2 ? 2400 : 6000);

    input.select();
  }


  // ---------------------------------------------------------------------------
  // 4. What the page can see without asking
  // ---------------------------------------------------------------------------

  function escapeHtml(text) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return String(text).replace(/[&<>"]/g, (char) => entities[char]);
  }

  function twoDigits(n) {
    return String(n).padStart(2, '0');
  }

  function readTrail() {
    try {
      return JSON.parse(localStorage.getItem(TRAIL_KEY) || '[]');
    } catch (err) {
      return [];
    }
  }

  function describeScreen() {
    let text = screen.width + ' × ' + screen.height;
    if (window.devicePixelRatio > 1) {
      text += ', ' + Math.round(window.devicePixelRatio * 100) / 100 + ' pixels to the point';
    }
    return text;
  }

  function describeTimeSince(timestamp) {
    const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
    if (minutes === 1) return '1 minute ago';
    if (minutes < 90) return minutes + ' minutes ago';
    return Math.round(minutes / 60) + ' hours ago';
  }

  function describeTrail(trail) {
    const stops = trail.map((stop) => {
      const time = new Date(stop.t);
      return `<li>${escapeHtml(stop.p)} <span>${twoDigits(time.getHours())}:${twoDigits(time.getMinutes())}</span></li>`;
    });
    stops.push('<li><span>and the text files, which no page can see you read.</span></li>');
    return '<ul class="trail">' + stops.join('') + '</ul>';
  }

  // Returns [label, html] pairs. Everything here comes from the browser itself.
  function whatYouToldUs() {
    const facts = [];

    facts.push(['your browser', '<code>' + escapeHtml(navigator.userAgent) + '</code>']);

    try {
      facts.push(['your time zone', escapeHtml(Intl.DateTimeFormat().resolvedOptions().timeZone)]);
    } catch (err) { /* very old browsers */ }

    if (navigator.languages && navigator.languages.length) {
      facts.push(['your languages', escapeHtml(navigator.languages.join(', '))]);
    }

    facts.push(['your screen', describeScreen()]);

    if (navigator.hardwareConcurrency) {
      facts.push(['your machine', navigator.hardwareConcurrency + ' processor threads']);
    }

    const likesDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    facts.push(['you prefer', likesDark ? 'the dark' : 'the light']);

    const clock = new Date().toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' });
    facts.push(['your clock says', escapeHtml(clock)]);

    const trail = readTrail();
    if (trail.length) {
      facts.push(['you first arrived', describeTimeSince(trail[0].t)]);
      facts.push(['the way you came', describeTrail(trail)]);
    }

    return facts;
  }


  // ---------------------------------------------------------------------------
  // 5. The reveal
  // ---------------------------------------------------------------------------

  function paragraphs(lines) {
    return lines.map((line) => '<p>' + escapeHtml(line) + '</p>').join('');
  }

  function reveal(story) {
    const door = document.getElementById('door');
    const page = document.getElementById('reveal');
    const browser = navigator.userAgent;

    // The access log line m. found in 2019. The last part is filled in with your browser.
    const logLine = `-  -  [${story.logDate}]  "GET /lantern/ HTTP/1.1"  200  1204  "-"  `;

    page.innerHTML =
      `<p class="log-title shown">${escapeHtml(story.logTitle)}</p>` +
      '<pre class="log" id="log"></pre>' +
      paragraphs(story.before) +
      `<p class="bang">${escapeHtml(story.bang)}</p>` +
      `<p class="muted">${escapeHtml(story.dataTitle)}</p>` +
      '<dl>' + whatYouToldUs().map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('') + '</dl>' +
      paragraphs(story.after) +
      `<p class="sign">${escapeHtml(story.sign)}</p>` +
      `<p class="colophon">${story.colophon.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</p>` +
      '<p class="again"><a href="../" id="again">close the door</a></p>';

    const log = document.getElementById('log');
    const partsToShow = page.querySelectorAll('p:not(.log-title), dl');

    // Leaving through the door wipes the trail, so the next visit starts clean.
    document.getElementById('again').addEventListener('click', () => {
      try { localStorage.removeItem(TRAIL_KEY); } catch (err) { /* nothing to clean */ }
    });

    if (prefersStillness) {
      door.hidden = true;
      page.hidden = false;
      log.innerHTML = escapeHtml(logLine) + `<span class="ua">"${escapeHtml(browser)}"</span>`;
      partsToShow.forEach((part) => part.classList.add('shown'));
      return;
    }

    form.style.opacity = '0';
    setTimeout(() => {
      door.hidden = true;
      page.hidden = false;
      window.scrollTo(0, 0);
      typeLogLine(log, logLine, '"' + browser + '"', () => showOneByOne(partsToShow, 0));
    }, 1300);
  }

  // Types the log line out like a terminal: the start quickly,
  // your browser slowly, so you have time to recognise it.
  function typeLogLine(log, start, browserPart, whenDone) {
    const fullLine = start + browserPart;
    let typed = 0;

    log.innerHTML = '<span class="caret"></span>';

    function typeNextChunk() {
      const stillOnStart = typed < start.length;
      typed = Math.min(fullLine.length, typed + (stillOnStart ? 2 : 1));

      const startSoFar = fullLine.slice(0, Math.min(typed, start.length));
      const browserSoFar = fullLine.slice(start.length, typed);
      log.innerHTML =
        escapeHtml(startSoFar) +
        (browserSoFar ? `<span class="ua" style="background:transparent">${escapeHtml(browserSoFar)}</span>` : '') +
        '<span class="caret"></span>';

      if (typed < fullLine.length) {
        setTimeout(typeNextChunk, typed < start.length ? 18 : 34);
        return;
      }

      // Done typing: drop the caret and highlight the browser.
      setTimeout(() => {
        log.querySelector('.caret').remove();
        log.querySelector('.ua').style.background = '';
        whenDone();
      }, 900);
    }

    setTimeout(typeNextChunk, 900);
  }

  // Fades each part in after the last, pausing longer on the parts that matter.
  function showOneByOne(parts, index) {
    if (index >= parts.length) return;

    const part = parts[index];
    const isGreeting = part.classList.contains('bang');
    const isFactList = part.tagName === 'DL';

    part.classList.add('shown');
    if (isGreeting || isFactList) {
      part.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    let pause;
    if (isGreeting) pause = 3400;
    else if (isFactList) pause = 4200;
    else pause = Math.min(4200, 1400 + part.textContent.length * 22); // longer text, longer read

    setTimeout(() => showOneByOne(parts, index + 1), pause);
  }
})();
