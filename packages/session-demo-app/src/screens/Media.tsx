import { useState } from 'react';
import { Card } from '../components/ui';

/**
 * Media and asset fidelity cases.
 *
 * Every block is a distinct way a replay ends up looking broken: images that
 * 404 in the player, icons that render as tofu boxes, sprite references that
 * resolve to nothing, and iframes that appear as unexplained empty rectangles.
 *
 * Images are inline SVG data URIs rather than remote files on purpose — the
 * demo has to work with no network, and a data URI still exercises the
 * inline-image and dedupe paths since rrweb sees an ordinary <img src>.
 */

const swatch = (bg: string, label: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="#111827"/>
       </linearGradient></defs>
       <rect width="240" height="150" fill="url(#g)"/>
       <text x="120" y="80" font-family="Inter,sans-serif" font-size="16"
             fill="#fff" text-anchor="middle">${label}</text>
     </svg>`,
  )}`;

const SMALL = swatch('#2f5de3', 'small 1x');
const LARGE = swatch('#6f4de3', 'large 2x');
const LAZY = swatch('#0f7b4f', 'lazy-loaded');
const REPEATED = swatch('#9a3412', 'repeated');

export function Media() {
  const [videoState, setVideoState] = useState('paused');

  return (
    <div className="page">
      <Card title="Images">
        <div className="media-grid">
          <figure>
            <img src={SMALL} alt="A local image" width={240} height={150} />
            <figcaption>Local image</figcaption>
          </figure>
          <figure>
            {/*
              srcset: the player's viewport may resolve a different candidate
              than the recorder's did, so what matters is that the *resolved*
              currentSrc is what replays.
            */}
            <img
              src={SMALL}
              srcSet={`${SMALL} 1x, ${LARGE} 2x`}
              alt="A responsive image"
              width={240}
              height={150}
            />
            <figcaption>srcset 1x / 2x</figcaption>
          </figure>
          <figure>
            <img
              src={LAZY}
              alt="A lazy-loaded image"
              loading="lazy"
              width={240}
              height={150}
            />
            <figcaption>loading=&quot;lazy&quot;</figcaption>
          </figure>
        </div>
      </Card>

      <Card title="Repeated asset (deduplication target)">
        <div className="avatar-row">
          {/*
            The same image twenty times. Base64-inlined into the event stream
            this is twenty copies; externalised and hashed it is stored once.
            This is the case that makes asset dedupe worth the machinery.
          */}
          {Array.from({ length: 20 }, (_, i) => (
            <img key={i} src={REPEATED} alt="" width={40} height={25} />
          ))}
        </div>
        <p className="field-note" style={{ marginTop: 10 }}>
          One image, twenty references.
        </p>
      </Card>

      <Card title="SVG sprite">
        {/*
          A sprite sheet referenced by <use href="#id">. If the <symbol>
          definitions are not in the snapshot, every icon resolves to nothing
          and the row renders empty.
        */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <symbol id="icon-check" viewBox="0 0 24 24">
            <path
              d="M20 6L9 17l-5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </symbol>
          <symbol id="icon-alert" viewBox="0 0 24 24">
            <path
              d="M12 3l9 16H3l9-16zm0 6v5m0 3v.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </symbol>
          <symbol id="icon-clock" viewBox="0 0 24 24">
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M12 7v5l3 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </symbol>
        </svg>

        <div className="icon-row">
          {[
            ['icon-check', 'Paid', 'var(--positive)'],
            ['icon-alert', 'Failed', 'var(--danger)'],
            ['icon-clock', 'Pending', 'var(--warning)'],
          ].map(([id, label, color]) => (
            <span className="icon-item" key={id} style={{ color }}>
              <svg width="22" height="22" aria-hidden="true">
                <use href={`#${id}`} />
              </svg>
              {label}
            </span>
          ))}
        </div>
      </Card>

      <Card title="Web font">
        <p className="display-font">The quick brown fox jumps over the lazy dog</p>
        <p className="field-note">
          Rendered in a locally-defined @font-face. Without <code>collectFonts</code> this
          falls back and every glyph is subtly the wrong width — which reads as “the
          replay is broken” long before anyone suspects the font.
        </p>
      </Card>

      <Card title="Video">
        <video
          className="demo-video"
          width={320}
          height={180}
          controls
          muted
          playsInline
          onPlay={() => setVideoState('playing')}
          onPause={() => setVideoState('paused')}
          poster={swatch('#334155', 'video poster')}
        >
          {/* No source: rrweb replays playback STATE, never media content. */}
        </video>
        <p className="field-note" style={{ marginTop: 10 }}>
          State: {videoState}. Known limitation — the replay reproduces play/pause and
          currentTime, not the frames.
        </p>
      </Card>

      <Card title="Iframes">
        <div className="iframe-row">
          <div>
            <iframe
              title="Same-origin iframe"
              src="/dashboard"
              className="demo-iframe"
              sandbox="allow-same-origin allow-scripts"
            />
            <p className="field-note">Same-origin — capturable.</p>
          </div>
          <div>
            {/*
              `data-fidelity-exclude` declares this region unmeasurable to the
              pixel-diff harness. It is the one place live and replay can never
              match, because the browser refuses to expose another origin's DOM.
              Measuring it would report a permanent, unfixable deficit and train
              everyone to ignore the score. The same-origin iframe above is
              deliberately NOT excluded — it is capturable, and a regression
              there should fail loudly.
            */}
            <iframe
              title="Cross-origin iframe"
              src="https://example.com/"
              className="demo-iframe"
              data-fidelity-exclude="cross-origin-iframe"
            />
            <p className="field-note">
              Cross-origin — impossible to capture. The player should show a labelled
              placeholder, never a silent empty box.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
