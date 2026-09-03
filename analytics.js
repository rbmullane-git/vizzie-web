/**
 * Analytics for www.vizzie.org.
 *
 * The point of this file is the JOIN. The studio on app.vizzie.org has been
 * instrumented since the beta opened; this site had nothing at all, so every
 * visitor arrived as a stranger and every sign-up appeared out of thin air with
 * no idea what brought them. Search and advertising both point here, which meant
 * the entire acquisition half of the funnel was dark.
 *
 * Two things make www and app one funnel rather than two:
 *
 *  1. The same PostHog project key as the studio. Different projects cannot be
 *     joined after the fact at any price.
 *  2. `cross_subdomain_cookie` with cookie persistence, which scopes PostHog's
 *     id cookie to `.vizzie.org`. The anonymous id minted here is the one the
 *     studio picks up, so reading the homepage and signing up an hour later is
 *     one person with one history — not two anonymous sessions.
 *
 * The key is a public, write-only ingest key; it is meant to ship in the page.
 *
 * Session replay is deliberately NOT enabled here. It runs in the studio, where
 * the privacy policy describes it and where watching someone get stuck is worth
 * something. On a static marketing page it would buy little and would widen what
 * we record beyond what the policy sets out.
 *
 * Deployment note: this is plain ES5 with no build step, because the site is
 * static HTML served straight from GitHub Pages. Portal and brand pages are
 * generated — the <script> tag lives in tools/render-portal.mjs and
 * tools/build-brand.mjs so a rebuild keeps it.
 */
(function () {
  var POSTHOG_KEY = 'phc_vbkeMYHZqN4TuYg4gPySwfhy5eAPG67syeLcokFPgpvW';
  var POSTHOG_HOST = 'https://us.i.posthog.com';

  /* ---------------------------------------------------------------------
   * First-touch attribution.
   *
   * Mirrors src/lib/attribution.ts in the studio repo — same cookie name,
   * same shape, same first-touch-wins rule. It is duplicated rather than
   * shared because this site has no bundler and adding one to serve thirty
   * lines is a worse trade. If you change the shape, change both.
   * ------------------------------------------------------------------- */
  var ATTR_COOKIE = 'vizzie_attr';
  var ATTR_MAX_AGE_DAYS = 90;
  var PARAM_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
  ];

  function cookieDomain() {
    var host = location.hostname;
    return host === 'vizzie.org' || /\.vizzie\.org$/.test(host)
      ? '.vizzie.org'
      : null;
  }

  function readAttribution() {
    try {
      var m = document.cookie.match(
        new RegExp('(?:^|; )' + ATTR_COOKIE + '=([^;]*)'),
      );
      return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    } catch (e) {
      return null;
    }
  }

  function captureAttribution() {
    try {
      // First touch wins: someone who arrives from an ad, leaves, and comes
      // back via Google is still the ad's. Overwriting here would quietly turn
      // this into last-touch attribution.
      if (readAttribution()) return;

      var params = new URLSearchParams(location.search);
      var record = {};
      var found = false;
      for (var i = 0; i < PARAM_KEYS.length; i++) {
        var v = params.get(PARAM_KEYS[i]);
        if (v) {
          record[PARAM_KEYS[i]] = v.slice(0, 200);
          found = true;
        }
      }

      // Our own pages are internal navigation, not an acquisition source.
      if (document.referrer) {
        try {
          var refHost = new URL(document.referrer).hostname;
          if (!/(^|\.)vizzie\.org$/.test(refHost)) {
            record.referrer = document.referrer.slice(0, 200);
            found = true;
          }
        } catch (e) {
          /* unparseable referrer — ignore */
        }
      }

      // Only write when the visit actually carries acquisition information,
      // otherwise the first direct visit would claim the cookie and the ad
      // click that follows would find it already taken.
      if (!found) return;

      record.landing_page = location.pathname;
      record.first_seen_at = new Date().toISOString();

      var domain = cookieDomain();
      document.cookie =
        ATTR_COOKIE +
        '=' +
        encodeURIComponent(JSON.stringify(record)) +
        '; path=/; max-age=' +
        ATTR_MAX_AGE_DAYS * 24 * 60 * 60 +
        '; SameSite=Lax' +
        (domain ? '; domain=' + domain : '') +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {
      // Cookies blocked. The visit is simply unattributed; nothing else breaks.
    }
  }

  function attributionProperties() {
    var record = readAttribution();
    var out = {};
    if (!record) return out;
    for (var k in record) {
      if (Object.prototype.hasOwnProperty.call(record, k)) {
        out['first_touch_' + k] = record[k];
      }
    }
    return out;
  }

  // Record before PostHog initialises, so the very first $pageview of a paid
  // click already carries the campaign that paid for it.
  captureAttribution();

  /* --- PostHog loader (the vendor snippet, unmodified) ----------------- */
  !(function (t, e) {
    var o, n, p, r;
    e.__SV ||
      ((window.posthog = e),
      (e._i = []),
      (e.init = function (i, s, a) {
        function g(t, e) {
          var o = e.split('.');
          2 == o.length && ((t = t[o[0]]), (e = o[1])),
            (t[e] = function () {
              t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
            });
        }
        ((p = t.createElement('script')).type = 'text/javascript'),
          (p.crossOrigin = 'anonymous'),
          (p.async = !0),
          (p.src =
            s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') +
            '/static/array.js'),
          (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(
            p,
            r,
          );
        var u = e;
        for (
          void 0 !== a ? (u = e[a] = []) : (a = 'posthog'),
            u.people = u.people || [],
            u.toString = function (t) {
              var e = 'posthog';
              return (
                'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e
              );
            },
            u.people.toString = function () {
              return u.toString(1) + '.people (stub)';
            },
            o =
              'init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'.split(
                ' ',
              ),
            n = 0;
          n < o.length;
          n++
        )
          g(u, o[n]);
        e._i.push([i, s, a]);
      }),
      (e.__SV = 1));
  })(document, window.posthog || []);

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // A static multi-page site, so PostHog's automatic pageview is exactly
    // right — the opposite of the studio, where it fires once and then never.
    capture_pageview: true,
    autocapture: true,
    // Errors belong to Sentry. One processor holding stack traces, not two.
    capture_exceptions: false,
    // No replay here — see the note at the top of this file.
    disable_session_recording: true,
    respect_dnt: true,
    // The two settings that make www and app one person. See the header.
    persistence: 'localStorage+cookie',
    cross_subdomain_cookie: true,
    loaded: function (ph) {
      // Attach the campaign to every event from this browser, so a sign-up in
      // the studio an hour from now still knows which ad paid for it.
      ph.register(attributionProperties());
    },
  });

  /* --- The one interaction that matters on this site ------------------- */
  // Every Sign up / Log in / example link points at app.vizzie.org, so this is
  // the handover point between the two hosts. Autocapture would record the
  // click as an anonymous DOM event; naming it makes "visits → clicked through
  // → signed up" a funnel you can actually read.
  document.addEventListener(
    'click',
    function (event) {
      var el = event.target && event.target.closest;
      if (!el) return;
      var link = event.target.closest('[data-app]');
      if (!link) return;
      posthog.capture('app_cta_clicked', {
        destination: link.getAttribute('data-app') || '/',
        link_text: (link.textContent || '').trim().slice(0, 80),
        page: location.pathname,
      });
    },
    true,
  );
})();
