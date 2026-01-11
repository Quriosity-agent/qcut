# Features Section UI/UX Design

## Current State

**Issue:** The landing page currently lacks a features section. Users land on the hero and immediately see the footer - there's no content explaining what QCut can do.

---

## Recommended Features Section

### Section Structure

Based on "Hero + Features + CTA" landing page pattern:

```
┌─────────────────────────────────────────────────────────┐
│                     HERO SECTION                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│               Powerful Features for                     │
│               Modern Video Creation                     │
│                                                         │
│  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐            │
│  │ AI    │  │ Video │  │ AI    │  │ Multi │            │
│  │ Video │  │ Upscale│ │ Avatar│  │ Track │            │
│  │ Gen   │  │       │  │       │  │ Editor│            │
│  └───────┘  └───────┘  └───────┘  └───────┘            │
│                                                         │
│  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐            │
│  │ Text  │  │ Nano  │  │ Export│  │ Open  │            │
│  │ to    │  │ Edit  │  │ Any   │  │ Source│            │
│  │ Video │  │       │  │ Format│  │       │            │
│  └───────┘  └───────┘  └───────┘  └───────┘            │
│                                                         │
├─────────────────────────────────────────────────────────┤
│               [Try QCut Free]                           │
├─────────────────────────────────────────────────────────┤
│                     FOOTER                              │
└─────────────────────────────────────────────────────────┘
```

---

## Feature Cards Design

### Primary Features (Top 4)

| Feature | Icon | Title | Description |
|---------|------|-------|-------------|
| AI Video Generation | Wand/Sparkles | AI Video Generation | Create videos from text or images using Sora 2, Veo 3, Kling, and 40+ AI models |
| Video Upscaling | ArrowsExpand | 4K/8K Upscaling | Enhance video quality with Topaz, FlashVSR, and AI-powered upscaling |
| AI Avatars | User | AI Avatars | Generate talking head videos with Kling Avatar and Hailuo |
| Multi-Track Editor | Layers | Professional Timeline | Multi-track video editing with precision controls |

### Secondary Features (Bottom 4)

| Feature | Icon | Title | Description |
|---------|------|-------|-------------|
| Text to Video | Type | Text to Video | Describe your vision in text, get professional videos |
| Nano Edit | ImageEdit | AI Image Editing | Edit and generate images with AI-powered tools |
| Export Options | Download | Universal Export | Export to any format, any resolution, any platform |
| Open Source | GitBranch | Open Source | Free forever, community-driven development |

---

## Feature Card Component

### Design Specifications

```tsx
interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <motion.div
      className="group p-6 rounded-2xl border border-border bg-card hover:border-primary/50 transition-colors cursor-pointer"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      whileHover={{ scale: 1.02 }}
    >
      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
    </motion.div>
  );
}
```

### Visual Style

| Property | Value |
|----------|-------|
| Background | `bg-card` (adapts to theme) |
| Border | `border-border` default, `border-primary/50` on hover |
| Border Radius | `rounded-2xl` (16px) |
| Padding | `p-6` (24px) |
| Icon Container | 48x48px, rounded-xl, bg-primary/10 |
| Spacing | 16px gap between cards |

---

## Section Layout

### Grid Configuration

```tsx
<section className="py-24 px-4 bg-background">
  <div className="max-w-6xl mx-auto">
    {/* Section Header */}
    <div className="text-center mb-16">
      <motion.h2
        className="text-3xl md:text-4xl font-bold mb-4"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        Powerful Features for
        <br />
        Modern Video Creation
      </motion.h2>
      <motion.p
        className="text-lg text-muted-foreground max-w-2xl mx-auto"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.2 }}
      >
        Everything you need to create professional videos, powered by cutting-edge AI.
      </motion.p>
    </div>

    {/* Features Grid */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {features.map((feature, index) => (
        <FeatureCard
          key={feature.title}
          {...feature}
          // Stagger animation based on index
        />
      ))}
    </div>
  </div>
</section>
```

### Responsive Behavior

| Breakpoint | Columns | Gap |
|------------|---------|-----|
| Mobile (< 640px) | 1 column | 16px |
| Tablet (640px - 1024px) | 2 columns | 16px |
| Desktop (> 1024px) | 4 columns | 24px |

---

## Animation Specifications

### Scroll-Triggered Animations

```tsx
// Staggered entrance animation
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2
    }
  }
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: "easeOut"
    }
  }
};
```

### Hover States

| State | Animation |
|-------|-----------|
| Default | scale: 1, border-color: border |
| Hover | scale: 1.02, border-color: primary/50 |
| Focus | ring-2 ring-primary ring-offset-2 |

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .feature-card {
    animation: none;
    transition: none;
  }
}
```

---

## Icon Guidelines

### Icon Library

Use Lucide React for consistency with existing codebase:

```tsx
import {
  Wand2,
  ArrowsMaximize,
  User,
  Layers,
  Type,
  ImageOff,
  Download,
  GitBranch
} from 'lucide-react';
```

### Icon Sizing

| Context | Size |
|---------|------|
| Feature Card Icon | 24x24 (`h-6 w-6`) |
| Icon Container | 48x48 (`h-12 w-12`) |

### Icon Colors

- Default: `text-primary`
- On hover: Maintain `text-primary`
- Container background: `bg-primary/10` default, `bg-primary/20` on hover

---

## Alternative Layouts

### Option A: Bento Grid (Recommended for Visual Impact)

```
┌────────────────┬────────┬────────┐
│                │   AI   │  AI    │
│  AI Video Gen  │ Upscale│ Avatar │
│  (Large Card)  │        │        │
├────────────────┼────────┼────────┤
│  Multi-Track   │ Text   │  Nano  │
│    Editor      │ to Vid │  Edit  │
├────────────────┴────────┼────────┤
│      Export Options     │  OSS   │
└─────────────────────────┴────────┘
```

### Option B: Alternating Feature Rows

```
┌─────────────────────────────────────┐
│  [Image]  │  AI Video Generation   │
│           │  Description text...    │
├───────────┼─────────────────────────┤
│  Video    │  [Image]                │
│  Upscale  │                         │
└───────────┴─────────────────────────┘
```

### Option C: Icon Strip + Details

```
┌─────────────────────────────────────┐
│  [AI] [Upscale] [Avatar] [Editor]  │ ← Clickable icons
├─────────────────────────────────────┤
│                                     │
│  Selected Feature Details           │ ← Changes on click
│  with demo/screenshot               │
│                                     │
└─────────────────────────────────────┘
```

---

## Content Strategy

### Headline Options

1. "Powerful Features for Modern Video Creation"
2. "Everything You Need to Create Amazing Videos"
3. "AI-Powered Video Editing, Simplified"
4. "Professional Tools. Zero Learning Curve."

### Description Tone

- **Do:** Use action verbs, specific numbers, clear benefits
- **Don't:** Use jargon, vague promises, overly technical language

### Examples

| Bad | Good |
|-----|------|
| "Advanced video processing capabilities" | "Upscale any video to 4K in seconds" |
| "Integrated AI features" | "40+ AI models at your fingertips" |
| "Comprehensive editing tools" | "Multi-track timeline with precision controls" |

---

## Technical Implementation

### File Structure

```
components/landing/
├── features-section.tsx    # Main section component
├── feature-card.tsx        # Reusable card component
└── features-data.ts        # Feature content data
```

### Feature Data Structure

```typescript
// features-data.ts
import { Wand2, ArrowsMaximize, User, Layers } from 'lucide-react';

export const features = [
  {
    icon: Wand2,
    title: "AI Video Generation",
    description: "Create videos from text or images using Sora 2, Veo 3, Kling, and 40+ AI models"
  },
  // ... more features
] as const;
```

---

## Implementation Checklist

### Design
- [ ] Create feature card component
- [ ] Implement grid layout with responsive columns
- [ ] Add section header with headline and subtext
- [ ] Design icon containers with proper sizing

### Content
- [ ] Write compelling feature titles
- [ ] Write concise, benefit-focused descriptions
- [ ] Select appropriate icons from Lucide

### Animation
- [ ] Add scroll-triggered entrance animations
- [ ] Implement staggered reveal for cards
- [ ] Add subtle hover scale effect
- [ ] Add `prefers-reduced-motion` support

### Accessibility
- [ ] Ensure proper heading hierarchy (h2 for section title)
- [ ] Add proper alt text to any images
- [ ] Ensure focus states are visible
- [ ] Test keyboard navigation through cards

### Performance
- [ ] Use `viewport={{ once: true }}` to prevent re-animation
- [ ] Lazy load any images
- [ ] Minimize animation complexity for mobile

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Scroll depth to features | 60%+ of visitors |
| Time spent on features section | 10+ seconds average |
| Click-through from features to CTA | 15%+ |
| Hover interactions on cards | 30%+ of visitors |
