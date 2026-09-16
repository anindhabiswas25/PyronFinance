import { useEffect } from 'react';

// The landing page's behaviour layer, ported from the landing-page branch's LandingEffects (itself a
// port of landing/main.js). It stays DOM-query driven: text splitting rewrites a heading into per-word
// spans, line splitting measures rendered geometry, and the slider translates a track; rebuilding those
// as controlled React would change their timing and the feel of the page.
//
// Changes from the original: no next/script (the Lottie player is added as a script tag here), the
// smooth-scroll animation is cancelled on unmount so it can't fight the terminal's scroll reset after
// "Launch App", and without IntersectionObserver (jsdom) everything is simply shown.
//
// Everything no-ops under `prefers-reduced-motion: reduce`.

const LOTTIE_SRC = '/landing/lottie.min.js';

type LottieAnim = { play(): void; pause(): void; destroy(): void; goToAndStop(v: number, f: boolean): void };
type LottieGlobal = {
  loadAnimation(opts: { container: Element; renderer: string; loop: boolean; autoplay: boolean; path: string; rendererSettings: { progressiveLoad: boolean } }): LottieAnim;
};
type LottieHost = Element & { _anim?: LottieAnim };

export function LandingEffects() {
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canObserve = typeof IntersectionObserver !== 'undefined';
    const cleanups: Array<() => void> = [];

    /* ------------------------------------------------- 1. smooth scroll */

    // Wheel input drives a target offset that the page eases towards. Touch devices keep native scrolling.
    const initSmoothScroll = () => {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      if (reduceMotion || coarse) return;

      let target = window.scrollY;
      let current = target;
      let animating = false;
      let raf = 0;

      const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      const frame = () => {
        current += (target - current) * 0.1;
        if (Math.abs(target - current) < 0.4) {
          current = target;
          animating = false;
        } else {
          raf = requestAnimationFrame(frame);
        }
        window.scrollTo(0, current);
      };

      const start = () => {
        if (animating) return;
        animating = true;
        raf = requestAnimationFrame(frame);
      };

      const onWheel = (event: WheelEvent) => {
        if (event.ctrlKey) return; // let pinch-zoom through
        event.preventDefault();
        target = Math.min(Math.max(target + event.deltaY, 0), maxScroll());
        start();
      };

      // Keyboard, scrollbar drags and anchor jumps move the page directly.
      const onScroll = () => {
        if (!animating) target = current = window.scrollY;
      };

      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('scroll', onScroll);
      cleanups.push(() => {
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('scroll', onScroll);
        cancelAnimationFrame(raf);
        animating = false;
      });

      document.querySelectorAll<HTMLAnchorElement>('.pl a[href^="#"]').forEach((link) => {
        const onClick = (event: Event) => {
          const id = link.getAttribute('href')?.slice(1);
          const el = id ? document.getElementById(id) : null;
          if (!el) return;
          event.preventDefault();
          target = Math.min(el.getBoundingClientRect().top + window.scrollY, maxScroll());
          start();
        };
        link.addEventListener('click', onClick);
        cleanups.push(() => link.removeEventListener('click', onClick));
      });
    };

    /* --------------------------------------------------- 2. text splitting */

    /** Wrap every word of `el` in a span so words can be revealed one by one. */
    const splitWords = (el: Element) => {
      const words = (el.textContent ?? '').trim().split(/\s+/);
      el.textContent = '';
      words.forEach((word, i) => {
        const span = document.createElement('span');
        span.className = 'word-span';
        span.textContent = word;
        el.appendChild(span);
        if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
      });
    };

    /** Group words into rendered lines, then wrap each line in its own span. */
    const splitLines = (el: Element) => {
      const words = (el.textContent ?? '').trim().split(/\s+/);
      el.textContent = '';

      const probes = words.map((word, i) => {
        const span = document.createElement('span');
        span.style.display = 'inline-block';
        span.textContent = word;
        el.appendChild(span);
        if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
        return span;
      });

      const lines: string[][] = [];
      let currentTop: number | null = null;
      probes.forEach((probe) => {
        const top = probe.offsetTop;
        if (currentTop === null || Math.abs(top - currentTop) > 2) {
          currentTop = top;
          lines.push([]);
        }
        lines[lines.length - 1].push(probe.textContent ?? '');
      });

      el.textContent = '';
      lines.forEach((line) => {
        const span = document.createElement('span');
        span.className = 'line-span-body';
        span.textContent = line.join(' ');
        el.appendChild(span);
      });
    };

    const initTextSplitting = () => {
      document.querySelectorAll('.pl [create-spans]').forEach(splitWords);
      document.querySelectorAll('.pl [create-spans-body]').forEach(splitLines);
    };

    /* ----------------------------------------------------- 2b. view reveals */

    const addClassWithDelay = (elements: NodeListOf<Element>, className: string, delay: number) => {
      elements.forEach((element, index) => {
        const id = window.setTimeout(() => element.classList.add(className), index * delay);
        cleanups.push(() => window.clearTimeout(id));
      });
    };

    const initTextReveals = () => {
      document.querySelectorAll('.pl [view-text="true"]').forEach((element) => {
        const className = element.getAttribute('view-text-class') || 'word-span';
        const margin = element.getAttribute('view-text-margin') || '5';
        const delay = parseInt(element.getAttribute('view-text-delay') ?? '', 10) || 100;

        if (!canObserve) {
          element.querySelectorAll('.' + className).forEach((el) => el.classList.add('view'));
          return;
        }
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              addClassWithDelay(entry.target.querySelectorAll('.' + className), 'view', delay);
              observer.unobserve(entry.target);
            });
          },
          { root: null, rootMargin: `0px 0px -${margin}% 0px` },
        );

        observer.observe(element);
        cleanups.push(() => observer.disconnect());
      });
    };

    const initBlockReveals = () => {
      const blocks = document.querySelectorAll('.pl .view-element');
      if (!canObserve) {
        blocks.forEach((el) => el.classList.add('view'));
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('view');
            observer.unobserve(entry.target);
          });
        },
        { root: null, rootMargin: '0px 0px -8% 0px' },
      );

      blocks.forEach((el) => observer.observe(el));
      cleanups.push(() => observer.disconnect());
    };

    /* ---------------------------------------------------- 3. product slider */

    const initSlider = () => {
      const root = document.querySelector('.pl .solution-swiper');
      if (!root) return;

      const track = root.querySelector<HTMLElement>('.swiper-wrapper');
      const slides = [...root.querySelectorAll('.swiper-slide')];
      const pagination = root.querySelector('.swiper-pagination');
      const dots = [...document.querySelectorAll<HTMLElement>('.pl .custom-dot')];
      if (!track || !pagination || slides.length === 0) return;
      const AUTOPLAY = 4000;

      const bullets = slides.map(() => {
        const bullet = document.createElement('span');
        bullet.className = 'swiper-pagination-bullet';
        bullet.innerHTML = '<span class="swiper-progress-line"></span>';
        pagination.appendChild(bullet);
        return bullet;
      });

      let index = 0;
      let timer: number | null = null;
      let pendingLine: number | null = null;

      const resetProgressLines = () => {
        root.querySelectorAll<HTMLElement>('.swiper-progress-line').forEach((line) => {
          line.classList.remove('animate');
          line.style.width = '0%';
        });
      };

      const animateProgressLine = () => {
        const line = bullets[index].querySelector<HTMLElement>('.swiper-progress-line');
        if (!line) return;
        void line.offsetWidth; // force reflow so the transition restarts
        line.classList.add('animate');
        line.style.width = '100%';
      };

      const render = () => {
        track.style.transform = `translate3d(${-index * 100}%, 0, 0)`;
        dots.forEach((dot) => dot.classList.toggle('is-active', Number(dot.dataset.slide) === index));
        resetProgressLines();
        pendingLine = window.setTimeout(animateProgressLine, 10);
      };

      const schedule = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => goTo(index + 1), AUTOPLAY);
      };

      function goTo(next: number) {
        index = (next + slides.length) % slides.length;
        render();
        schedule();
      }

      dots.forEach((dot) => {
        const onClick = () => goTo(Number(dot.dataset.slide));
        dot.addEventListener('click', onClick);
        cleanups.push(() => dot.removeEventListener('click', onClick));
      });
      bullets.forEach((bullet, i) => bullet.addEventListener('click', () => goTo(i)));

      const onVisibility = () => {
        if (document.hidden) {
          if (timer !== null) window.clearTimeout(timer);
        } else schedule();
      };
      document.addEventListener('visibilitychange', onVisibility);

      render();
      if (!reduceMotion) schedule();

      cleanups.push(() => {
        document.removeEventListener('visibilitychange', onVisibility);
        if (timer !== null) window.clearTimeout(timer);
        if (pendingLine !== null) window.clearTimeout(pendingLine);
        // React re-runs effects in StrictMode; without this the bullets double.
        pagination.innerHTML = '';
      });
    };

    /* ----------------------------------------------------------- 4. lottie */

    // Card artwork is a looping Lottie (SVG renderer), built once its card is near the viewport and
    // paused whenever it scrolls back out.
    const initLottie = () => {
      const holders = document.querySelectorAll<LottieHost>('.pl [data-lottie]');
      if (!holders.length || !canObserve) return true;

      const lottie = (window as unknown as { lottie?: LottieGlobal }).lottie;
      if (!lottie) return false; // script not up yet — the caller retries

      const build = (el: LottieHost) => {
        const anim = lottie.loadAnimation({
          container: el,
          renderer: 'svg',
          loop: true,
          autoplay: !reduceMotion,
          path: el.getAttribute('data-lottie') ?? '',
          rendererSettings: { progressiveLoad: true },
        });
        if (reduceMotion) anim.goToAndStop(0, true);
        return anim;
      };

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const el = entry.target as LottieHost;
            if (!el._anim) {
              if (!entry.isIntersecting) return;
              el._anim = build(el);
              return;
            }
            if (reduceMotion) return;
            if (entry.isIntersecting) el._anim.play();
            else el._anim.pause();
          });
        },
        { rootMargin: '200px 0px' },
      );

      holders.forEach((el) => observer.observe(el));
      cleanups.push(() => {
        observer.disconnect();
        holders.forEach((el) => {
          el._anim?.destroy();
          delete el._anim;
        });
      });
      return true;
    };

    const loadLottieScript = () => {
      if (!canObserve || document.querySelector(`script[src="${LOTTIE_SRC}"]`)) return;
      const script = document.createElement('script');
      script.src = LOTTIE_SRC;
      script.async = true;
      document.head.appendChild(script);
    };

    /* ------------------------------------------------------------- startup */

    // Line grouping depends on final metrics, so wait for the webfonts.
    let cancelled = false;
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    void fontsReady.then(() => {
      if (cancelled) return;
      initTextSplitting();
      initTextReveals();
    });
    cleanups.push(() => {
      cancelled = true;
    });

    initBlockReveals();
    initSlider();
    initSmoothScroll();
    loadLottieScript();

    // The Lottie player may land after this effect: poll briefly rather than racing it.
    if (initLottie() === false) {
      let tries = 0;
      const poll = window.setInterval(() => {
        if (initLottie() !== false || ++tries > 40) window.clearInterval(poll);
      }, 100);
      cleanups.push(() => window.clearInterval(poll));
    }

    // Re-split body copy after a resize so line breaks stay correct.
    let resizeTimer: number | undefined;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        document.querySelectorAll('.pl [create-spans-body]').forEach((el) => {
          const revealed = el.querySelector('.line-span-body.view');
          splitLines(el);
          if (revealed) el.querySelectorAll('.line-span-body').forEach((l) => l.classList.add('view'));
        });
      }, 200);
    };
    window.addEventListener('resize', onResize);
    cleanups.push(() => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(resizeTimer);
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
