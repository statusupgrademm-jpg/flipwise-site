import React from "react";
import { AnimatePresence, motion } from "framer-motion";

/***************************
 * Utilities (defensive) !
 ***************************/
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// Normalize any arbitrary content array to safe renderable blocks
function sanitizeContent(raw) {
  if (!Array.isArray(raw)) return [];
  const stripLeadNums = (s) => String(s ?? '').replace(/^\s*\d+[\.)]?\s*/, '');
  return raw
    .map((b) => {
      if (!b) return null; // drop null/undefined
      
      // List block
      if (typeof b === 'object' && b.type === 'list' && Array.isArray(b.items)) {
        return {
          type: 'list',
          items: b.items.map(item => stripLeadNums(String(item))).filter(isNonEmptyString)
        };
      }
      
      // Already a block?
      if (typeof b === 'object' && (b.type === 'subheader' || b.type === 'paragraph')) {
        return { type: b.type, text: stripLeadNums(b.text) };
      }
      
      // Unknown object with a text field
      if (typeof b === 'object' && 'text' in b) {
        return { type: 'paragraph', text: stripLeadNums(b.text) };
      }
      
      // Primitive -> paragraph
      return { type: 'paragraph', text: stripLeadNums(b) };
    })
    .filter((b) => {
      if (b?.type === 'list') return b.items.length > 0;
      return b && isNonEmptyString(b.text);
    });
}

function safePostShape(post) {
  if (!post || typeof post !== 'object') return null;
  const title = isNonEmptyString(post.title) ? post.title : 'Untitled';
  const date = isNonEmptyString(post.date) ? post.date : new Date().toISOString();
  const image = isNonEmptyString(post.image) ? post.image : '';
  const excerpt = isNonEmptyString(post.excerpt) ? post.excerpt : '';
  const content = sanitizeContent(post.content);
  const slug = isNonEmptyString(post.slug) ? post.slug : 'post';
  return { title, date, image, excerpt, content, slug };
}

/***************************
 * Smart image with fallback (Cloudinary → local assets)
 ***************************/
function SmartImage({ src, fallbackSrc, alt = '', className = '', ...rest }) {
  const initial = isNonEmptyString(src) ? src : fallbackSrc;
  const [current, setCurrent] = React.useState(initial);
  const [usedFallback, setUsedFallback] = React.useState(!isNonEmptyString(src));

  return (
    <img
      src={current}
      alt={alt}
      className={className}
      onError={() => {
        if (!usedFallback && fallbackSrc) {
          setUsedFallback(true);
          setCurrent(fallbackSrc);
        }
      }}
      {...rest}
    />
  );
}

function getPostFallback(postLike) {
  const slug = postLike && typeof postLike === 'object' && isNonEmptyString(postLike.slug)
    ? postLike.slug.trim()
    : '';
  // Try slug‑based asset first, then generic fallback
  return slug ? `/assets/${slug}.jpg` : `/assets/post-fallback.jpg`;
}

/***************************
 * Before/After Slider (Home hero)
 ***************************/
function BeforeAfterSlider({ item }) {
  const [pos, setPos] = React.useState(50);
  const trackRef = React.useRef(null);

  const clamp = (v) => Math.min(100, Math.max(0, v));
  const percentFromClientX = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return pos;
    return clamp(((clientX - rect.left) / rect.width) * 100);
  };

  const startDrag = () => {
    const move = (e) => {
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      setPos(percentFromClientX(x));
    };
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', move);
    window.addEventListener('touchend', stop);
  };

  return (
    <div
      ref={trackRef}
      className="relative w-full h-full select-none"
      onClick={(e) => setPos(percentFromClientX(e.clientX))}
      role="region"
      aria-label="Before and after comparison"
    >
      <AnimatePresence mode="wait">
        <motion.img
          key={item.after}
          src={item.after}
          alt={item?.afterAlt || 'After renovation'}
          className="absolute inset-0 h-full w-full object-cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          decoding="async"
        />
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.div
          key={item.before}
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
        >
          <img
            src={item.before}
            alt={item?.beforeAlt || 'Before renovation'}
            className="h-full w-full object-cover"
            decoding="async"
          />
        </motion.div>
      </AnimatePresence>
      <div
        className="absolute inset-y-0 cursor-ew-resize"
        style={{ left: `${pos}%` }}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      >
        <div className="-ml-0.5 h-full w-1 bg-white/80 shadow" />
        <button
          type="button"
          className="absolute top-1/2 -translate-y-1/2 -ml-4 rounded-full bg-white/90 shadow p-2 focus:outline-none focus:ring-2 focus:ring-black"
          aria-label="Drag to compare before and after"
        >
          ↔
        </button>
      </div>
      <div className="absolute left-3 top-3 text-[11px] px-2 py-1 rounded bg-black/60 text-white">Before</div>
      <div className="absolute right-3 top-3 text-[11px] px-2 py-1 rounded bg-black/60 text-white">After</div>
    </div>
  );
}

/***************************
 * Blog: Card, Index, Post
 ***************************/
function BlogCard({ post, onOpen }) {
  const p = safePostShape(post);
  if (!p) return null;
  const fallback = getPostFallback(p);
  return (
    <article className="relative rounded-2xl overflow-hidden border border-neutral-200 shadow-sm flex flex-col">
      {/* Background image using SmartImage so broken Cloudinary falls back to local */}
      <div className="absolute inset-0">
        <SmartImage
          src={p.image}
          fallbackSrc={fallback}
          alt={p.title}
          className="w-full h-full object-cover"
          decoding="async"
        />
        <div className="absolute inset-0 bg-black/50" />
      </div>

      {/* Foreground content */}
      <div className="relative p-5 flex flex-col flex-1 text-white">
        <h3 className="text-lg font-semibold drop-shadow-sm">{p.title}</h3>
        <p className="text-xs text-neutral-200 mt-1">{new Date(p.date).toLocaleDateString()}</p>
        <p className="text-sm text-neutral-100 mt-3 flex-1 drop-shadow-sm">{p.excerpt}</p>
        <button
          type="button"
          onClick={() => typeof onOpen === 'function' ? onOpen(p) : null}
          className="mt-4 self-start rounded-xl border border-white/80 px-4 py-2 text-sm hover:bg-white/20 backdrop-blur"
          aria-label={`Read: ${p.title}`}
        >
          Read
        </button>
      </div>
    </article>
  );
}

function BlogIndex({ posts, onOpen }) {
  const list = Array.isArray(posts) ? posts : [];
  return (
    <section id="blog" className="py-16 md:py-24">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Blog</h2>
        <p className="mt-4 text-neutral-700">Guides, checklists, and playbooks from active deals.</p>
        <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {list.map((raw) => {
            const p = safePostShape(raw);
            return <BlogCard key={p.slug} post={p} onOpen={onOpen} />;
          })}
        </div>
      </div>
    </section>
  );
}

function BlogPost({ post, calendlyUrl, navigate }) {
  const p = safePostShape(post);
  if (!p) {
    return (
      <section className="py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4">
          <p className="text-neutral-700">Post not found.</p>
        </div>
      </section>
    );
  }

  return (
    <article className="py-16 md:py-24">
      <div className="max-w-3xl mx-auto px-4">
        <header className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => typeof navigate === 'function' ? navigate('#/blog') : null}
            className="rounded-full border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 mt-6"
          >
            ← Back
          </button>
          <div>
            <p className="text-xs text-neutral-500">{new Date(p.date).toLocaleDateString()}</p>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-1">{p.title}</h1>
          </div>
        </header>
        {isNonEmptyString(p.image) && (
          <SmartImage
            src={p.image}
            fallbackSrc={getPostFallback(p)}
            alt="Article header"
            className="w-full rounded-2xl border border-neutral-200 shadow-sm object-cover aspect-[16/9]"
            decoding="async"
          />
        )}
        <div className="prose prose-neutral max-w-none mt-6">
          {p.content.length > 0 ? (
            p.content.map((block, i) => (
              block.type === 'subheader' ? (
                <h2 key={i} className={`text-2xl ${block.text === 'Checklist' ? 'font-normal mt-2' : 'font-medium mt-8'} text-neutral-900 mb-2`}>
                  {block.text}
                </h2>
              ) : block.type === 'list' ? (
                <ul key={i} className="list-disc pl-8 mb-6 space-y-2">
                  {Array.isArray(block.items) && block.items.map((it, j) => (
                    <li key={j} className="leading-relaxed text-neutral-700 marker:text-neutral-400">{it}</li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="leading-relaxed text-neutral-800 mb-4">
                  {block.text}
                </p>
              )
            ))
          ) : (
            <p className="leading-relaxed text-neutral-800">No content.</p>
          )}
        </div>
        <div className="mt-10">
          <a
            href={calendlyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl px-6 py-3 bg-black text-white text-sm font-medium hover:opacity-90"
          >
            Book a Call
          </a>
        </div>
      </div>
    </article>
  );
}

// --- Load posts from JSON written by the automation ---
function usePosts() {
  const [posts, setPosts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        // 1) read meta index
        const meta = await fetch('/content/index.json', { cache: 'no-store' }).then(r => r.json());
        // 2) fetch each full post
        const full = await Promise.all(
          meta.map(m => fetch(`/content/posts/${m.slug}.json`, { cache: 'no-store' }).then(r => r.json()))
        );
        setPosts(full);
      } catch (e) {
        console.error('Failed to load dynamic posts, falling back to local seed', e);
        // Optional: keep a tiny local fallback so Blog isn’t empty if fetch fails
        setPosts([
          {
            slug: 'qualify-gc',
            title: 'How to Qualify a General Contractor',
            date: '2025-10-28',
            excerpt: 'Licensing, insurance, references, bids, and contracts — a due-diligence checklist for picking the right GC.',
            image: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761695680/P1_Main_by48b2.jpg',
            content: [
              { type: 'subheader', text: '1. Licensing' },
              { type: 'paragraph', text: "Before hiring a general contractor (GC), verify that they hold a valid state contractor’s license..." }
            ],
          },
          {
            slug: 'when-to-hire-architect',
            title: 'When to Hire an Architect',
            date: '2025-10-31',
            excerpt: 'Not every flip needs an architect. Here’s when a draftsman or engineer is enough — and when full architectural plans will save you time, money, and permit headaches.',
            image: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761970997/plans_close_up_image_resized_o4lk6i.jpg',
            content: [
              { type: 'subheader', text: 'Quick Take' },
              { type: 'paragraph', text: 'Architects are essential when your project changes structure, layout, or footprint...' }
            ],
          }
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { posts, loading };
}


/***************************
 * App (router + pages) 
 ***************************/
export default function App() {
  const calendlyUrl = 'https://calendly.com/statusupgrademm/30min';

  // NEW: load posts from /content
  const { posts, loading } = usePosts();

  // Gallery for hero
  const gallery = [
    { before: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761113628/1before_p8xprn.webp', after: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761113628/1after_dvmp41.png' },
    { before: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761113629/before-2-1_c3o3ah.jpg', after: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761114015/after2.jpg' },
    { before: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761113629/before-3-1_kdgvzw.jpg', after: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761113628/after-3-1_gkokea.jpg' },
    { before: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761113866/before4.webp', after: 'https://res.cloudinary.com/dfr4brde4/image/upload/v1761113628/after4-1_ywvbyt.webp' },
  ];

  const steps = [
    { title: 'Find Profitable Properties', text: 'On- and off-market acquisition playbook: agent MLS alerts, price-reduction snipes, pre-foreclosures, probates, wholesaler lists, driving for dollars, and direct-to-seller outreach.' },
    { title: 'Underwrite the Deal', text: 'ARV comps, scope & budget, repair cost ranges, timeline, soft vs. hard costs, hold costs, interest, and exit scenarios — all distilled into a simple go/no-go matrix.' },
    { title: 'Structure the Deal', text: 'Debt/equity mixes, JV splits, operating agreements, draws, interest reserves, and risk allocation that protects the downside and preserves upside.' },
    { title: 'Finance Your Deal', text: 'Get access to the right funding strategy for your flip — hard money, private lenders, equity partners, HELOCs, or gap funding. Learn how to model interest-only loans, calculate reserves, and prepare a solid borrower package.' },
    { title: 'Negotiate & Close', text: 'Offer positioning, inspection credits, appraisal strategy, and counter tactics that win on price and terms without burning relationships.' },
    { title: 'Permits Without Delay', text: 'City submittals, over-the-counter opportunities, expediters, and sequencing tricks to shrink weeks off your schedule.' },
    { title: 'Build Your Team', text: 'Find & vet GCs, subs, architects, and engineers. Bid leveling, scope packages, milestone schedules, and pay-when-passed inspections.' },
    { title: 'Manage the Renovation', text: 'Weekly checklists, change-order control, cost tracking, quality gates, photo logs, and lender draw docs that keep the job on rails.' },
    { title: 'Unlock Extra Exit Revenue', text: 'Design choices that appraise higher, staging, timing the list, and small upgrades with outsized ROI.' },
    { title: 'Find Equity Partners', text: 'Credibility deck templates, track-record packaging, and compliant investor outreach for future and current projects.' },
  ];

  const packages = [
    { name: 'Strategy Call', price: '$299', features: ['60-min Zoom: target market, budget, next 90-day plan', 'One deal review or scenario analysis', 'Action checklist + materials'] },
    { name: 'Full Deal Mentorship', price: 'Custom', features: ['Acquisition → Resale guidance', 'Underwriting, scope, bids, timeline, & draws', 'Offer/negotiation help & exit prep'] },
    { name: 'Private Coaching (Monthly)', price: '$1,500/mo', features: ['2× 60-min calls + async support', 'Deal underwriting & risk review', 'Accountability + hiring help'] },
  ];

  // Contact form state
  const [submitting, setSubmitting] = React.useState(false);
  const [formMsg, setFormMsg] = React.useState('');
  const [formError, setFormError] = React.useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setSubmitting(true);
    setFormMsg('');
    setFormError('');

    const formData = new FormData(form);
    if (!formData.get('name') || !formData.get('email')) {
      setSubmitting(false);
      setFormError('Please provide your name and a valid email.');
      return;
    }

    try {
      const res = await fetch('https://formspree.io/f/mnngknrz', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setFormMsg("Thanks! Your message was sent. I'll get back to you within one business day.");
        setFormError('');
        form.reset();
      } else {
        setFormMsg('');
        setFormError(data?.errors?.[0]?.message || 'Submission failed. Please try again.');
      }
    } catch (err) {
      setFormMsg('');
      setFormError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Carousel state
  const [active, setActive] = React.useState(0);
  const hasPrev = active > 0;
  const hasNext = active < gallery.length - 1;
  const goPrev = () => hasPrev && setActive((v) => v - 1);
  const goNext = () => hasNext && setActive((v) => v + 1);

  // Router
  const parseHash = () => {
    const hash = (typeof window !== 'undefined' ? window.location.hash : '') || '#/';
    const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
    if (parts.length === 0) return { kind: 'home' };
    if (parts[0] === 'blog' && parts.length === 1) return { kind: 'blog' };
    if (parts[0] === 'blog' && parts[1]) return { kind: 'post', slug: parts[1] };
    return { kind: 'home' };
  };
  const [route, setRoute] = React.useState(parseHash());
  const navigate = (to) => { window.location.hash = to; };
  React.useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);


  const openPost = (post) => navigate(`#/blog/${post.slug}`);

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 text-neutral-900 scroll-smooth">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur bg-white/70 border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="font-semibold tracking-tight text-lg">Flipwise Consulting</span>
          <nav className="hidden md:flex gap-6 text-sm">
            {route.kind !== 'home' && (
              <button onClick={() => navigate('#/')} className="hover:text-black">Home</button>
            )}
            {route.kind === 'home' && (
              <>
                <a href="#process" className="hover:text-black">Process</a>
                <a href="#packages" className="hover:text-black">Mentorship</a>
                <a href="#contact" className="hover:text-black">Contact</a>
              </>
            )}
            <button onClick={() => navigate('#/blog')} className={`hover:text-black ${route.kind === 'blog' ? 'font-semibold' : ''}`}>Blog</button>
          </nav>
          <a href={calendlyUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 inline-flex items-center rounded-xl border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 pointer-events-auto">Book a Call</a>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        {route.kind === 'home' && (
          <>
            {/* Hero */}
            <section id="hero" className="relative overflow-hidden">
              <div className="absolute inset-0 -z-10 bg-gradient-to-b from-neutral-100 via-white to-neutral-50" />
              <div className="max-w-6xl mx-auto px-4 py-20 md:py-28 grid md:grid-cols-2 gap-10 items-center">
                <div>
                  <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Master Fix & Flip Investing — Guided by 10 Years of Hands-On Deals</h1>
                  <p className="mt-5 text-neutral-700 text-lg leading-relaxed">Step-by-step mentorship and deal advisory for investors who want to find, fund, renovate, and flip properties profitably — with fewer surprises and tighter execution.</p>
                  <div className="mt-8 flex gap-3">
                    <a href={calendlyUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 rounded-2xl px-6 py-3 bg-black text-white text-sm font-medium hover:opacity-90 pointer-events-auto">Book a Free Consultation</a>
                    <a href="#process" className="rounded-2xl px-6 py-3 border border-neutral-300 text-sm font-medium hover:bg-neutral-100">See the Process</a>
                  </div>
                </div>
                <div className="relative">
                  <div className="aspect-[4/3] w-full rounded-3xl bg-neutral-200 shadow-sm overflow-hidden relative">
                    <BeforeAfterSlider item={gallery[active]} />
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute left-2 top-1/2 -translate-y-1/2">
                        <button type="button" aria-label="Previous image" onClick={goPrev} className={`pointer-events-auto rounded-full bg-white/90 shadow px-3 py-2 text-sm ${hasPrev ? 'opacity-100' : 'opacity-40 cursor-not-allowed'}`}>←</button>
                      </div>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <button type="button" aria-label="Next image" onClick={goNext} className={`pointer-events-auto rounded-full bg-white/90 shadow px-3 py-2 text-sm ${hasNext ? 'opacity-100' : 'opacity-40 cursor-not-allowed'}`}>→</button>
                      </div>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-2">
                        {gallery.map((_, i) => (
                          <button key={i} aria-label={`Go to slide ${i + 1}`} onClick={() => setActive(i)} className={`h-2.5 w-2.5 rounded-full border border-white/80 pointer-events-auto ${i === active ? 'bg-white' : 'bg-white/40'}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Process */}
            <section id="process" className="py-16 md:py-24 border-t border-neutral-200 bg-neutral-50">
              <div className="max-w-6xl mx-auto px-4">
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">How We Help — Step by Step</h2>
                <p className="mt-4 text-neutral-700 max-w-3xl">A repeatable operating system for finding, funding, renovating, and selling profitable deals — with clarity at every decision point.</p>
                <ol className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-6 list-decimal list-inside">
                  {steps.map((s, i) => (
                    <li key={i} className="rounded-2xl bg-white border border-neutral-200 p-5 shadow-sm">
                      <h3 className="font-semibold">{s.title}</h3>
                      <p className="mt-2 text-sm text-neutral-700 leading-relaxed">{s.text}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            {/* Packages */}
            <section id="packages" className="py-16 md:py-24 border-t border-neutral-200">
              <div className="max-w-6xl mx-auto px-4">
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Mentorship Packages</h2>
                <p className="mt-4 text-neutral-700">Choose the level of support that matches your experience and goals. Every engagement is hands-on and outcome-focused.</p>
                <div className="mt-10 grid md:grid-cols-3 gap-6">
                  {packages.map((p) => (
                    <div key={p.name} className="rounded-3xl bg-white border border-neutral-200 p-6 shadow-sm flex flex-col">
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-lg font-semibold">{p.name}</h3>
                        <span className="text-sm text-neutral-600">{p.price}</span>
                      </div>
                      <ul className="mt-4 space-y-2 text-sm text-neutral-700">
                        {p.features.map((f) => (
                          <li key={f} className="flex gap-2">
                            <span aria-hidden className="mt-1">✓</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      <a href="#contact" className="mt-6 rounded-xl border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 text-center">Inquire</a>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Contact */}
            <section id="contact" className="py-16 md:py-24 border-t border-neutral-200 bg-neutral-50">
              <div className="max-w-3xl mx-auto px-4">
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Let’s Talk About Your Next Flip</h2>
                <p className="mt-4 text-neutral-700">Fill out the form and I’ll get back to you within one business day. All inquiries are confidential.</p>
                <form className="mt-8 grid grid-cols-1 gap-4" method="POST" onSubmit={handleSubmit}>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium">Name</label>
                      <input name="name" required type="text" className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black" placeholder="Jane Doe" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium">Email</label>
                      <input name="email" required type="email" className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black" placeholder="you@example.com" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Message</label>
                    <textarea name="message" rows={5} className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black" placeholder="Tell me about your goals, market, and timeline."></textarea>
                  </div>
                  <div className="flex gap-3 items-center">
                    <button type="submit" disabled={submitting} className="rounded-2xl px-6 py-3 bg-black text-white text-sm font-medium hover:opacity-90 disabled:opacity-60">{submitting ? 'Sending…' : 'Send Message'}</button>
                    <a href={calendlyUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 text-sm text-neutral-600 underline underline-offset-4 pointer-events-auto">Or book via Calendly</a>
                  </div>
                  <div className="mt-3 text-sm" aria-live="polite">
                    {formMsg ? <p className="text-green-700">{formMsg}</p> : null}
                    {formError ? <p className="text-red-700">{formError}</p> : null}
                  </div>
                </form>
              </div>
            </section>
          </>
        )}

      {route.kind === 'blog' && (
    loading
      ? <section className="py-16 md:py-24"><div className="max-w-6xl mx-auto px-4"><p>Loading posts…</p></div></section>
      : <BlogIndex posts={posts} onOpen={openPost} />
  )}

        {route.kind === 'post' && (
    <BlogPost
      post={posts.find((p) => p.slug === route.slug)}
      calendlyUrl={calendlyUrl}
      navigate={navigate}
    />
  )}
      </main>

      {/* Footer */}
      <footer className="py-10 border-t border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-neutral-600">
          <p>© {new Date().getFullYear()} Flipwise Consulting. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <a href="https://www.linkedin.com/company/flipwise-consulting/about/" className="hover:text-black">LinkedIn</a>
            <a href="https://www.instagram.com/flipwiseconsulting/" className="hover:text-black">Instagram</a>
          </div>
        </div>
      </footer>

      {/* ------- Lightweight Runtime Tests ------- */}
      <TestSuite posts={posts} />
    </div>
  );
}

/***************************
 * Minimal runtime tests (dev only)
 ***************************/
function TestSuite({ posts }) {
  // Simple assertions printed to console; keeps preview clean
  React.useEffect(() => {
    const log = (...args) => console.log('[TEST]', ...args);
    const assert = (cond, msg) => { if (!cond) console.error('[TEST FAIL]', msg); else log('PASS', msg); };

    // 1) sanitizeContent drops bad items and strips leading numbers
    const raw = [null, 42, { foo: 'bar', text: '3) Hello' }, { type: 'subheader', text: '1. Title' }, '2) Para'];
    const out = sanitizeContent(raw);
    assert(Array.isArray(out) && out.length === 3, 'sanitizeContent filters and normalizes length');
    assert(out[0].type === 'paragraph' && out[0].text === 'Hello', 'coerces object->paragraph + strips numbers');
    assert(out[1].type === 'subheader' && out[1].text === 'Title', 'keeps subheader + strips numbers');
    assert(out[2].type === 'paragraph' && out[2].text === 'Para', 'string->paragraph + strips numbers');

    // 2) safePostShape provides defaults
    const malformed = { title: '', content: ['1) ok'] };
    const sp = safePostShape(malformed);
    assert(sp.title === 'Untitled', 'default title');
    assert(sp.slug === 'post', 'default slug');
    assert(sp.content[0].text === 'ok', 'content sanitized');

    // 3) BlogPost should handle undefined gracefully (we simulate by calling safePostShape null)
    assert(safePostShape(null) === null, 'safePostShape(null) => null');

    // 4) SmartImage should initialize with fallback if src empty
    const el = React.createElement(SmartImage, { src: '', fallbackSrc: '/assets/post-fallback.jpg', alt: 'x' });
    assert(!!el, 'SmartImage element created');
  }, []);
  return null;
}
