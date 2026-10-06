(() => {
  "use strict";

  /*
   * ============================================================
   * NORTH ASSEMBLY
   * Optimized unified animation system
   * ============================================================
   *
   * Main goals:
   * - One global requestAnimationFrame
   * - Pause expensive effects when hidden / off-screen
   * - Cache geometry where possible
   * - Avoid setInterval for animation
   * - Avoid unnecessary layout reads
   * - Limit canvas DPR
   * - Keep existing visual effects
   * ============================================================
   */

  const DPR_LIMIT = 1.5;
  const TWO_PI = Math.PI * 2;

  const prefersReducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let pageVisible = !document.hidden;
  let animationRunning = false;
  let rafId = 0;
  let lastFrameTime = performance.now();

  const pointer = {
    x: -9999,
    y: -9999,
    previousX: -9999,
    previousY: -9999,
    speed: 0,
    targetSpeed: 0
  };

  const pointerSmooth = {
    x: -9999,
    y: -9999
  };

  /*
   * ============================================================
   * GLOBAL HELPERS
   * ============================================================
   */

  function getDPR() {
    return Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function now() {
    return performance.now();
  }

  function isActuallyVisible(el) {
    const rect = el.getBoundingClientRect();

    return (
      rect.bottom >= -100 &&
      rect.top <= window.innerHeight + 100 &&
      rect.right >= -100 &&
      rect.left <= window.innerWidth + 100
    );
  }

  /*
   * ============================================================
   * GLOBAL INTERSECTION OBSERVER
   * ============================================================
   */

  const visibilityMap = new WeakMap();

  const visibilityObserver = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        visibilityMap.set(entry.target, entry.isIntersecting);
      }
    },
    {
      root: null,
      rootMargin: "150px",
      threshold: 0
    }
  );

  function observeVisibility(el) {
    if (!el) return;
    visibilityMap.set(el, false);
    visibilityObserver.observe(el);
  }

  function isVisible(el) {
    return visibilityMap.get(el) === true;
  }

  /*
   * ============================================================
   * POINTER
   * ============================================================
   */

  document.addEventListener(
    "mousemove",
    event => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;

      pointer.targetSpeed = Math.hypot(
        pointer.x - pointer.previousX,
        pointer.y - pointer.previousY
      );

      pointer.previousX = pointer.x;
      pointer.previousY = pointer.y;
    },
    { passive: true }
  );

  document.addEventListener(
    "mouseleave",
    () => {
      pointer.x = -9999;
      pointer.y = -9999;
      pointer.targetSpeed = 0;
    },
    { passive: true }
  );

  /*
   * ============================================================
   * CUSTOM CURSOR
   * ============================================================
   */

  const cursor = document.getElementById("cursor");
  const cursorTrail = document.getElementById("cursor-trail");

  let cursorHover = false;

  const hoverTargets = document.querySelectorAll(
    "a, button, .btn, .team-card"
  );

  function setCursorHover(value) {
    if (cursorHover === value) return;

    cursorHover = value;

    cursor?.classList.toggle("hovering", value);
    cursorTrail?.classList.toggle("hovering", value);
  }

  hoverTargets.forEach(element => {
    element.addEventListener(
      "mouseenter",
      () => setCursorHover(true),
      { passive: true }
    );

    element.addEventListener(
      "mouseleave",
      () => setCursorHover(false),
      { passive: true }
    );
  });

  function updateCursor() {
    if (!cursor || !cursorTrail) return;

    if (pointer.x < -1000 || pointer.y < -1000) {
      return;
    }

    pointerSmooth.x = lerp(pointerSmooth.x, pointer.x, 0.35);
    pointerSmooth.y = lerp(pointerSmooth.y, pointer.y, 0.35);

    cursor.style.transform =
      `translate3d(${pointer.x}px, ${pointer.y}px, 0) translate(-50%, -50%)`;

    cursorTrail.style.transform =
      `translate3d(${pointerSmooth.x}px, ${pointerSmooth.y}px, 0) translate(-50%, -50%)`;
  }

  /*
   * ============================================================
   * DOT FIELD
   * ============================================================
   */

  const dotFieldContainer = document.getElementById("dotfield");

  const dotField = {
    canvas: null,
    ctx: null,

    width: 0,
    height: 0,

    dpr: 1,

    dots: [],

    gradient: null,

    glowElement: null,

    engagement: 0,

    active: true,

    dirty: true,

    settings: {
      dotRadius: 1.5,
      dotSpacing: 14,
      cursorRadius: 500,
      bulgeStrength: 67,

      gradientFrom: "rgba(168, 85, 247, 0.35)",
      gradientTo: "rgba(180, 151, 207, 0.25)"
    }
  };

  function initDotField() {
    if (!dotFieldContainer) return;

    dotField.canvas = document.createElement("canvas");
    dotField.canvas.setAttribute("aria-hidden", "true");

    dotField.ctx = dotField.canvas.getContext("2d", {
      alpha: true,
      desynchronized: true
    });

    if (!dotField.ctx) return;

    dotFieldContainer.appendChild(dotField.canvas);

    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );

    svg.style.cssText = `
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
      pointer-events:none;
    `;

    const glowId =
      "dot-field-glow-" +
      Math.random().toString(36).slice(2, 9);

    svg.innerHTML = `
      <defs>
        <radialGradient id="${glowId}">
          <stop
            offset="0%"
            stop-color="#120F17"
          />
          <stop
            offset="100%"
            stop-color="transparent"
          />
        </radialGradient>
      </defs>

      <circle
        cx="-9999"
        cy="-9999"
        r="160"
        fill="url(#${glowId})"
        style="opacity:0"
      />
    `;

    dotFieldContainer.appendChild(svg);

    dotField.glowElement = svg.querySelector("circle");

    resizeDotField();

    observeVisibility(dotFieldContainer);
  }

  function resizeDotField() {
    if (!dotField.canvas || !dotField.ctx) return;

    const rect = dotFieldContainer.getBoundingClientRect();

    dotField.width = Math.max(1, rect.width);
    dotField.height = Math.max(1, rect.height);
    dotField.dpr = getDPR();

    dotField.canvas.width =
      Math.floor(dotField.width * dotField.dpr);

    dotField.canvas.height =
      Math.floor(dotField.height * dotField.dpr);

    dotField.canvas.style.width =
      `${dotField.width}px`;

    dotField.canvas.style.height =
      `${dotField.height}px`;

    dotField.ctx.setTransform(
      dotField.dpr,
      0,
      0,
      dotField.dpr,
      0,
      0
    );

    dotField.gradient =
      dotField.ctx.createLinearGradient(
        0,
        0,
        dotField.width,
        dotField.height
      );

    dotField.gradient.addColorStop(
      0,
      dotField.settings.gradientFrom
    );

    dotField.gradient.addColorStop(
      1,
      dotField.settings.gradientTo
    );

    buildDotFieldDots();

    dotField.dirty = true;
  }

  function buildDotFieldDots() {
    const {
      dotRadius,
      dotSpacing
    } = dotField.settings;

    const step = dotRadius + dotSpacing;

    const columns = Math.ceil(
      dotField.width / step
    );

    const rows = Math.ceil(
      dotField.height / step
    );

    const total =
      columns * rows;

    const dots = new Array(total);

    const offsetX =
      (dotField.width - columns * step) * 0.5;

    const offsetY =
      (dotField.height - rows * step) * 0.5;

    let index = 0;

    for (let row = 0; row < rows; row++) {
      const y =
        offsetY +
        row * step +
        step * 0.5;

      for (let col = 0; col < columns; col++) {
        const x =
          offsetX +
          col * step +
          step * 0.5;

        dots[index++] = {
          ax: x,
          ay: y,

          sx: x,
          sy: y
        };
      }
    }

    dotField.dots = dots;
  }

  function updatePointerSpeed(delta) {
    const instantSpeed = pointer.targetSpeed;

    pointer.speed = lerp(
      pointer.speed,
      instantSpeed,
      clamp(delta * 15, 0, 1)
    );

    pointer.targetSpeed *=
      Math.pow(0.001, delta);

    if (pointer.speed < 0.01) {
      pointer.speed = 0;
    }
  }

  function renderDotField() {
    if (
      !dotField.canvas ||
      !dotField.ctx ||
      !dotField.dirty
    ) {
      return;
    }

    const ctx = dotField.ctx;

    const {
      dotRadius,
      cursorRadius,
      bulgeStrength
    } = dotField.settings;

    const {
      width,
      height,
      gradient,
      dots
    } = dotField;

    const engagementTarget =
      clamp(pointer.speed / 5, 0, 1);

    dotField.engagement =
      lerp(
        dotField.engagement,
        engagementTarget,
        0.08
      );

    const engagement =
      dotField.engagement;

    if (
      engagement < 0.001 &&
      pointer.x < -1000
    ) {
      if (!dotField.dirty) return;
    }

    if (dotField.glowElement) {
      dotField.glowElement.setAttribute(
        "cx",
        pointer.x
      );

      dotField.glowElement.setAttribute(
        "cy",
        pointer.y
      );

      dotField.glowElement.style.opacity =
        String(engagement);
    }

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    ctx.fillStyle = gradient;

    const radiusSquared =
      cursorRadius *
      cursorRadius;

    const drawRadius =
      dotRadius * 0.5;

    ctx.beginPath();

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];

      const dx =
        pointer.x - dot.ax;

      const dy =
        pointer.y - dot.ay;

      const distanceSquared =
        dx * dx +
        dy * dy;

      if (
        distanceSquared < radiusSquared &&
        engagement > 0.01
      ) {
        const distance =
          Math.sqrt(distanceSquared);

        const normalized =
          1 -
          distance / cursorRadius;

        const influence =
          normalized *
          normalized *
          bulgeStrength *
          engagement;

        const angle =
          Math.atan2(dy, dx);

        const targetX =
          dot.ax -
          Math.cos(angle) *
            influence;

        const targetY =
          dot.ay -
          Math.sin(angle) *
            influence;

        dot.sx =
          lerp(
            dot.sx,
            targetX,
            0.15
          );

        dot.sy =
          lerp(
            dot.sy,
            targetY,
            0.15
          );
      } else {
        dot.sx =
          lerp(
            dot.sx,
            dot.ax,
            0.1
          );

        dot.sy =
          lerp(
            dot.sy,
            dot.ay,
            0.1
          );
      }

      ctx.moveTo(
        dot.sx + drawRadius,
        dot.sy
      );

      ctx.arc(
        dot.sx,
        dot.sy,
        drawRadius,
        0,
        TWO_PI
      );
    }

    ctx.fill();

    if (
      engagement < 0.001 &&
      Math.abs(
        pointer.x - pointer.previousX
      ) < 0.1
    ) {
      dotField.dirty = false;
    }
  }

  /*
   * ============================================================
   * HERO PROXIMITY TEXT
   * ============================================================
   */

  const heroContainer =
    document.getElementById(
      "hero-proximity"
    );

  const heroProximity = {
    element: heroContainer,

    letters: [],

    text:
      "We got bored and we decided to make these things.",

    radius: 120,

    active: false,

    mouseX: -9999,

    mouseY: -9999,

    rect: null,

    positions: []
  };

  function parseFontSettings(settings) {
    return new Map(
      settings
        .split(",")
        .map(value => value.trim())
        .map(value => {
          const [axis, amount] =
            value.split(" ");

          return [
            axis.replace(/['"]/g, ""),
            parseFloat(amount)
          ];
        })
    );
  }

  function initHeroProximity() {
    if (!heroContainer) return;

    const fromSettings =
      "'wght' 400, 'opsz' 9";

    const toSettings =
      "'wght' 1000, 'opsz' 40";

    const fromMap =
      parseFontSettings(
        fromSettings
      );

    const toMap =
      parseFontSettings(
        toSettings
      );

    const axes =
      Array.from(
        fromMap.entries()
      ).map(
        ([axis, fromValue]) => ({
          axis,
          fromValue,
          toValue:
            toMap.get(axis) ??
            fromValue
        })
      );

    const words =
      heroProximity.text.split(" ");

    const letters = [];

    words.forEach(
      (word, wordIndex) => {
        const wordElement =
          document.createElement("span");

        wordElement.className =
          "proximity-word";

        for (const char of word) {
          const letter =
            document.createElement("span");

          letter.className =
            "proximity-letter";

          letter.textContent =
            char;

          letter.setAttribute(
            "aria-hidden",
            "true"
          );

          wordElement.appendChild(letter);

          letters.push({
            element: letter,
            axisSettings: axes,
            fromSettings,
            current: -1
          });
        }

        heroContainer.appendChild(
          wordElement
        );

        if (
          wordIndex <
          words.length - 1
        ) {
          const space =
            document.createElement("span");

          space.className =
            "proximity-word";

          space.innerHTML =
            "&nbsp;";

          heroContainer.appendChild(
            space
          );
        }
      }
    );

    const srOnly =
      document.createElement("span");

    srOnly.className =
      "proximity-sr-only";

    srOnly.textContent =
      heroProximity.text;

    heroContainer.appendChild(
      srOnly
    );

    heroProximity.letters =
      letters;

    heroContainer.addEventListener(
      "mousemove",
      event => {
        const rect =
          heroContainer.getBoundingClientRect();

        heroProximity.mouseX =
          event.clientX -
          rect.left;

        heroProximity.mouseY =
          event.clientY -
          rect.top;

        heroProximity.active = true;
      },
      { passive: true }
    );

    heroContainer.addEventListener(
      "mouseleave",
      () => {
        heroProximity.active = false;

        for (
          const item of
          heroProximity.letters
        ) {
          if (
            item.current !== 0
          ) {
            item.element.style
              .fontVariationSettings =
              item.fromSettings;

            item.current = 0;
          }
        }
      },
      { passive: true }
    );

    heroProximity.rect =
      heroContainer.getBoundingClientRect();

    cacheHeroLetterPositions();
  }

  function cacheHeroLetterPositions() {
    if (!heroContainer) return;

    heroProximity.rect =
      heroContainer.getBoundingClientRect();

    const rect =
      heroProximity.rect;

    heroProximity.positions =
      heroProximity.letters.map(
        item => {
          const bounds =
            item.element.getBoundingClientRect();

          return {
            x:
              bounds.left +
              bounds.width * 0.5 -
              rect.left,

            y:
              bounds.top +
              bounds.height * 0.5 -
              rect.top
          };
        }
      );
  }

  function renderHeroProximity() {
    if (
      !heroContainer ||
      !heroProximity.active ||
      prefersReducedMotion
    ) {
      return;
    }

    if (
      !visibilityMap.has(heroContainer)
    ) {
      return;
    }

    const heroVisible =
      isVisible(heroContainer);

    if (!heroVisible) {
      return;
    }

    const radius =
      heroProximity.radius;

    const positions =
      heroProximity.positions;

    const letters =
      heroProximity.letters;

    for (
      let i = 0;
      i < letters.length;
      i++
    ) {
      const item =
        letters[i];

      const position =
        positions[i];

      if (!position) continue;

      const dx =
        heroProximity.mouseX -
        position.x;

      const dy =
        heroProximity.mouseY -
        position.y;

      const distance =
        Math.sqrt(
          dx * dx +
          dy * dy
        );

      if (distance >= radius) {
        if (item.current !== 0) {
          item.element.style
            .fontVariationSettings =
            item.fromSettings;

          item.current = 0;
        }

        continue;
      }

      const normalized =
        clamp(
          1 -
          distance / radius,
          0,
          1
        );

      const falloff =
        normalized *
        normalized;

      const settings =
        item.axisSettings
          .map(
            ({
              axis,
              fromValue,
              toValue
            }) => {
              const value =
                fromValue +
                (toValue -
                  fromValue) *
                falloff;

              return `'${axis}' ${value.toFixed(2)}`;
            }
          )
          .join(", ");

      /*
       * Avoid rewriting the same value.
       */
      if (
        item.current === falloff
      ) {
        continue;
      }

      item.element.style
        .fontVariationSettings =
        settings;

      item.current = falloff;
    }
  }

  /*
   * ============================================================
   * SCROLL REVEAL
   * ============================================================
   */

  const revealElements =
    document.querySelectorAll(
      ".scroll-reveal"
    );

  const revealObserver =
    new IntersectionObserver(
      entries => {
        for (
          const entry of
          entries
        ) {
          if (
            !entry.isIntersecting
          ) {
            continue;
          }

          entry.target.classList.add(
            "visible"
          );

          revealObserver.unobserve(
            entry.target
          );
        }
      },
      {
        threshold: 0.1,
        rootMargin: "0px 0px -40px 0px"
      }
    );

  revealElements.forEach(
    element => {
      revealObserver.observe(
        element
      );
    }
  );

  /*
   * ============================================================
   * STRETCH BUTTONS
   * ============================================================
   */

  const stretchButtons =
    document.querySelectorAll(
      ".btn-stretch"
    );

  const buttonState =
    new WeakMap();

  stretchButtons.forEach(button => {
    buttonState.set(
      button,
      {
        rect: null,
        x: 0,
        y: 0,
        dirty: false
      }
    );

    button.addEventListener(
      "mouseenter",
      () => {
        const state =
          buttonState.get(button);

        if (!state) return;

        state.rect =
          button.getBoundingClientRect();
      },
      { passive: true }
    );

    button.addEventListener(
      "mousemove",
      event => {
        const state =
          buttonState.get(button);

        if (!state) return;

        const rect =
          state.rect ||
          button.getBoundingClientRect();

        const cx =
          rect.width * 0.5;

        const cy =
          rect.height * 0.5;

        const x =
          event.clientX -
          rect.left;

        const y =
          event.clientY -
          rect.top;

        state.x =
          clamp(
            (x - cx) / cx,
            -1,
            1
          );

        state.y =
          clamp(
            (y - cy) / cy,
            -1,
            1
          );

        state.dirty = true;
      },
      { passive: true }
    );

    button.addEventListener(
      "mouseleave",
      () => {
        const state =
          buttonState.get(button);

        if (!state) return;

        state.x = 0;
        state.y = 0;
        state.dirty = true;
        state.rect = null;
      },
      { passive: true }
    );
  });

  function renderButtons() {
    for (
      const button of
      stretchButtons
    ) {
      const state =
        buttonState.get(button);

      if (
        !state ||
        !state.dirty
      ) {
        continue;
      }

      const dx = state.x;
      const dy = state.y;

      const scaleX =
        1 +
        Math.abs(dx) *
          0.35;

      const scaleY =
        1 -
        Math.abs(dy) *
          0.15;

      const skewX =
        dx * 4;

      button.style.transform =
        `scaleX(${scaleX}) scaleY(${scaleY}) skewX(${skewX}deg)`;

      state.dirty = false;
    }
  }

  /*
   * ============================================================
   * PROJECT RIPPLE
   * ============================================================
   */

  const projects =
    document.querySelectorAll(
      ".project"
    );

  projects.forEach(project => {
    project.addEventListener(
      "mouseenter",
      () => {
        const ripple =
          document.createElement("div");

        ripple.style.cssText = `
          position:absolute;
          top:50%;
          left:50%;
          width:0;
          height:0;
          border-radius:50%;
          background:rgba(168,85,247,0.1);
          transform:translate(-50%,-50%);
          pointer-events:none;
          opacity:1;
        `;

        project.appendChild(
          ripple
        );

        requestAnimationFrame(
          () => {
            ripple.style.transition =
              "width .6s ease, height .6s ease, opacity .6s ease";

            ripple.style.width =
              "300px";

            ripple.style.height =
              "300px";

            ripple.style.opacity =
              "0";
          }
        );

        window.setTimeout(
          () => ripple.remove(),
          700
        );
      },
      { passive: true }
    );
  });

  /*
   * ============================================================
   * ELECTRIC BORDERS
   * ============================================================
   */

  const electricBorders =
    [];

  function randomNoiseValue(x) {
    const value =
      Math.sin(
        x * 12.9898
      ) *
      43758.5453;

    return (
      value -
      Math.floor(value)
    );
  }

  function noise2D(x, y) {
    const ix =
      Math.floor(x);

    const iy =
      Math.floor(y);

    const fx =
      x - ix;

    const fy =
      y - iy;

    const a =
      randomNoiseValue(
        ix + iy * 57
      );

    const b =
      randomNoiseValue(
        ix +
        1 +
        iy * 57
      );

    const c =
      randomNoiseValue(
        ix +
        (iy + 1) *
          57
      );

    const d =
      randomNoiseValue(
        ix +
        1 +
        (iy + 1) *
          57
      );

    const ux =
      fx * fx *
      (3 - 2 * fx);

    const uy =
      fy * fy *
      (3 - 2 * fy);

    return (
      a *
        (1 - ux) *
        (1 - uy) +

      b *
        ux *
        (1 - uy) +

      c *
        (1 - ux) *
        uy +

      d *
        ux *
        uy
    );
  }

  function octavedNoise(
    x,
    time,
    seed,
    chaos
  ) {
    /*
     * Reduced from 10 octaves to 5.
     * Visually still noisy but significantly cheaper.
     */
    const octaves = 5;

    const lacunarity = 1.6;
    const gain = 0.7;

    let result = 0;
    let amplitude = chaos;
    let frequency = 10;

    for (
      let i = 0;
      i < octaves;
      i++
    ) {
      result +=
        amplitude *
        noise2D(
          frequency *
            x +
            seed *
              100,

          time *
            frequency *
            0.3
        );

      frequency *=
        lacunarity;

      amplitude *=
        gain;
    }

    return result;
  }

  function getCornerPoint(
    cx,
    cy,
    radius,
    startAngle,
    arcLength,
    progress
  ) {
    const angle =
      startAngle +
      progress *
        arcLength;

    return {
      x:
        cx +
        radius *
          Math.cos(angle),

      y:
        cy +
        radius *
          Math.sin(angle)
    };
  }

  function getRoundedRectPoint(
    t,
    left,
    top,
    width,
    height,
    radius
  ) {
    const straightWidth =
      Math.max(
        0,
        width -
          2 *
            radius
      );

    const straightHeight =
      Math.max(
        0,
        height -
          2 *
            radius
      );

    const cornerArc =
      Math.PI *
      radius *
      0.5;

    const perimeter =
      2 *
        straightWidth +
      2 *
        straightHeight +
      4 *
        cornerArc;

    let distance =
      t *
      perimeter;

    let accumulated =
      0;

    if (
      distance <=
      accumulated +
        straightWidth
    ) {
      const p =
        (distance -
          accumulated) /
        Math.max(
          straightWidth,
          0.0001
        );

      return {
        x:
          left +
          radius +
          p *
            straightWidth,

        y: top
      };
    }

    accumulated +=
      straightWidth;

    if (
      distance <=
      accumulated +
        cornerArc
    ) {
      const p =
        (distance -
          accumulated) /
        Math.max(
          cornerArc,
          0.0001
        );

      return getCornerPoint(
        left +
          width -
          radius,

        top +
          radius,

        radius,

        -Math.PI / 2,

        Math.PI / 2,

        p
      );
    }

    accumulated +=
      cornerArc;

    if (
      distance <=
      accumulated +
        straightHeight
    ) {
      const p =
        (distance -
          accumulated) /
        Math.max(
          straightHeight,
          0.0001
        );

      return {
        x:
          left +
          width,

        y:
          top +
          radius +
          p *
            straightHeight
      };
    }

    accumulated +=
      straightHeight;

    if (
      distance <=
      accumulated +
        cornerArc
    ) {
      const p =
        (distance -
          accumulated) /
        Math.max(
          cornerArc,
          0.0001
        );

      return getCornerPoint(
        left +
          width -
          radius,

        top +
          height -
          radius,

        radius,

        0,

        Math.PI / 2,

        p
      );
    }

    accumulated +=
      cornerArc;

    if (
      distance <=
      accumulated +
        straightWidth
    ) {
      const p =
        (distance -
          accumulated) /
        Math.max(
          straightWidth,
          0.0001
        );

      return {
        x:
          left +
          width -
          radius -
          p *
            straightWidth,

        y:
          top +
          height
      };
    }

    accumulated +=
      straightWidth;

    if (
      distance <=
      accumulated +
        cornerArc
    ) {
      const p =
        (distance -
          accumulated) /
        Math.max(
          cornerArc,
          0.0001
        );

      return getCornerPoint(
        left +
          radius,

        top +
          height -
          radius,

        radius,

        Math.PI / 2,

        Math.PI / 2,

        p
      );
    }

    accumulated +=
      cornerArc;

    if (
      distance <=
      accumulated +
        straightHeight
    ) {
      const p =
        (distance -
          accumulated) /
        Math.max(
          straightHeight,
          0.0001
        );

      return {
        x: left,

        y:
          top +
          height -
          radius -
          p *
            straightHeight
      };
    }

    accumulated +=
      straightHeight;

    const p =
      (distance -
        accumulated) /
      Math.max(
        cornerArc,
        0.0001
      );

    return getCornerPoint(
      left +
        radius,

      top +
        radius,

      radius,

      Math.PI,

      Math.PI / 2,

      p
    );
  }

  function initElectricBorder(
    container
  ) {
    const canvas =
      container.querySelector(
        ".eb-canvas"
      );

    if (!canvas) return;

    const ctx =
      canvas.getContext(
        "2d",
        {
          alpha: true,
          desynchronized: true
        }
      );

    if (!ctx) return;

    const color =
      container.dataset.color ||
      "#5227FF";

    const speed =
      parseFloat(
        container.dataset.speed
      ) || 1;

    const chaos =
      parseFloat(
        container.dataset.chaos
      ) || 0.12;

    const borderRadius =
      parseFloat(
        container.dataset.borderRadius
      ) || 24;

    const borderOffset = 60;
    const displacement = 60;

    const border = {
      container,
      canvas,
      ctx,

      color,
      speed,
      chaos,
      borderRadius,

      width: 0,
      height: 0,

      dpr: 1,

      sampleCount: 0,

      geometry: [],

      time: 0,

      active: false,

      initialized: false
    };

    container.style.setProperty(
      "--electric-border-color",
      color
    );

    function resize() {
      const rect =
        container.getBoundingClientRect();

      border.width =
        rect.width +
        borderOffset *
          2;

      border.height =
        rect.height +
        borderOffset *
          2;

      border.dpr =
        getDPR();

      canvas.width =
        Math.floor(
          border.width *
            border.dpr
        );

      canvas.height =
        Math.floor(
          border.height *
            border.dpr
        );

      canvas.style.width =
        `${border.width}px`;

      canvas.style.height =
        `${border.height}px`;

      ctx.setTransform(
        border.dpr,
        0,
        0,
        border.dpr,
        0,
        0
      );

      const left =
        borderOffset;

      const top =
        borderOffset;

      const width =
        border.width -
        borderOffset *
          2;

      const height =
        border.height -
        borderOffset *
          2;

      const radius =
        Math.min(
          borderRadius,
          width * 0.5,
          height * 0.5
        );

      const perimeter =
        2 *
          (width +
            height) +
        2 *
          Math.PI *
          radius;

      /*
       * Previously this was approximately
       * perimeter / 2.
       *
       * This version uses fewer points.
       */
      border.sampleCount =
        Math.max(
          80,
          Math.floor(
            perimeter / 3
          )
        );

      const geometry =
        new Array(
          border.sampleCount
        );

      for (
        let i = 0;
        i < border.sampleCount;
        i++
      ) {
        const progress =
          i /
          (border.sampleCount - 1);

        geometry[i] =
          getRoundedRectPoint(
            progress,
            left,
            top,
            width,
            height,
            radius
          );
      }

      border.geometry =
        geometry;

      border.initialized = true;
    }

    resize();

    border.resize =
      resize;

    electricBorders.push(
      border
    );

    observeVisibility(
      container
    );
  }

  document
    .querySelectorAll(
      ".electric-border"
    )
    .forEach(
      initElectricBorder
    );

  function renderElectricBorders(
    delta
  ) {
    for (
      const border of
      electricBorders
    ) {
      if (
        !border.initialized
      ) {
        continue;
      }

      const visible =
        isVisible(
          border.container
        );

      if (!visible) {
        continue;
      }

      border.time +=
        delta *
        border.speed;

      const {
        ctx,
        canvas,
        width,
        height,
        dpr,
        geometry,
        sampleCount,
        color,
        chaos
      } = border;

      /*
       * Reset transform to prevent
       * accumulation.
       */
      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );

      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      ctx.strokeStyle =
        color;

      ctx.lineWidth = 2;

      ctx.lineCap =
        "round";

      ctx.lineJoin =
        "round";

      ctx.beginPath();

      /*
       * Instead of recalculating rounded rectangle
       * geometry every frame, only noise is calculated.
       */
      for (
        let i = 0;
        i < sampleCount;
        i++
      ) {
        const progress =
          i /
          (sampleCount - 1);

        const point =
          geometry[i];

        const noiseX =
          octavedNoise(
            progress * 8,
            border.time,
            0,
            chaos
          );

        const noiseY =
          octavedNoise(
            progress * 8,
            border.time,
            1,
            chaos
          );

        const x =
          point.x +
          noiseX *
            displacement;

        const y =
          point.y +
          noiseY *
            displacement;

        if (i === 0) {
          ctx.moveTo(
            x,
            y
          );
        } else {
          ctx.lineTo(
            x,
            y
          );
        }
      }

      ctx.closePath();
      ctx.stroke();
    }
  }

  /*
   * ============================================================
   * GRADUAL BLUR
   * ============================================================
   */

  function createGradualBlur(
    element,
    options = {}
  ) {
    if (!element) return;

    const {
      position = "bottom",
      strength = 2,
      height = "8rem",
      divCount = 5,
      curve = "bezier",
      exponential = true,
      opacity = 1
    } = options;

    const curves = {
      linear: p => p,

      bezier: p =>
        p *
        p *
        (3 -
          2 * p),

      "ease-in": p =>
        p * p,

      "ease-out": p =>
        1 -
        Math.pow(
          1 - p,
          2
        )
    };

    const curveFunction =
      curves[curve] ||
      curves.linear;

    const directions = {
      top: "to top",
      bottom: "to bottom",
      left: "to left",
      right: "to right"
    };

    const direction =
      directions[position] ||
      directions.bottom;

    element.style.height =
      height;

    element.innerHTML = "";

    const inner =
      document.createElement(
        "div"
      );

    inner.className =
      "gradual-blur-inner";

    inner.style.cssText = `
      position:relative;
      width:100%;
      height:100%;
    `;

    const increment =
      100 /
      divCount;

    for (
      let i = 1;
      i <= divCount;
      i++
    ) {
      const progress =
        curveFunction(
          i /
          divCount
        );

      const blurValue =
        exponential
          ? Math.pow(
              2,
              progress * 4
            ) *
            0.0625 *
            strength
          : 0.0625 *
            (
              progress *
                divCount +
              1
            ) *
            strength;

      const p1 =
        (
          increment *
            i -
          increment
        ).toFixed(1);

      const p2 =
        (
          increment *
          i
        ).toFixed(1);

      const p3 =
        (
          increment *
            i +
          increment
        ).toFixed(1);

      const p4 =
        (
          increment *
            i +
          increment * 2
        ).toFixed(1);

      let gradient =
        `transparent ${p1}%, black ${p2}%`;

      if (
        Number(p3) <= 100
      ) {
        gradient +=
          `, black ${p3}%`;
      }

      if (
        Number(p4) <= 100
      ) {
        gradient +=
          `, transparent ${p4}%`;
      }

      const layer =
        document.createElement(
          "div"
        );

      layer.style.cssText = `
        position:absolute;
        inset:0;
        mask-image:linear-gradient(
          ${direction},
          ${gradient}
        );
        -webkit-mask-image:linear-gradient(
          ${direction},
          ${gradient}
        );
        backdrop-filter:blur(
          ${blurValue.toFixed(3)}rem
        );
        -webkit-backdrop-filter:blur(
          ${blurValue.toFixed(3)}rem
        );
        opacity:${opacity};
        pointer-events:none;
      `;

      inner.appendChild(
        layer
      );
    }

    element.appendChild(
      inner
    );

    requestAnimationFrame(
      () =>
        element.classList.add(
          "visible"
        )
    );
  }

  createGradualBlur(
    document.getElementById(
      "blur-bottom"
    ),
    {
      position: "bottom",
      strength: 2,
      height: "8rem",
      divCount: 5,
      curve: "bezier",
      exponential: true,
      opacity: 1
    }
  );

  /*
   * ============================================================
   * MATRIX RAIN
   * ============================================================
   *
   * Optional.
   * Only activated if the corresponding HTML exists.
   * ============================================================
   */

  const matrixCanvas =
    document.querySelector(
      ".theme-monix .matrix-canvas"
    );

  const matrixRain = {
    canvas: matrixCanvas,
    ctx: null,

    width: 0,
    height: 0,

    dpr: 1,

    columns: 0,

    drops: [],

    fontSize: 14,

    characters:
      "アイウエオカキクケコサシスセソタチツテト0123456789",

    container: null
  };

  function initMatrixRain() {
    if (!matrixCanvas) return;

    matrixRain.ctx =
      matrixCanvas.getContext(
        "2d",
        {
          alpha: true,
          desynchronized: true
        }
      );

    if (!matrixRain.ctx) return;

    matrixRain.container =
      matrixCanvas.parentElement;

    observeVisibility(
      matrixRain.container
    );

    resizeMatrixRain();
  }

  function resizeMatrixRain() {
    if (
      !matrixRain.canvas ||
      !matrixRain.ctx
    ) {
      return;
    }

    const rect =
      matrixRain.container.getBoundingClientRect();

    matrixRain.width =
      Math.max(
        1,
        rect.width
      );

    matrixRain.height =
      Math.max(
        1,
        rect.height
      );

    matrixRain.dpr =
      getDPR();

    matrixRain.canvas.width =
      Math.floor(
        matrixRain.width *
          matrixRain.dpr
      );

    matrixRain.canvas.height =
      Math.floor(
        matrixRain.height *
          matrixRain.dpr
      );

    matrixRain.canvas.style.width =
      `${matrixRain.width}px`;

    matrixRain.canvas.style.height =
      `${matrixRain.height}px`;

    matrixRain.ctx.setTransform(
      matrixRain.dpr,
      0,
      0,
      matrixRain.dpr,
      0,
      0
    );

    matrixRain.columns =
      Math.ceil(
        matrixRain.width /
          matrixRain.fontSize
      );

    matrixRain.drops =
      new Array(
        matrixRain.columns
      );

    for (
      let i = 0;
      i <
      matrixRain.columns;
      i++
    ) {
      matrixRain.drops[i] =
        Math.floor(
          Math.random() *
            -30
        );
    }
  }

  function renderMatrixRain() {
    if (
      !matrixRain.canvas ||
      !matrixRain.ctx ||
      !matrixRain.container
    ) {
      return;
    }

    if (
      !isVisible(
        matrixRain.container
      )
    ) {
      return;
    }

    const {
      ctx,
      width,
      height,
      drops,
      columns,
      fontSize,
      characters
    } = matrixRain;

    ctx.fillStyle =
      "rgba(0, 6, 2, 0.18)";

    ctx.fillRect(
      0,
      0,
      width,
      height
    );

    ctx.font =
      `${fontSize}px monospace`;

    for (
      let i = 0;
      i < columns;
      i++
    ) {
      const character =
        characters[
          Math.floor(
            Math.random() *
              characters.length
          )
        ];

      const y =
        drops[i] *
        fontSize;

      ctx.fillStyle =
        y < fontSize
          ? "#c8ffd8"
          : "#39ff6a";

      ctx.fillText(
        character,
        i *
          fontSize,
        y
      );

      if (
        y > height &&
        Math.random() >
          0.975
      ) {
        drops[i] = 0;
      }

      drops[i]++;
    }
  }

  initMatrixRain();

  /*
   * ============================================================
   * CRYPTCAST SCRAMBLE
   * ============================================================
   */

  const cipherTitle =
    document.querySelector(
      ".cipher-title"
    );

  const cryptcast =
    {
      interval: 0,

      running: false
    };

  function initCryptCast() {
    if (!cipherTitle) return;

    const project =
      cipherTitle.closest(
        ".project"
      );

    if (!project) return;

    const original =
      cipherTitle.textContent;

    const glyphs =
      "!<>-_\\/[]{}—=+*^?#01";

    project.addEventListener(
      "mouseenter",
      () => {
        if (
          cryptcast.running
        ) {
          clearInterval(
            cryptcast.interval
          );
        }

        cryptcast.running =
          true;

        let frame = 0;

        const totalFrames =
          original.length *
          3;

        cryptcast.interval =
          window.setInterval(
            () => {
              let output = "";

              for (
                let i = 0;
                i <
                original.length;
                i++
              ) {
                const char =
                  original[i];

                if (
                  char === " "
                ) {
                  output += " ";
                  continue;
                }

                const revealFrame =
                  i * 3;

                if (
                  frame >=
                  revealFrame + 6
                ) {
                  output += char;
                } else {
                  output +=
                    glyphs[
                      Math.floor(
                        Math.random() *
                          glyphs.length
                      )
                    ];
                }
              }

              cipherTitle.textContent =
                output;

              frame++;

              if (
                frame >
                totalFrames
              ) {
                clearInterval(
                  cryptcast.interval
                );

                cryptcast.running =
                  false;

                cipherTitle.textContent =
                  original;
              }
            },
            35
          );
      },
      { passive: true }
    );
  }

  initCryptCast();

  /*
   * ============================================================
   * WINDOW RESIZE
   * ============================================================
   */

  let resizePending = false;

  function handleResize() {
    if (resizePending) {
      return;
    }

    resizePending = true;

    requestAnimationFrame(
      () => {
        resizePending = false;

        resizeDotField();

        for (
          const border of
          electricBorders
        ) {
          border.resize();
        }

        resizeMatrixRain();

        cacheHeroLetterPositions();
      }
    );
  }

  window.addEventListener(
    "resize",
    handleResize,
    {
      passive: true
    }
  );

  /*
   * ============================================================
   * VISIBILITY CHANGE
   * ============================================================
   */

  document.addEventListener(
    "visibilitychange",
    () => {
      pageVisible =
        !document.hidden;

      if (
        !pageVisible
      ) {
        stopAnimationLoop();
      } else {
        lastFrameTime =
          performance.now();

        startAnimationLoop();
      }
    }
  );

  /*
   * ============================================================
   * GLOBAL ANIMATION LOOP
   * ============================================================
   */

  function animationFrame(
    currentTime
  ) {
    if (
      !pageVisible ||
      prefersReducedMotion
    ) {
      animationRunning =
        false;

      rafId = 0;

      return;
    }

    const delta =
      Math.min(
        (currentTime -
          lastFrameTime) /
          1000,
        0.05
      );

    lastFrameTime =
      currentTime;

    updatePointerSpeed(
      delta
    );

    /*
     * Cursor is cheap enough to update
     * every frame.
     */
    updateCursor();

    /*
     * Dot field.
     */
    if (
      dotFieldContainer &&
      isVisible(dotFieldContainer)
    ) {
      dotField.dirty = true;

      renderDotField();
    }

    /*
     * Hero proximity.
     */
    renderHeroProximity();

    /*
     * Stretch buttons.
     */
    renderButtons();

    /*
     * Electric borders.
     */
    renderElectricBorders(
      delta
    );

    /*
     * Optional Matrix Rain.
     */
    renderMatrixRain();

    rafId =
      requestAnimationFrame(
        animationFrame
      );
  }

  function startAnimationLoop() {
    if (
      animationRunning ||
      !pageVisible ||
      prefersReducedMotion
    ) {
      return;
    }

    animationRunning = true;

    lastFrameTime =
      performance.now();

    rafId =
      requestAnimationFrame(
        animationFrame
      );
  }

  function stopAnimationLoop() {
    animationRunning =
      false;

    if (rafId) {
      cancelAnimationFrame(
        rafId
      );

      rafId = 0;
    }
  }

  /*
   * ============================================================
   * OBSERVE IMPORTANT ELEMENTS
   * ============================================================
   */

  if (dotFieldContainer) {
    observeVisibility(
      dotFieldContainer
    );
  }

  if (heroContainer) {
    observeVisibility(
      heroContainer
    );
  }

  /*
   * ============================================================
   * START
   * ============================================================
   */

  initDotField();
  initHeroProximity();

  if (
    !prefersReducedMotion
  ) {
    startAnimationLoop();
  }

})();
