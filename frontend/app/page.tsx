import Script from "next/script";

import {LandingEffects} from "@/components/marketing/LandingEffects";
import {LaunchApp} from "@/components/marketing/LaunchApp";
import {WaitlistForm} from "@/components/marketing/WaitlistForm";

/**
 * The landing page, ported from landing/index.html.
 *
 * The markup is server-rendered and identical to the original, so the CSS and
 * the behaviour layer (LandingEffects, which queries this DOM) both work
 * unchanged. The hero's CTA and the footer form both point at the same
 * waitlist, so the page captures an email wherever a visitor is ready to give
 * one.
 */

const CHECK = (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 8.5 6.5 12 13 4.5"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The three protocol slides, rendered twice: as slider tabs on desktop and as
 *  stacked cards below 991px. Same source so they can never drift apart. */
const SOLUTIONS = [
  {
    title: "Pyron RFQ",
    icon: <path d="M10 5v10M5 10h10" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />,
    lottie: "/assets/slide-split.json",
    points: [
      [
        "One intent:",
        "state the pair and size once; your request gossips across open relays with no price and no identity attached.",
      ],
      [
        "Sealed bids:",
        "every responding dealer commits on-chain first, locking in a price nobody can see yet.",
      ],
    ],
  },
  {
    title: "Pyron Reveal",
    icon: (
      <path
        d="M5 13l3.4-3.6L11 12l4-6"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    lottie: "/assets/slide-market.json",
    points: [
      [
        "Compare what matters:",
        "revealed prices sit beside each dealer's bond, settled trades and slash record, every one verified against the chain in your own client.",
      ],
    ],
  },
  {
    title: "Pyron Settle",
    icon: (
      <path
        d="M10 5.5v5l3 2"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    lottie: "/assets/slide-fixed.json",
    points: [
      [
        "Atomic settlement:",
        "settle straight from the dealer's pre-proved Zswap offer, with no custodian and no waiting on the dealer.",
      ],
      [
        "Programmable disclosure:",
        "attach an encrypted note tied to one trade, readable only by the party you choose.",
      ],
    ],
  },
];

function SolutionTabBody({solution}: {solution: (typeof SOLUTIONS)[number]}) {
  return (
    <div className="solutions-slider-tab-element">
      <div className="sol-slider-tab-title">
        <div className="sol-slider-title-svg">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="18" height="18" rx="6" stroke="#fff" strokeWidth="1.6" />
            {solution.icon}
          </svg>
        </div>
        <p className="subheadline-s2 white">{solution.title}</p>
      </div>
      <ul className="sol-slider-tab-list">
        {solution.points.map(([lead, rest]) => (
          <li className="sol-slider-tab-item" key={lead}>
            <p className="body-b4">
              <span className="weight-500">{lead}</span> {rest}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      <div className="page-wrapper">
        <div className="header">
          <div className="header-logo">
            <a className="wordmark" href="#top">
              Pyron Finance
            </a>
          </div>
        </div>

        <main className="main" id="top">
          {/* ==================================================== hero */}
          <section className="hero-sc">
            <div className="full-container hero-s">
              <div className="container hero-sc">
                <div className="hero-bg-elements">
                  <div data-noise="" className="hero-bg-ellipse" />
                  <div data-noise="" className="hero-bg-ellipse" />
                  <div data-noise="" className="hero-bg-noise" />

                  <div className="hero-bg-images">
                    {[
                      ["s1", "/assets/hero-main-bg.png", undefined],
                      ["s2", "/assets/hero-coin-usdc.png", "1"],
                      ["s3", "/assets/hero-coin-btc.png", "2"],
                      ["s4", "/assets/hero-coin-tether.png", "1"],
                      ["s5", "/assets/hero-coin-eth.png", "2"],
                    ].map(([cls, src, levitation]) => (
                      <div className={`hero-bg-image ${cls}`} key={cls}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="image-contain"
                          src={src}
                          alt=""
                          width={2400}
                          height={943}
                          {...(levitation ? {"data-levitation": levitation} : {})}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="hero-main-elements">
                  <div className="text-elements hero-s">
                    <div className="headline-wrapper hero-s">
                      <h1
                        className="headline-h1"
                        create-spans=""
                        view-text="true"
                        view-text-delay="60"
                      >
                        Private OTC on Midnight
                      </h1>
                    </div>
                  </div>

                  <div className="view-element">
                    <LaunchApp />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ================================================== values */}
          <section className="values-sc">
            <div className="container values-sc">
              <div className="text-elements">
                <div className="view-element">
                  <div className="headline-tag">
                    <p className="body-b5">Welcome to Pyron</p>
                    <div className="headline-tag-svg">{CHECK}</div>
                  </div>
                </div>

                <div className="headline-wrapper values-s">
                  <h2 className="headline-h2" create-spans="" view-text="true" view-text-delay="60">
                    No More Last Look
                  </h2>
                </div>

                <div className="description-wrapper values-s">
                  <p
                    className="body-b2"
                    create-spans-body=""
                    view-text="true"
                    view-text-class="line-span-body"
                    view-text-delay="120"
                  >
                    Built so every price a dealer quotes you is sealed on-chain and backed by a bond
                  </p>
                </div>
              </div>

              <div className="values-cards">
                <div className="values-cards-pair big-left">
                  <div className="view-element">
                    <div className="values-card b-padding flex-p">
                      <div className="values-lottie s1" data-lottie="/assets/card-split.json" />
                      <div className="text-elements values-card-s">
                        <div className="headline-wrapper values-s s1">
                          <h3 className="subheadline-s1">Sealed Commit-Reveal Quotes</h3>
                        </div>
                        <div className="description-wrapper values-card-s s1">
                          <p className="body-b2">
                            Dealers post a commitment to their quote on Midnight before any price
                            is revealed, then reveal it encrypted to you alone. Competing dealers
                            and relay operators never see it.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="view-element">
                    <div className="values-card">
                      <div className="values-lottie s2" data-lottie="/assets/card-rails.json" />
                      <div className="text-elements values-card-s">
                        <div className="description-wrapper values-card-s s2">
                          <p className="body-b1 dark">
                            Settled atomically through Zswap, Midnight&apos;s native swap primitive,
                            with no custody in between.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="values-cards-pair big-right">
                  <div className="view-element">
                    <div className="values-card">
                      <div className="values-lottie s3" data-lottie="/assets/card-mission.json" />
                      <div className="text-elements values-card-s">
                        <div className="description-wrapper values-card-s s3">
                          <p className="body-b1 dark">
                            Our mission is an OTC venue where integrity comes from cryptography and
                            stake, not gatekeeping.
                          </p>
                        </div>
                      </div>
                      <div className="values-button-wrapper">
                        <div className="values-button-element s1">
                          <div className="values-button-element s2">
                            <a href="#waitlist" className="values-button">
                              <div>Join waitlist</div>
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="view-element">
                    <div className="values-card b-padding flex-p">
                      <div className="values-lottie s4" data-lottie="/assets/card-rates.json" />
                      <div className="text-elements values-card-s">
                        <div className="headline-wrapper values-s s1">
                          <h3 className="subheadline-s1">Permissionless Bonded Dealers</h3>
                        </div>
                        <div className="description-wrapper values-card-s s4">
                          <p className="body-b2">
                            Post a bond and start quoting, with no allowlist and no approval. If a
                            signed reveal doesn&apos;t match its commitment, anyone can slash the
                            bond.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* =============================================== solutions */}
          <section className="solutions-sc">
            <div className="full-container solutions-s" data-noise="">
              <div className="container solutions-s">
                <div className="text-elements">
                  <div className="solutions-headline-element">
                    <div className="view-element">
                      <div className="solutions-lottie" data-lottie="/assets/solutions-mark.json" />
                    </div>
                  </div>

                  <div className="view-element">
                    <div className="headline-tag changed-color">
                      <p className="body-b5 white">Our Protocol</p>
                      <div className="headline-tag-svg">{CHECK}</div>
                    </div>
                  </div>

                  <div className="headline-wrapper solutions-s">
                    <h2
                      className="headline-h3 white"
                      create-spans=""
                      view-text="true"
                      view-text-delay="50"
                    >
                      Pyron Binds OTC Dealers to Their Quotes With Cryptography and Stake, Not
                      Trust.
                    </h2>
                  </div>

                  <div className="description-pair solutions-s">
                    <div className="description-wrapper solutions-s left">
                      <p
                        className="body-b1 white"
                        create-spans-body=""
                        view-text="true"
                        view-text-class="line-span-body"
                        view-text-delay="120"
                      >
                        Request a quote once, compare sealed bids from bonded dealers, and settle
                        privately — without ever revealing who you are.
                      </p>
                    </div>
                    <div className="description-wrapper solutions-s right">
                      <p
                        className="body-b1 white"
                        create-spans-body=""
                        view-text="true"
                        view-text-class="line-span-body"
                        view-text-delay="120"
                      >
                        Requests travel over an open relay network anyone can run. Prices never
                        do.
                      </p>
                    </div>
                    <div className="description-pair-element" data-levitation="1">
                      <div className="view-element">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="image-contain"
                          src="/assets/desc-element.png"
                          alt=""
                          width={556}
                          height={556}
                          loading="lazy"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="view-element">
                  <div className="solutions-content-wrapper">
                    <div className="solutions-content">
                      <div className="solutions-slider-nav">
                        {SOLUTIONS.map((solution, i) => (
                          <div
                            className={`solutions-slider-tab custom-dot${i === 0 ? " is-active" : ""}`}
                            data-slide={i}
                            key={solution.title}
                          >
                            <SolutionTabBody solution={solution} />
                          </div>
                        ))}
                      </div>

                      <div className="solutions-slider-content">
                        <div className="solution-swiper">
                          <div className="swiper-wrapper">
                            {SOLUTIONS.map((solution) => (
                              <div className="swiper-slide" key={solution.title}>
                                <div className="swiper-lottie-wrapper">
                                  <div className="swiper-lottie" data-lottie={solution.lottie} />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="swiper-pagination" />
                        </div>
                      </div>

                      {/* stacked equivalent for small screens */}
                      <div className="solutions-mobile-p">
                        {SOLUTIONS.map((solution) => (
                          <div className="sol-card-block" key={solution.title}>
                            <SolutionTabBody solution={solution} />
                            <div className="sol-card-p">
                              <div className="swiper-lottie" data-lottie={solution.lottie} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* ==================================================== footer */}
        <footer className="footer" id="waitlist">
          <section className="footer-sc">
            <div className="full-container footer-s" data-noise="">
              <div className="container footer-s">
                <div className="view-element">
                  <div data-levitation="2">
                    <div className="footer-logo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="image-contain"
                        src="/assets/logo-badge.svg"
                        alt="Pyron Finance"
                        width={200}
                        height={200}
                        loading="lazy"
                      />
                    </div>
                  </div>
                </div>

                <div className="text-elements">
                  <div className="headline-wrapper footer-s">
                    <h2
                      className="headline-h2 white"
                      create-spans=""
                      view-text="true"
                      view-text-delay="60"
                    >
                      Trade OTC Privately on Midnight
                    </h2>
                  </div>
                  <div className="description-wrapper footer-s">
                    <p
                      className="body-b2 white"
                      create-spans-body=""
                      view-text="true"
                      view-text-class="line-span-body"
                      view-text-delay="120"
                    >
                      Join the waitlist for early access to Pyron&apos;s bonded OTC venue on
                      Midnight.
                    </p>
                  </div>
                </div>

                <div className="footer-form">
                  <div className="view-element">
                    <WaitlistForm variant="footer" />
                  </div>
                </div>

                <div className="footer-down-block">
                  <div className="footer-rights-block">
                    <div className="body-b5 white">
                      © 2026 Pyron Finance™. All rights reserved.
                    </div>
                  </div>

                  <div className="media-links">
                    <a className="media-link" href="#" aria-label="X">
                      <div className="media-svg">
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M17.5 3h3.1l-6.8 7.8L21.8 21h-6.2l-4.9-6.4L5.1 21H2l7.3-8.3L2.4 3h6.4l4.4 5.8L17.5 3Zm-1.1 16.1h1.7L7.7 4.8H5.9l10.5 14.3Z" />
                        </svg>
                      </div>
                    </a>
                    <a className="media-link" href="#" aria-label="GitHub">
                      <div className="media-svg">
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
                        </svg>
                      </div>
                    </a>
                    <a className="media-link" href="#" aria-label="Discord">
                      <div className="media-svg">
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M19.3 5.6A16 16 0 0 0 15.4 4.4l-.2.4a15 15 0 0 0-6.4 0l-.2-.4A16 16 0 0 0 4.7 5.6C2.2 9.3 1.5 12.9 1.9 16.5a16 16 0 0 0 4.8 2.4l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11.4 11.4 0 0 0 9.8 0l.4.3a10 10 0 0 1-1.6.8l1 1.6a16 16 0 0 0 4.8-2.4c.5-4.2-.7-7.8-2.6-10.9ZM8.7 14.3c-1 0-1.7-.9-1.7-1.9s.7-1.9 1.7-1.9 1.8.9 1.8 1.9-.8 1.9-1.8 1.9Zm6.6 0c-1 0-1.7-.9-1.7-1.9s.7-1.9 1.7-1.9 1.8.9 1.8 1.9-.8 1.9-1.8 1.9Z" />
                        </svg>
                      </div>
                    </a>
                    <a className="media-link" href="#" aria-label="Telegram">
                      <div className="media-svg">
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M21.9 4.4 18.7 19c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.3 12.7l-4.8-1.5c-1-.3-1-1 .2-1.5l18.8-7.3c.9-.3 1.6.2 1.4 2Z" />
                        </svg>
                      </div>
                    </a>
                  </div>

                  <div className="footer-coin s1" data-levitation="1">
                    <div className="view-element">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="image-contain mobile-p-hidden"
                        src="/assets/footer-coin-1.png"
                        alt=""
                        width={846}
                        height={846}
                        loading="lazy"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="image-contain mobile-p-view"
                        src="/assets/footer-coin-1-m.png"
                        alt=""
                        loading="lazy"
                      />
                    </div>
                  </div>
                  <div className="footer-coin s2" data-levitation="2">
                    <div className="view-element">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="image-contain mobile-p-hidden"
                        src="/assets/footer-coin-2.png"
                        alt=""
                        width={795}
                        height={795}
                        loading="lazy"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="image-contain mobile-p-view"
                        src="/assets/footer-coin-2-m.png"
                        alt=""
                        loading="lazy"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </footer>
      </div>

      <Script src="/assets/lottie.min.js" strategy="afterInteractive" />
      <LandingEffects />
    </>
  );
}
