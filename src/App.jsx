import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Mail, Phone, CheckCircle2, Facebook, Twitter, Linkedin, Instagram, Menu, X } from "lucide-react";

/***************************
 * Utilities (defensive)
 ***************************/
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function sanitizeContent(raw) {
  if (!Array.isArray(raw)) return [];
  const stripLeadNums = (s) => String(s ?? '').replace(/^\s*\d+[\.)]?\s*/, '');
  return raw
    .map((b) => {
      if (!b) return null;
      
      if (typeof b === 'object' && b.type === 'list' && Array.isArray(b.items)) {
        return {
          type: 'list',
          items: b.items.map(item => stripLeadNums(String(item))).filter(isNonEmptyString)
        };
      }
      
      if (typeof b === 'object' && (b.type === 'subheader' || b.type === 'paragraph')) {
        return { type: b.type, text: stripLeadNums(b.text) };
      }
      
      if (typeof b === 'object' && 'text' in b) {
        return { type: 'paragraph', text: stripLeadNums(b.text) };
      }
      
      return { type: 'paragraph', text: stripLeadNums(b) };
    })
    .filter((b) => {
      if (b?.type === 'list') return b.items.length > 0;
      return b && isNonEmptyString(b.text);
    });
}

function getDisplayDate(p) {
  const u = p?.updatedAt ? new Date(p.updatedAt) : null;
  const c = p?.createdAt ? new Date(p.createdAt) : (p?.date ? new Date(p.date) : null);
  const d = u && (!c || u > c) ? u : c;
  return d ? d.toLocaleDateString() : '';
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
 * Smart image with fallback (Original → Cloudinary → /post-fallback.jpg)
 ***************************/
const FALLBACK_CLOUDINARY = 'https://res.cloudinary.com/dfr4brde4/image/upload/v1762755537/post-fallback_zwaacw.jpg';
const FALLBACK_LOCAL = '/post-fallback.jpg'; // place this in /public

// Hook that resolves to the first loadable URL from a list of candidates.
function useImageWithFallback(src) {
  const [resolved, setResolved] = useState(
    isNonEmptyString(src) ? src : (FALLBACK_CLOUDINARY || FALLBACK_LOCAL)
  );

  useEffect(() => {
    let cancelled = false;

    const candidates = [
      isNonEmptyString(src) ? src : null,
      FALLBACK_CLOUDINARY,
      FALLBACK_LOCAL,
    ].filter(Boolean);

    (async () => {
      for (const url of candidates) {
        try {
          await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = reject;
            img.src = url;
          });
          if (!cancelled) setResolved(url);
          break;
        } catch {
          // try next
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}

// <img/> component version (used in BlogPost hero image)
function SmartImage({ src, alt = '', className = '', ...rest }) {
  const url = useImageWithFallback(src);
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      {...rest}
    />
  );
}

function getPostFallback() {
  return FALLBACK_LOCAL; // always a known-good public file
}

/***************************
 * Before/After Slider (Home hero)
 ***************************/
function BeforeAfterSlider({ item }) {
  const [pos, setPos] = useState(50);
  const trackRef = useRef(null);

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
      className="relative w-full h-full select-none overflow-hidden rounded-lg"
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

  // Resolve a final, loadable URL for use as a CSS background
  const bgSrc = useImageWithFallback(p.image);

  return (
    <article className="overflow-hidden hover-elevate active-elevate-2 transition-all h-full flex flex-col rounded-lg border border-border bg-card shadow-sm">
      {/* Background image area with cross-fade */}
      <div className="aspect-video relative overflow-hidden">
        <motion.div
          key={bgSrc}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="absolute inset-0"
          style={{
            backgroundImage: `url('${bgSrc || getPostFallback()}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent pointer-events-none" />
      </div>
      
      <div className="p-6 flex-1 flex flex-col">
        <h3 className="text-xl font-bold mb-2 line-clamp-2">{p.title}</h3>
        <p className="text-sm text-muted-foreground mb-2">{getDisplayDate(p)}</p>
        <p className="text-muted-foreground line-clamp-3 mb-4 flex-1">{p.excerpt}</p>
        
        <button
          type="button"
          onClick={() => typeof onOpen === 'function' ? onOpen(p) : null}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background border border-input hover-elevate active-elevate-2 h-9 px-4 py-2 w-full"
          aria-label={`Read: ${p.title}`}
        >
          Read More →
        </button>
      </div>
    </article>
  );
}

function BlogIndex({ posts, onOpen }) {
  const list = Array.isArray(posts) ? posts : [];
  return (
    <section id="blog" className="py-16 md:py-24 bg-background">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Blog</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Guides, checklists, and playbooks from active deals
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
    <article className="py-12 bg-background">
      <div className="max-w-3xl mx-auto px-6">
        <button
          type="button"
          onClick={() => typeof navigate === 'function' ? navigate('#/blog') : null}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none hover-elevate active-elevate-2 h-9 px-4 py-2 mb-6"
        >
          ← Back to Blog
        </button>

        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold mb-6">{p.title}</h1>
          <div className="flex items-center gap-6 text-muted-foreground">
            <span className="text-sm">{getDisplayDate(p)}</span>
          </div>
        </div>

        {isNonEmptyString(p.image) && (
          <div className="aspect-video mb-8 rounded-lg overflow-hidden border border-border shadow-sm">
            <SmartImage
              src={p.image}
              alt={p.title}
              className="w-full h-full object-cover"
              decoding="async"
            />
          </div>
        )}

        <div className="prose prose-lg max-w-none">
          {p.content.length > 0 ? (
            p.content.map((block, i) => (
              block.type === 'subheader' ? (
                <h2 key={i} className={`text-2xl ${block.text === 'Checklist' ? 'font-normal mt-2' : 'font-semibold mt-8'} mb-4`}>
                  {block.text}
                </h2>
              ) : block.type === 'list' ? (
                <ul key={i} className="list-disc pl-8 mb-6 space-y-2">
                  {Array.isArray(block.items) && block.items.map((it, j) => (
                    <li key={j} className="leading-relaxed text-muted-foreground">{it}</li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="leading-relaxed mb-4">
                  {block.text}
                </p>
              )
            ))
          ) : (
            <p className="leading-relaxed">No content available.</p>
          )}
        </div>

        <div className="mt-10 pt-8 border-t">
          <a
            href={calendlyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none bg-primary text-primary-foreground hover-elevate active-elevate-2 h-10 py-2 px-6"
          >
            Book a Call
          </a>
        </div>

        <div className="mt-8">
          <button
            type="button"
            onClick={() => typeof navigate === 'function' ? navigate('#/blog') : null}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none border border-input hover-elevate active-elevate-2 h-9 px-4 py-2"
          >
            View More Articles
          </button>
        </div>
      </div>
    </article>
  );
}

function usePosts() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const q = `?v=${Date.now()}`;
        const meta = await fetch(`/content/index.json${q}`, { cache: 'no-store' }).then(r => r.json());
        const full = await Promise.all(
          meta.map(m => fetch(`/content/posts/${m.slug}.json${q}`, { cache: 'no-store' }).then(r => r.json()))
        );
        setPosts(full.sort((a, b) => {
          const da = new Date(a.updatedAt || a.createdAt || a.date || 0).getTime();
          const db = new Date(b.updatedAt || b.createdAt || b.date || 0).getTime();
          return db - da;
        }));
      } catch (e) {
        console.error('Failed to load dynamic posts, falling back to local seed', e);
        setPosts([]);
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

  const { posts, loading } = usePosts();

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

  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState('');
  const [formError, setFormError] = useState('');

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

  const [active, setActive] = useState(0);
  const hasPrev = active > 0;
  const hasNext = active < gallery.length - 1;
  const goPrev = () => hasPrev && setActive((v) => v - 1);
  const goNext = () => hasNext && setActive((v) => v + 1);

  const parseHash = () => {
    const hash = (typeof window !== 'undefined' ? window.location.hash : '') || '#/';
    const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
    if (parts.length === 0) return { kind: 'home' };
    if (parts[0] === 'blog' && parts.length === 1) return { kind: 'blog' };
    if (parts[0] === 'blog' && parts[1]) return { kind: 'post', slug: parts[1] };
    return { kind: 'home' };
  };
  const [route, setRoute] = useState(parseHash());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = (to) => { window.location.hash = to; setMobileMenuOpen(false); };
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (route.kind === 'blog' || route.kind === 'post') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [route]);

  const openPost = (post) => navigate(`#/blog/${post.slug}`);

  return (
    <div className="min-h-screen flex flex-col scroll-smooth">
      <header className="sticky top-0 z-40 backdrop-blur bg-background/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-bold tracking-tight text-xl">Flipwise Consulting</span>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex gap-8 text-sm font-medium">
            {route.kind !== 'home' && (
              <button onClick={() => { navigate('#/'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-primary transition-colors">Home</button>
            )}
            {route.kind === 'home' && (
              <>
                <a href="#process" className="hover:text-primary transition-colors">Process</a>
                <a href="#packages" className="hover:text-primary transition-colors">Mentorship</a>
                <a href="#contact" className="hover:text-primary transition-colors">Contact</a>
              </>
            )}
            <button onClick={() => navigate('#/blog')} className={`hover:text-primary transition-colors ${route.kind === 'blog' ? 'text-primary' : ''}`}>Blog</button>
          </nav>

          {/* Desktop Book a Call Button */}
          <a href={calendlyUrl} target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors border border-input hover-elevate active-elevate-2 h-9 px-4 py-2">Book a Call</a>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden inline-flex items-center justify-center rounded-md p-2 hover-elevate active-elevate-2"
            aria-label="Toggle menu"
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background">
            <nav className="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-4">
              {route.kind !== 'home' && (
                <button
                  onClick={() => { navigate('#/'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="text-left hover:text-primary transition-colors font-medium"
                  data-testid="link-mobile-home"
                >
                  Home
                </button>
              )}
              {route.kind === 'home' && (
                <>
                  <a href="#process" onClick={() => setMobileMenuOpen(false)} className="hover:text-primary transition-colors font-medium" data-testid="link-mobile-process">Process</a>
                  <a href="#packages" onClick={() => setMobileMenuOpen(false)} className="hover:text-primary transition-colors font-medium" data-testid="link-mobile-mentorship">Mentorship</a>
                  <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="hover:text-primary transition-colors font-medium" data-testid="link-mobile-contact">Contact</a>
                </>
              )}
              <button
                onClick={() => navigate('#/blog')}
                className={`text-left hover:text-primary transition-colors font-medium ${route.kind === 'blog' ? 'text-primary' : ''}`}
                data-testid="link-mobile-blog"
              >
                Blog
              </button>
              <a
                href={calendlyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover-elevate active-elevate-2 h-10 py-2 px-6 mt-2"
                data-testid="button-mobile-book-call"
              >
                Book a Call
              </a>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        {route.kind === 'home' && (
          <>
            <section id="hero" className="relative overflow-hidden bg-gradient-to-b from-card via-background to-card">
              <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
                <div className="grid md:grid-cols-2 gap-10 items-center">
                  <div>
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Master Fix & Flip Investing — Guided by 10 Years of Hands-On Deals</h1>
                    <p className="mt-5 text-muted-foreground text-lg leading-relaxed">Step-by-step mentorship and deal advisory for investors who want to find, fund, renovate, and flip properties profitably — with fewer surprises and tighter execution.</p>
                    <div className="mt-8 flex flex-wrap gap-3">
                      <a href={calendlyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover-elevate active-elevate-2 h-10 py-2 px-6">Book a Free Consultation</a>
                      <a href="#process" className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input hover-elevate active-elevate-2 h-10 py-2 px-6">See the Process</a>
                    </div>
                  </div>

                  <div className="relative">
                    <div className="aspect-[4/3] w-full rounded-lg shadow-lg overflow-hidden relative">
                      <BeforeAfterSlider item={gallery[active]} />
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 z-30">
                        <button
                          type="button"
                          onClick={goPrev}
                          disabled={!hasPrev}
                          className="inline-flex items-center justify-center rounded-full h-9 w-9 bg-secondary hover-elevate active-elevate-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                          aria-label="Previous image"
                        >
                          ←
                        </button>
                      </div>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 z-30">
                        <button
                          type="button"
                          onClick={goNext}
                          disabled={!hasNext}
                          className="inline-flex items-center justify-center rounded-full h-9 w-9 bg-secondary hover-elevate active-elevate-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                          aria-label="Next image"
                        >
                          →
                        </button>
                      </div>
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex gap-1">
                        {gallery.map((_, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => setActive(index)}
                            className="inline-flex items-center justify-center h-9 w-9 hover:bg-transparent"
                            aria-label={`Go to slide ${index + 1}`}
                          >
                            <span className={`block rounded-full transition-all ${index === active ? 'bg-white w-6 h-2.5' : 'bg-white/50 w-2.5 h-2.5'}`} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section id="process" className="py-20 bg-background">
              <div className="max-w-7xl mx-auto px-6">
                <div className="text-center mb-12">
                  <h2 className="text-3xl md:text-4xl font-bold mb-4">The Process</h2>
                  <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                    A proven framework to guide you from property acquisition to profitable exit
                  </p>
                </div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {steps.map((step, index) => (
                    <div key={index} className="rounded-lg border border-border bg-card p-6 shadow-sm hover-elevate">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
                          {index + 1}
                        </div>
                        <h3 className="font-bold text-lg">{step.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{step.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section id="packages" className="py-20 bg-card">
              <div className="max-w-7xl mx-auto px-6">
                <div className="text-center mb-12">
                  <h2 className="text-3xl md:text-4xl font-bold mb-4">Mentorship Programs</h2>
                  <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                    Choose the level of support that fits your investment goals
                  </p>
                </div>
                <div className="grid md:grid-cols-3 gap-8">
                  {packages.map((pkg, i) => (
                    <div key={i} className="rounded-lg border border-border bg-background p-6 shadow-sm hover-elevate active-elevate-2 transition-all flex flex-col">
                      <h3 className="font-bold text-xl mb-2">{pkg.name}</h3>
                      <div className="mt-4">
                        <span className="text-3xl font-bold">{pkg.price}</span>
                      </div>
                      <ul className="space-y-3 mb-6 mt-6 flex-1">
                        {pkg.features.map((feature, j) => (
                          <li key={j} className="flex items-start gap-2">
                            <svg className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="text-sm">{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <a href={calendlyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover-elevate active-elevate-2 h-10 py-2 px-4 w-full">Get Started</a>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section id="contact" className="py-20 bg-background">
              <div className="max-w-7xl mx-auto px-6">
                <div className="text-center mb-12">
                  <h2 className="text-3xl md:text-4xl font-bold mb-4">Get In Touch</h2>
                  <p className="text-lg text-muted-foreground">Ready to start your fix and flip journey? Contact us today for a free consultation.</p>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                  {/* Left Column: Contact Form */}
                  <div className="rounded-lg border border-border bg-card p-6 md:p-8">
                    <h3 className="text-2xl font-bold mb-2">Send Us a Message</h3>
                    <p className="text-sm text-muted-foreground mb-6">Fill out the form below and we'll respond within 24 hours</p>
                    
                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div>
                        <label htmlFor="name" className="block text-sm font-medium mb-2">Name *</label>
                        <input type="text" id="name" name="name" required className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" />
                      </div>
                      <div>
                        <label htmlFor="email" className="block text-sm font-medium mb-2">Email *</label>
                        <input type="email" id="email" name="email" required className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" />
                      </div>
                      <div>
                        <label htmlFor="phone" className="block text-sm font-medium mb-2">Phone</label>
                        <input type="tel" id="phone" name="phone" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" />
                      </div>
                      <div>
                        <label htmlFor="message" className="block text-sm font-medium mb-2">Message *</label>
                        <textarea id="message" name="message" rows={5} required className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"></textarea>
                      </div>
                      {formMsg && <p className="text-sm text-green-600">{formMsg}</p>}
                      {formError && <p className="text-sm text-destructive">{formError}</p>}
                      <button type="submit" disabled={submitting} className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover-elevate active-elevate-2 h-10 px-8 py-2 w-full disabled:opacity-50 disabled:pointer-events-none">
                        {submitting ? 'Sending...' : 'Send Message'}
                      </button>
                    </form>
                  </div>

                  {/* Right Column: Contact Info Cards */}
                  <div className="space-y-4">
                    {/* Office Hours */}
                    <div className="rounded-lg border border-border bg-card p-6 flex gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <Clock className="w-5 h-5 text-primary" />
                        </div>
                      </div>
                      <div>
                        <h4 className="font-bold mb-2">Office Hours</h4>
                        <p className="text-sm text-muted-foreground">Monday - Friday: 9:00 AM - 6:00 PM EST</p>
                        <p className="text-sm text-muted-foreground">Weekend: By Appointment Only</p>
                      </div>
                    </div>

                    {/* Email */}
                    <div className="rounded-lg border border-border bg-card p-6 flex gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <Mail className="w-5 h-5 text-primary" />
                        </div>
                      </div>
                      <div>
                        <h4 className="font-bold mb-2">Email</h4>
                        <p className="text-sm text-muted-foreground">info@flipadvisory.com</p>
                      </div>
                    </div>

                    {/* Phone */}
                    <div className="rounded-lg border border-border bg-card p-6 flex gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <Phone className="w-5 h-5 text-primary" />
                        </div>
                      </div>
                      <div>
                        <h4 className="font-bold mb-2">Phone</h4>
                        <p className="text-sm text-muted-foreground"> (424) 298-5731</p>
                      </div>
                    </div>

                    {/* Why Choose Us */}
                    <div className="rounded-lg border border-border bg-card p-6 flex gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5 text-primary" />
                        </div>
                      </div>
                      <div>
                        <h4 className="font-bold mb-2">Why Choose Us</h4>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>• 10+ Years Experience</li>
                          <li>• 50+ Successful Flips</li>
                          <li>• Personalized Approach</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {route.kind === 'blog' && <BlogIndex posts={posts} onOpen={openPost} />}

        {route.kind === 'post' && (
          <BlogPost
            post={posts.find(p => p.slug === route.slug)}
            calendlyUrl={calendlyUrl}
            navigate={navigate}
          />
        )}
      </main>

      <footer className="bg-card border-t border-border py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Flipwise Consulting. All rights reserved.
            </p>

            <div className="flex gap-6">
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-social-linkedin">
                LinkedIn
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-social-instagram">
                Instagram
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
