/*
 * Beamwall video kit — shared DOM builders + backdrop choreography for every
 * composition in this studio. Deterministic by construction: seeded PRNG,
 * no clocks, no network. Exposes a single global: window.BW.
 */
(function () {
  "use strict";

  var HUES = [
    { name: "blue", css: "#5b8cff", rgb: "91,140,255" },
    { name: "teal", css: "#22d3ee", rgb: "34,211,238" },
    { name: "orange", css: "#fb923c", rgb: "251,146,60" },
    { name: "green", css: "#34d399", rgb: "52,211,153" },
    { name: "magenta", css: "#e879f9", rgb: "232,121,249" },
    { name: "violet", css: "#7c6cf7", rgb: "124,108,247" },
    { name: "cyan", css: "#38bdf8", rgb: "56,189,248" },
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Backdrop: bg gradient, 7 beams, seeded stars, floor line, flash, vignette.
   * Prefix namespaces every id so multiple comps can share the kit. */
  function buildBackdrop(root, prefix, opts) {
    opts = opts || {};
    var bg = document.createElement("div");
    bg.className = "bw-bg";
    bg.id = prefix + "-bg";
    root.appendChild(bg);

    HUES.forEach(function (h, i) {
      var b = document.createElement("div");
      b.className = "bw-beam";
      b.id = prefix + "-beam-" + h.name;
      b.style.left = ((i + 0.5) / 7) * 100 + "%";
      b.style.marginLeft = "-45px";
      b.style.background =
        "linear-gradient(to top, rgba(" + h.rgb + ",0.5), rgba(" + h.rgb + ",0.10) 55%, transparent)";
      root.appendChild(b);
    });

    var starCount = opts.stars == null ? 42 : opts.stars;
    var rand = mulberry32(0xbea311);
    for (var s = 0; s < starCount; s++) {
      var st = document.createElement("i");
      st.className = "bw-star";
      st.id = prefix + "-star-" + s;
      var size = 2 + rand() * 3.5;
      st.style.width = size + "px";
      st.style.height = size + "px";
      st.style.left = rand() * 100 + "%";
      st.style.top = rand() * 72 + "%";
      st.style.background = HUES[s % 7].css;
      root.appendChild(st);
    }

    var floor = document.createElement("div");
    floor.className = "bw-floor";
    floor.id = prefix + "-floor";
    root.appendChild(floor);

    var flash = document.createElement("div");
    flash.className = "bw-flash";
    flash.id = prefix + "-flash";
    root.appendChild(flash);

    var vig = document.createElement("div");
    vig.className = "bw-vignette";
    root.appendChild(vig);
  }

  /* Animate the backdrop across [0, end]: beams rise + sway, stars twinkle,
   * floor fades in, everything dims slightly at the very end (loop-friendly). */
  function animateBackdrop(tl, prefix, end, starCount) {
    starCount = starCount == null ? 42 : starCount;
    HUES.forEach(function (h, i) {
      tl.fromTo(
        "#" + prefix + "-beam-" + h.name,
        { scaleY: 0.2, opacity: 0 },
        { scaleY: 1, opacity: 0.5, duration: 1.6, ease: "power2.out" },
        0.15 + i * 0.09
      );
      tl.to(
        "#" + prefix + "-beam-" + h.name,
        { x: (i % 2 === 0 ? 1 : -1) * 26, duration: end / 2, ease: "sine.inOut", yoyo: true, repeat: 1 },
        1.6
      );
    });
    var srand = mulberry32(0x5eed);
    for (var k = 0; k < starCount; k++) {
      var peak = 0.35 + srand() * 0.5;
      var t0 = srand() * Math.max(1, end - 2.5);
      tl.fromTo("#" + prefix + "-star-" + k, { opacity: 0 }, { opacity: peak, duration: 0.5, ease: "sine.inOut" }, t0);
      tl.to("#" + prefix + "-star-" + k, { opacity: 0.08, duration: 0.9, ease: "sine.inOut" }, t0 + 0.6);
    }
    tl.fromTo("#" + prefix + "-floor", { opacity: 0 }, { opacity: 0.55, duration: 1.2 }, 0.4);
  }

  /* Camera-flash pop at time t. */
  function flashAt(tl, prefix, t, strength) {
    strength = strength == null ? 1 : strength;
    tl.fromTo("#" + prefix + "-flash", { opacity: 0 }, { opacity: strength, duration: 0.14, ease: "power4.in" }, t);
    tl.to("#" + prefix + "-flash", { opacity: 0, duration: 0.8, ease: "power2.out" }, t + 0.16);
  }

  /* Gradient-stroked line icon (BeamIcons ports). name: booth|wall|trophy|card|spark */
  function icon(name, hexColor, size) {
    size = size || 64;
    var gid = "bwgrad-" + name + "-" + hexColor.replace("#", "");
    var defs =
      '<defs><linearGradient id="' + gid + '" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="' + hexColor + '"/><stop offset="1" stop-color="#eef3ff"/></linearGradient></defs>';
    var body = "";
    if (name === "booth")
      body =
        '<rect x="4.5" y="8" width="23" height="17" rx="4.5"/><path d="M11.5 8l1.6-2.6a1.6 1.6 0 0 1 1.36-.76h3.08a1.6 1.6 0 0 1 1.36.76L20.5 8"/><circle cx="16" cy="16.5" r="4.6"/>';
    if (name === "wall")
      body =
        '<rect x="4" y="5" width="10.5" height="13" rx="2.2"/><rect x="17.5" y="9" width="10.5" height="13" rx="2.2"/><rect x="7.5" y="21" width="10.5" height="6.5" rx="2.2"/>';
    if (name === "trophy")
      body =
        '<path d="M10.5 7h11v6.2a5.5 5.5 0 0 1-11 0z"/><path d="M10.5 8.6H7.2c0 3.1 1.4 5 3.6 5.6M21.5 8.6h3.3c0 3.1-1.4 5-3.6 5.6"/><path d="M16 18.7v3.6M12 25.6h8M13.5 22.3h5"/>';
    if (name === "card")
      body =
        '<path d="M5.5 11.5L16 7l10.5 4.5v13a2.5 2.5 0 0 1-2.5 2.5H8a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M5.5 12l10.5 6.5L26.5 12"/>';
    if (name === "spark")
      body = '<path d="M16 4l2.2 7.8L26 14l-7.8 2.2L16 24l-2.2-7.8L6 14l7.8-2.2z"/>';
    return (
      '<svg viewBox="0 0 32 32" width="' + size + '" height="' + size + '" fill="none" stroke="url(#' + gid +
      ')" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + defs + body + "</svg>"
    );
  }

  /* Phone chrome. Returns {el, screen}. Size via width; 9:19.5 body. */
  function phone(id, width) {
    var el = document.createElement("div");
    el.className = "bw-phone";
    el.id = id;
    el.style.width = width + "px";
    el.style.height = Math.round(width * 2.05) + "px";
    var screen = document.createElement("div");
    screen.className = "screen";
    el.appendChild(screen);
    var notch = document.createElement("div");
    notch.className = "notch";
    el.appendChild(notch);
    return { el: el, screen: screen };
  }

  /* Glowing gallery frame. Returns the element; caller appends content. */
  function frame(id, hue, w, h) {
    var el = document.createElement("div");
    el.className = "bw-frame";
    el.id = id;
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.border = "2px solid rgba(" + hue.rgb + ",0.65)";
    el.style.boxShadow =
      "0 0 46px -8px rgba(" + hue.rgb + ",0.65), inset 0 0 60px -14px rgba(" + hue.rgb + ",0.4)";
    var sheen = document.createElement("div");
    sheen.className = "sheen";
    el.appendChild(sheen);
    return el;
  }

  /* Register the composition's paused timeline under its id. */
  function register(id, tl) {
    window.__timelines = window.__timelines || {};
    window.__timelines[id] = tl;
  }

  window.BW = {
    HUES: HUES,
    hue: function (name) {
      for (var i = 0; i < HUES.length; i++) if (HUES[i].name === name) return HUES[i];
      return HUES[0];
    },
    mulberry32: mulberry32,
    buildBackdrop: buildBackdrop,
    animateBackdrop: animateBackdrop,
    flashAt: flashAt,
    icon: icon,
    phone: phone,
    frame: frame,
    register: register,
  };
})();
