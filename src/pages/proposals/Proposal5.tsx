import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import {
  BRAND,
  CTA,
  FEATURES,
  FOOTER,
  HERO,
  NAV,
  PILLARS,
  PLANS,
  PRICING_NOTE,
  SAMPLE_BATCH,
  STATS,
  STEPS,
} from "./content";
import { CountUp, Reveal, Stagger, StaggerItem, ThemeToggle } from "./kit";

// Short, crisp curve: fast out, hard stop. No overshoot anywhere.
const CRISP = [0.2, 0, 0, 1] as const;

const heroGroup = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const heroItem = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: CRISP } },
};

function Label({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={`g-label ${className}`}>{children}</span>;
}

function NavLink({ href, label }: { href: string; label: string }) {
  return href.startsWith("#") ? (
    <a href={href} className="g-navlink">
      {label}
    </a>
  ) : (
    <Link to={href} className="g-navlink">
      {label}
    </Link>
  );
}

/* ---------- Step numeral: ticks 00 -> 0N in mono when in view ---------- */
function Tally({ n }: { n: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const target = Number(n);
  const [v, setV] = useState(reduce ? target : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    let k = 0;
    const id = window.setInterval(() => {
      k += 1;
      setV(k);
      if (k >= target) window.clearInterval(id);
    }, 110);
    return () => window.clearInterval(id);
  }, [inView, reduce, target]);

  return (
    <span ref={ref} className="g-step__n">
      {String(v).padStart(2, "0")}
    </span>
  );
}

/* ---------- Pricing table: rows = features, columns = plans ---------- */
type Row = { label: string; cells: string[] };

function pricingRows(): Row[] {
  const num = (s: string) => s.split(" ")[0];
  const rows: Row[] = [
    {
      label: "Team members",
      cells: PLANS.map((p) =>
        p.features[0].startsWith("No plan limit")
          ? "No limit"
          : num(p.features[0]),
      ),
    },
    {
      label: "Saved recipients",
      cells: PLANS.map((p) =>
        p.features[1].startsWith("No plan limit")
          ? "No limit"
          : num(p.features[1]),
      ),
    },
  ];
  const seen = new Set<string>();
  for (const p of PLANS) {
    for (const f of p.features.slice(2)) {
      if (seen.has(f)) continue;
      seen.add(f);
      // Core payments are available on every plan (see PRICING_NOTE).
      const everywhere = f === "Individual and batch payments";
      rows.push({
        label: f,
        cells: PLANS.map((q) =>
          everywhere || q.features.includes(f) ? "●" : "—",
        ),
      });
    }
  }
  return rows;
}

/* ---------- Hero mock: batch sheet ---------- */
// Seconds per character when cells type in.
const CH = 0.011;

type PlayState = { play: boolean; done: boolean };

/** Types `text` in, one character at a time, starting `at` seconds after play. */
function Typed({
  text,
  at,
  state: { play, done },
  className = "",
}: {
  text: string;
  at: number;
  state: PlayState;
  className?: string;
}) {
  const [n, setN] = useState(done ? text.length : 0);

  useEffect(() => {
    if (done || !play) return;
    let raf = 0;
    const id = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const k = Math.min(text.length, Math.floor((now - start) / (CH * 1000)) + 1);
        setN(k);
        if (k < text.length) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, at * 1000);
    return () => {
      window.clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, [play, done, text, at]);

  return (
    <span className={`g-typed ${className}`}>
      <span className="g-typed__ghost" aria-hidden>
        {text}
      </span>
      <span className="g-typed__live">{text.slice(0, n)}</span>
    </span>
  );
}

/** Hard cut from `a` to `b` at `at` seconds. */
function Swap({
  a,
  b,
  at,
  className = "",
  classB = "",
}: {
  a: React.ReactNode;
  b: React.ReactNode;
  at: number;
  className?: string;
  classB?: string;
}) {
  return (
    <span className={`g-swap ${className}`} style={{ "--at": `${at}s` } as React.CSSProperties}>
      <span className="g-swap__a">{a}</span>
      <span className={`g-swap__b ${classB}`}>{b}</span>
    </span>
  );
}

function BatchSheet() {
  const b = SAMPLE_BATCH;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const state: PlayState = { play: inView && !reduce, done: !!reduce };

  // Schedule (seconds after the sheet is in view).
  const T_LINES = 0.35; // frame + row lines draw
  const T_HEAD = 0.9; // head text types
  const T_ROWS = 1.15; // first row starts typing
  const ROW_GAP = 0.2;
  const rowStarts = b.rows.map((_, i) => T_ROWS + i * ROW_GAP);
  const lastRowEnd =
    rowStarts[rowStarts.length - 1] +
    (2 + 14 + 11 + 9 + 7) * CH; // rough row length
  const T_TOTAL = lastRowEnd + 0.15;
  const T_SIGN = T_TOTAL + 0.25;
  const T_FLIP = T_SIGN + 0.18;
  const T_STAMP = T_FLIP + 0.3;

  const vars = {
    "--t-lines": `${T_LINES}s`,
    "--t-cols": `${T_HEAD}s`,
    "--t-total": `${T_TOTAL}s`,
    "--t-flip": `${T_FLIP}s`,
    "--t-stamp": `${T_STAMP}s`,
  } as React.CSSProperties;

  const cls = `g-sheet${state.play ? " is-play" : ""}${state.done ? " is-done" : ""}`;

  return (
    <div ref={ref} className={cls} style={vars}>
      <span className="g-frame g-frame--t" />
      <span className="g-frame g-frame--r" />
      <span className="g-frame g-frame--b" />
      <span className="g-frame g-frame--l" />

      <div className="g-sheet__head g-line g-line--fg" style={{ "--i": 0 } as React.CSSProperties}>
        <div>
          <Label>Batch</Label>
          <div className="g-sheet__title">
            <Typed text={b.name} at={T_HEAD} state={state} />
          </div>
        </div>
        <div className="text-right">
          <Label>Network</Label>
          <div className="g-mono">
            <Typed text={`${b.network} · ${b.currency}`} at={T_HEAD + 0.1} state={state} />
          </div>
        </div>
      </div>

      <div className="g-table">
        <div className="g-row g-row--head g-line" style={{ "--i": 1 } as React.CSSProperties}>
          <span>#</span>
          <span>Recipient</span>
          <span>Role</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Status</span>
        </div>
        {b.rows.map((r, i) => {
          let t = rowStarts[i];
          const cell = (s: string) => {
            const a = t;
            t += s.length * CH;
            return a;
          };
          const idx = String(i + 1).padStart(2, "0");
          const screened = r.status === "Screened";
          const statusText = screened ? "PENDING" : r.status.toUpperCase();
          return (
            <div key={r.name} className="g-row g-line" style={{ "--i": i + 2 } as React.CSSProperties}>
              <span className="g-dim">
                <Typed text={idx} at={cell(idx)} state={state} />
              </span>
              <span>
                <Typed text={r.name} at={cell(r.name)} state={state} />
              </span>
              <span className="g-dim">
                <Typed text={r.role} at={cell(r.role)} state={state} />
              </span>
              <span className="text-right">
                <Typed text={r.amount} at={cell(r.amount)} state={state} />
              </span>
              <span className="text-right">
                {screened ? (
                  <Swap
                    at={T_STAMP}
                    a={<Typed text={statusText} at={cell(statusText)} state={state} className="g-tag g-dim" />}
                    b={<span className="g-tag g-tag--stamp">SCREENED</span>}
                  />
                ) : (
                  <Typed text={statusText} at={cell(statusText)} state={state} className="g-tag" />
                )}
              </span>
            </div>
          );
        })}
        <div className="g-row g-row--foot g-line g-line--fg" style={{ "--i": b.rows.length + 2 } as React.CSSProperties}>
          <span className="g-row__total">TOTAL</span>
          <span className="text-right">{b.total}</span>
          <span className="text-right g-dim">{b.currency}</span>
        </div>
      </div>

      <div className="g-sheet__foot">
        <span className="g-vline" />
        <div className="g-sig">
          <Label>Signatures</Label>
          <div className="g-sig__row">
            <span className="g-sig__line g-sig__line--done">
              <Typed text="A. Lima" at={T_HEAD + 0.2} state={state} />
            </span>
            <span className="g-sig__line g-sig__line--done">
              <Typed text="R. Osei" at={T_SIGN} state={state} />
            </span>
          </div>
          <div className="g-mono">
            <span className="g-flip" aria-label={`${b.approvals.need} / ${b.approvals.need} signed`}>
              <span className="g-flip__a" aria-hidden>
                {b.approvals.have}
              </span>
              <span className="g-flip__b" aria-hidden>
                {b.approvals.need}
              </span>
            </span>{" "}
            / {b.approvals.need} SIGNED
          </div>
        </div>
        <div className="g-sig text-right">
          <Label>Screening</Label>
          <div className="g-mono mt-auto">
            <Swap at={T_STAMP} a={b.rows.length - 1} b={b.rows.length} /> / {b.rows.length} CLEAR
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Proposal5() {
  const [titleA] = HERO.title.split("Stay in control.");
  const rows = pricingRows();
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lp lp-5">
      {/* Header */}
      <header className={`g-header${scrolled ? " is-scrolled" : ""}`}>
        <div className="g-wrap flex h-16 items-center justify-between">
          <Link to="/" className="g-brand">
            {BRAND}
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.href} {...n} />
            ))}
          </nav>
          <div className="flex items-center gap-4 sm:gap-6">
            <Link to="/login" className="g-navlink hidden sm:inline-block">
              Log in
            </Link>
            <ThemeToggle />
            <Link to="/login" className="g-btn g-btn--primary">
              {HERO.primaryCta}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="g-rule-b">
        <div className="g-wrap grid grid-cols-1 lg:grid-cols-12">
          <motion.div
            className="g-cell-r py-14 lg:col-span-7 lg:py-24 lg:pr-16"
            variants={heroGroup}
            initial={reduce ? false : "hidden"}
            animate="visible"
          >
            <motion.span variants={heroItem} className="block">
              <Label className="g-mono">{HERO.eyebrow}</Label>
            </motion.span>
            <h1 className="g-h1 mt-8">
              <motion.span variants={heroItem} className="block">
                {titleA.trim()}
              </motion.span>
              <motion.span variants={heroItem} className="block">
                <span className={`g-underline${reduce ? " is-static" : ""}`}>
                  Stay in control.
                </span>
              </motion.span>
            </h1>
            <motion.p variants={heroItem} className="g-lede mt-8 max-w-[52ch]">
              {HERO.subtitle}
            </motion.p>
            <motion.div
              variants={heroItem}
              className="mt-10 flex flex-wrap items-center gap-6"
            >
              <Link to="/login" className="g-btn g-btn--primary g-btn--lg">
                {HERO.primaryCta}
              </Link>
              <a href="#how" className="g-textlink">
                {HERO.secondaryCta}
                <ArrowRight size={16} strokeWidth={1.75} />
              </a>
            </motion.div>
            <motion.p variants={heroItem} className="g-label mt-12">
              {HERO.trust}
            </motion.p>
          </motion.div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.45, ease: CRISP }}
            className="flex items-center py-10 lg:col-span-5 lg:py-16 lg:pl-12"
          >
            <BatchSheet />
          </motion.div>
        </div>
      </section>

      {/* Trust row */}
      <section className="g-rule-b">
        <div className="g-wrap">
          <Stagger as="div" stagger={0.06}>
            <ul className="g-trust">
              {HERO.trustLogos.map((l) => (
                <StaggerItem key={l} as="li" y={8}>
                  {l}
                </StaggerItem>
              ))}
            </ul>
          </Stagger>
        </div>
      </section>

      {/* Pillars */}
      <section id="product" className="g-rule-b">
        <div className="g-wrap">
          <Reveal y={16} className="g-section-head">
            <Label>Principles</Label>
            <h2 className="g-h2">
              Built so the business, not the vendor, holds the keys.
            </h2>
          </Reveal>
          <Stagger className="g-grid g-grid--4" stagger={0.08}>
            {PILLARS.map((p, i) => (
              <StaggerItem key={p.title} y={10} className="g-cell g-cell--tall">
                <span className="g-index">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="g-h3">{p.title}</h3>
                <p className="g-body">{p.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Features */}
      <section className="g-rule-b">
        <div className="g-wrap">
          <Reveal y={16} className="g-section-head">
            <Label>Features</Label>
            <h2 className="g-h2">
              Everything a pay run needs. Nothing it doesn't.
            </h2>
          </Reveal>
          <Stagger className="g-grid g-grid--4" stagger={0.06}>
            {FEATURES.map((f, i) => (
              <StaggerItem key={f.title} y={10} className="g-cell">
                <span className="g-index g-index--sm">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="g-h3 g-h3--sm">{f.title}</h3>
                <p className="g-body">{f.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="g-rule-b">
        <div className="g-wrap">
          <Reveal y={16} className="g-section-head">
            <Label>How it works</Label>
            <h2 className="g-h2">Three steps from spreadsheet to settled.</h2>
          </Reveal>
          <Stagger className="g-grid g-grid--3" stagger={0.1}>
            {STEPS.map((s) => (
              <StaggerItem key={s.n} y={10} className="g-cell g-step">
                <Tally n={s.n} />
                <div>
                  <h3 className="g-h3">{s.title}</h3>
                  <p className="g-body">{s.body}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Stats */}
      <section className="g-rule-b">
        <div className="g-wrap">
          <Stagger className="g-grid g-grid--4 g-grid--flush" stagger={0.08}>
            {STATS.map((s) => (
              <StaggerItem key={s.label} y={10} className="g-cell g-stat">
                <CountUp value={s.value} duration={0.8} className="g-stat__v" />
                <Label>{s.label}</Label>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="g-rule-b">
        <div className="g-wrap">
          <Reveal y={16} className="g-section-head">
            <Label>Pricing</Label>
            <h2 className="g-h2">Three plans. One price each. No surprises.</h2>
          </Reveal>
          <Reveal y={16} className="g-pricing-scroll">
            <table className="g-pricing">
              <thead>
                <tr>
                  <th className="g-pricing__corner" />
                  {PLANS.map((p) => (
                    <th
                      key={p.key}
                      className={
                        p.highlight
                          ? "g-pricing__plan is-highlight"
                          : "g-pricing__plan"
                      }
                    >
                      <Label>{p.name}</Label>
                      <div className="g-price">
                        <CountUp value={`$${p.price}`} duration={0.8} className="g-price__v" />
                        <span className="g-price__p">/ {p.period}</span>
                      </div>
                      <div className="g-body">{p.blurb}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th>{r.label}</th>
                    {r.cells.map((c, i) => (
                      <td
                        key={PLANS[i].key}
                        className={PLANS[i].highlight ? "is-highlight" : ""}
                      >
                        <span
                          className={
                            c === "●" ? "g-dot" : c === "—" ? "g-dim" : ""
                          }
                        >
                          {c}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th />
                  {PLANS.map((p) => (
                    <td
                      key={p.key}
                      className={p.highlight ? "is-highlight" : ""}
                    >
                      <Link
                        to="/login"
                        className={
                          p.highlight
                            ? "g-btn g-btn--primary w-full"
                            : "g-btn w-full"
                        }
                      >
                        {p.price === 0 ? "Start free" : "Start trial"}
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Reveal>
          <p className="g-body g-note">{PRICING_NOTE}</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="g-band">
        <div className="g-wrap g-band__inner grid grid-cols-1 gap-10 lg:grid-cols-12">
          <Reveal y={16} className="lg:col-span-8">
            <Label className="g-label--inverse">{CTA.eyebrow}</Label>
            <h2 className="g-h1 g-h1--inverse mt-6">{CTA.title}</h2>
            <p className="g-lede g-lede--inverse mt-6 max-w-[48ch]">
              {CTA.body}
            </p>
          </Reveal>
          <Reveal
            y={16}
            delay={0.1}
            className="flex flex-col justify-end gap-4 lg:col-span-4 lg:items-end"
          >
            <Link to="/login" className="g-btn g-btn--primary g-btn--lg">
              {CTA.button}
              <ArrowUpRight size={18} strokeWidth={1.75} />
            </Link>
            <span className="g-label g-label--inverse">{CTA.note}</span>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="g-wrap">
          <Stagger className="g-grid g-grid--footer" stagger={0.06}>
            <StaggerItem y={8} className="g-cell g-cell--brand">
              <Link to="/" className="g-brand">
                {BRAND}
              </Link>
              <p className="g-body mt-4 max-w-[30ch]">{FOOTER.tagline}</p>
            </StaggerItem>
            {FOOTER.columns.map((c) => (
              <StaggerItem key={c.title} y={8} className="g-cell">
                <Label>{c.title}</Label>
                <ul className="mt-5 space-y-3">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      {l.href.startsWith("#") ? (
                        <a href={l.href} className="g-footlink">
                          {l.label}
                        </a>
                      ) : (
                        <Link to={l.href} className="g-footlink">
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </StaggerItem>
            ))}
          </Stagger>
          <div className="g-footbar">
            <span>
              © {new Date().getFullYear()} {BRAND}
            </span>
            <span>Non-custodial · Safe approvals · Recipient screening</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
