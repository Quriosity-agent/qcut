# Social Proof & Trust Signals

## Overview

Social proof is critical for conversion - it builds trust and validates user decisions. The current landing page lacks any social proof elements.

---

## Recommended Social Proof Elements

### 1. GitHub Stars Badge

**Priority:** P1 (High) - Already have data in footer

**Current Implementation:**
- Footer already fetches GitHub stars via `getStars()`
- Star count is displayed in footer but not prominently

**Recommended Display:**
```tsx
<div className="flex items-center gap-8 justify-center mt-12">
  <a
    href="https://github.com/donghaozhang/qcut"
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/50 hover:bg-secondary transition-colors"
  >
    <FaGithub className="h-5 w-5" />
    <span className="font-medium">{starCount}</span>
    <span className="text-muted-foreground">stars</span>
  </a>

  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/50">
    <Download className="h-5 w-5 text-muted-foreground" />
    <span className="font-medium">10k+</span>
    <span className="text-muted-foreground">downloads</span>
  </div>
</div>
```

### 2. Technology/Integration Logos

**Priority:** P2 (Medium)

Show the AI models and technologies that power QCut:

```tsx
<section className="py-12 border-y border-border">
  <div className="max-w-4xl mx-auto px-4">
    <p className="text-center text-sm text-muted-foreground mb-8">
      Powered by leading AI models
    </p>
    <div className="flex flex-wrap items-center justify-center gap-8 opacity-70">
      {/* Use official logos or text representations */}
      <span className="text-lg font-medium">Sora 2</span>
      <span className="text-lg font-medium">Veo 3</span>
      <span className="text-lg font-medium">Kling</span>
      <span className="text-lg font-medium">Flux</span>
      <span className="text-lg font-medium">FFmpeg</span>
    </div>
  </div>
</section>
```

**Logo Guidelines:**
- Use official SVGs from Simple Icons when available
- Maintain consistent sizing (h-8 or equivalent)
- Add grayscale filter with hover color reveal
- Never guess or use incorrect logos

### 3. User Count / Download Stats

**Priority:** P2 (Medium)

```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
  <div>
    <div className="text-3xl font-bold">40+</div>
    <div className="text-sm text-muted-foreground">AI Models</div>
  </div>
  <div>
    <div className="text-3xl font-bold">10k+</div>
    <div className="text-sm text-muted-foreground">Downloads</div>
  </div>
  <div>
    <div className="text-3xl font-bold">{starCount}</div>
    <div className="text-sm text-muted-foreground">GitHub Stars</div>
  </div>
  <div>
    <div className="text-3xl font-bold">100%</div>
    <div className="text-sm text-muted-foreground">Open Source</div>
  </div>
</div>
```

### 4. Testimonials (Future)

**Priority:** P3 (Low) - Requires user feedback collection

**Structure:**
```tsx
interface Testimonial {
  quote: string;
  author: string;
  role: string;
  avatar?: string;
  company?: string;
}

function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <div className="p-6 rounded-2xl border border-border bg-card">
      <blockquote className="text-lg mb-4 italic">
        "{testimonial.quote}"
      </blockquote>
      <div className="flex items-center gap-3">
        {testimonial.avatar && (
          <img
            src={testimonial.avatar}
            alt=""
            className="h-10 w-10 rounded-full"
          />
        )}
        <div>
          <div className="font-medium">{testimonial.author}</div>
          <div className="text-sm text-muted-foreground">
            {testimonial.role}
            {testimonial.company && ` at ${testimonial.company}`}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Best Practices:**
- Use 3-5 testimonials
- Include photo, name, and role
- Keep quotes concise (1-2 sentences)
- Highlight specific benefits

---

## Placement Strategy

Based on "Hero + Testimonials + CTA" pattern:

```
┌─────────────────────────────────────┐
│            HERO SECTION             │
│  [Headline]                         │
│  [Tagline]                          │
│  [CTAs]                             │
├─────────────────────────────────────┤
│         QUICK STATS BAR             │
│  [Stars] [Downloads] [Models]       │
├─────────────────────────────────────┤
│        TECHNOLOGY LOGOS             │
│  Sora 2 | Veo 3 | Kling | FFmpeg   │
├─────────────────────────────────────┤
│        FEATURES SECTION             │
├─────────────────────────────────────┤
│       TESTIMONIALS (future)         │
├─────────────────────────────────────┤
│          FINAL CTA                  │
├─────────────────────────────────────┤
│            FOOTER                   │
└─────────────────────────────────────┘
```

---

## Animation

### Counter Animation

For stats, add counting animation:

```tsx
import { useInView } from "framer-motion";
import { useRef, useEffect, useState } from "react";

function AnimatedCounter({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (isInView) {
      const duration = 2000;
      const steps = 60;
      const increment = value / steps;
      let current = 0;

      const timer = setInterval(() => {
        current += increment;
        if (current >= value) {
          setCount(value);
          clearInterval(timer);
        } else {
          setCount(Math.floor(current));
        }
      }, duration / steps);

      return () => clearInterval(timer);
    }
  }, [isInView, value]);

  return (
    <span ref={ref}>
      {count.toLocaleString()}{suffix}
    </span>
  );
}
```

### Logo Reveal

```tsx
<motion.div
  initial={{ opacity: 0 }}
  whileInView={{ opacity: 1 }}
  viewport={{ once: true }}
  transition={{ duration: 0.5 }}
  className="flex items-center gap-8"
>
  {logos.map((logo, index) => (
    <motion.div
      key={logo.name}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 0.7, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.1 }}
      whileHover={{ opacity: 1 }}
    >
      {logo.svg}
    </motion.div>
  ))}
</motion.div>
```

---

## Color Strategy

Per landing page pattern research:

| Element | Color |
|---------|-------|
| Stats background | `bg-secondary/50` or transparent |
| Logo strip | Light bg `#F5F5F5` or dark bg `#0A0E27` |
| Testimonial cards | `bg-card` with `border-border` |
| Quote text | Italic, standard `text-foreground` |
| Attribution | `text-muted-foreground` |

---

## Accessibility

### For Stats Section
- [ ] Use `aria-label` for stats that use symbols
- [ ] Ensure counter animations don't cause motion issues
- [ ] Add reduced motion support

### For Logo Section
- [ ] Add `alt` text to all logos
- [ ] If logos are purely decorative, use `aria-hidden="true"`
- [ ] Ensure links (if any) have accessible names

### For Testimonials
- [ ] Use `<blockquote>` for quotes
- [ ] Add `cite` attribute if source available
- [ ] Avatar images should have empty alt (decorative)

---

## Implementation Checklist

### Phase 1: Stats Bar
- [ ] Create stats section component
- [ ] Move GitHub stars fetch to shared hook/store
- [ ] Add download count (may need tracking)
- [ ] Add counter animation
- [ ] Add reduced motion fallback

### Phase 2: Tech Logos
- [ ] Gather official logos (Simple Icons)
- [ ] Create logo strip component
- [ ] Add hover effects
- [ ] Ensure proper sizing consistency

### Phase 3: Testimonials (Future)
- [ ] Set up testimonial data structure
- [ ] Create testimonial card component
- [ ] Build carousel or grid layout
- [ ] Collect real user testimonials

---

## Metrics to Track

| Metric | Purpose |
|--------|---------|
| GitHub star click-through | Interest in open source aspect |
| Time on social proof section | Engagement with trust signals |
| Conversion rate change | Overall impact on sign-ups |
