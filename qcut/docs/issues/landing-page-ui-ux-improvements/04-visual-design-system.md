# Visual Design System for Landing Page

## Overview

This document establishes the visual design system for QCut's landing page, ensuring consistency across all sections and components.

---

## Color System

### Dark Mode Palette (Primary)

Based on UI/UX Pro Max analysis for Dark Mode OLED + SaaS products:

| Role | Hex | RGB | Tailwind | Usage |
|------|-----|-----|----------|-------|
| Background Primary | #000000 | 0, 0, 0 | `bg-black` | Main background |
| Background Secondary | #0A0E27 | 10, 14, 39 | `bg-slate-950` | Section backgrounds |
| Background Elevated | #121212 | 18, 18, 18 | `bg-zinc-900` | Cards, modals |
| Primary | #2563EB | 37, 99, 235 | `bg-blue-600` | CTAs, links, accents |
| Primary Hover | #1D4ED8 | 29, 78, 216 | `bg-blue-700` | Hover states |
| CTA Accent | #F97316 | 249, 115, 22 | `bg-orange-500` | High-visibility CTAs |
| Text Primary | #F8FAFC | 248, 250, 252 | `text-slate-50` | Headings, important text |
| Text Secondary | #94A3B8 | 148, 163, 184 | `text-slate-400` | Body text, descriptions |
| Text Muted | #64748B | 100, 116, 139 | `text-slate-500` | Captions, hints |
| Border | #334155 | 51, 65, 85 | `border-slate-700` | Card borders, dividers |
| Border Hover | #475569 | 71, 85, 105 | `border-slate-600` | Hover borders |

### Light Mode Palette

| Role | Hex | Tailwind | Usage |
|------|-----|----------|-------|
| Background Primary | #FFFFFF | `bg-white` | Main background |
| Background Secondary | #F8FAFC | `bg-slate-50` | Section backgrounds |
| Background Elevated | #FFFFFF | `bg-white` | Cards with shadow |
| Primary | #2563EB | `bg-blue-600` | CTAs, links |
| Text Primary | #0F172A | `text-slate-900` | Headings |
| Text Secondary | #475569 | `text-slate-600` | Body text |
| Text Muted | #64748B | `text-slate-500` | Captions |
| Border | #E2E8F0 | `border-slate-200` | Card borders |

### Accent Colors

| Name | Hex | Usage |
|------|-----|-------|
| Yellow (Brand) | #EAB308 | Handlebars accent |
| Orange (CTA) | #F97316 | Primary CTA buttons |
| Green (Success) | #22C55E | Success states |
| Red (Error) | #EF4444 | Error states |

---

## Typography System

### Font Stack

**Recommended Pairing: Tech Startup**

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
```

```js
// tailwind.config.js
fontFamily: {
  sans: ['DM Sans', 'system-ui', 'sans-serif'],
  heading: ['Space Grotesk', 'system-ui', 'sans-serif'],
}
```

### Type Scale

| Element | Size (Mobile) | Size (Desktop) | Weight | Line Height |
|---------|---------------|----------------|--------|-------------|
| Hero H1 | 36px (text-4xl) | 64px (text-[4rem]) | 700 | 1.1 |
| Section H2 | 30px (text-3xl) | 36px (text-4xl) | 700 | 1.2 |
| Card H3 | 18px (text-lg) | 20px (text-xl) | 600 | 1.3 |
| Body Large | 18px (text-lg) | 20px (text-xl) | 400 | 1.6 |
| Body | 14px (text-sm) | 16px (text-base) | 400 | 1.6 |
| Caption | 12px (text-xs) | 14px (text-sm) | 400 | 1.5 |
| Button | 14px (text-sm) | 14px (text-sm) | 500 | 1 |

### Tracking (Letter Spacing)

| Element | Tracking |
|---------|----------|
| Hero Headline | `tracking-tighter` (-0.05em) |
| Section Headers | `tracking-tight` (-0.025em) |
| Body Text | `tracking-normal` (0) |
| Buttons | `tracking-wide` (0.025em) |

---

## Spacing System

### Base Unit: 4px

Use Tailwind's default spacing scale (multiples of 4px):

| Token | Value | Usage |
|-------|-------|-------|
| space-1 | 4px | Tight spacing (icons) |
| space-2 | 8px | Small gaps |
| space-4 | 16px | Default gaps |
| space-6 | 24px | Card padding |
| space-8 | 32px | Section padding |
| space-12 | 48px | Large gaps |
| space-16 | 64px | Section margins |
| space-24 | 96px | Hero padding |

### Section Spacing

| Section | Top Padding | Bottom Padding |
|---------|-------------|----------------|
| Header | 16px | 0 |
| Hero | 0 | 64px |
| Features | 96px | 96px |
| CTA Banner | 64px | 64px |
| Footer | 40px | 40px |

---

## Border & Radius System

### Border Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| rounded-none | 0 | Sharp edges |
| rounded-sm | 4px | Small elements |
| rounded | 6px | Buttons, inputs |
| rounded-lg | 8px | Tags, badges |
| rounded-xl | 12px | Icon containers |
| rounded-2xl | 16px | Cards, modals |
| rounded-full | 9999px | Pills, avatars |

### Border Width

| Token | Value | Usage |
|-------|-------|-------|
| border | 1px | Default borders |
| border-2 | 2px | Emphasized borders |

---

## Shadow System

### Dark Mode Shadows

Shadows are subtle in dark mode - rely more on borders:

| Token | Value | Usage |
|-------|-------|-------|
| shadow-sm | `0 1px 2px rgba(0,0,0,0.3)` | Subtle depth |
| shadow | `0 4px 6px rgba(0,0,0,0.4)` | Cards |
| shadow-lg | `0 10px 15px rgba(0,0,0,0.5)` | Modals |
| shadow-glow | `0 0 20px rgba(37,99,235,0.3)` | CTA buttons |

### Light Mode Shadows

| Token | Value | Usage |
|-------|-------|-------|
| shadow-sm | `0 1px 2px rgba(0,0,0,0.05)` | Subtle depth |
| shadow | `0 4px 6px rgba(0,0,0,0.1)` | Cards |
| shadow-lg | `0 10px 25px rgba(0,0,0,0.1)` | Modals |

---

## Animation System

### Timing Functions

| Name | Easing | Usage |
|------|--------|-------|
| ease-out | cubic-bezier(0, 0, 0.2, 1) | Enter animations |
| ease-in | cubic-bezier(0.4, 0, 1, 1) | Exit animations |
| ease-in-out | cubic-bezier(0.4, 0, 0.2, 1) | Toggle animations |
| spring | stiffness: 400, damping: 30 | Interactive elements |

### Duration Scale

| Token | Duration | Usage |
|-------|----------|-------|
| duration-150 | 150ms | Micro-interactions |
| duration-200 | 200ms | Hover states |
| duration-300 | 300ms | Transitions |
| duration-500 | 500ms | Page transitions |
| duration-800 | 800ms | Hero animations |

### Common Animations

```tsx
// Fade In
const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.5 }
};

// Slide Up
const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: "easeOut" }
};

// Scale
const scale = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
  transition: { type: "spring", stiffness: 400, damping: 30 }
};
```

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Button Styles

### Primary Button

```tsx
<Button
  className="bg-primary text-primary-foreground hover:bg-primary/90 px-6 py-3 rounded-lg font-medium"
>
  Get Started
</Button>
```

### Secondary/Outline Button

```tsx
<Button
  variant="outline"
  className="border-border hover:bg-accent hover:text-accent-foreground px-6 py-3 rounded-lg font-medium"
>
  Watch Demo
</Button>
```

### Ghost Button

```tsx
<Button
  variant="ghost"
  className="hover:bg-accent hover:text-accent-foreground"
>
  Learn More
</Button>
```

### Button States

| State | Changes |
|-------|---------|
| Default | Base styles |
| Hover | Brightness/opacity change |
| Active/Pressed | Scale down slightly (0.98) |
| Focus | Ring outline (ring-2 ring-primary ring-offset-2) |
| Disabled | opacity-50, cursor-not-allowed |

---

## Card Styles

### Feature Card

```tsx
<div className="
  p-6
  rounded-2xl
  border border-border
  bg-card
  hover:border-primary/50
  transition-colors duration-200
  cursor-pointer
">
  {/* Content */}
</div>
```

### Elevated Card (Light Mode)

```tsx
<div className="
  p-6
  rounded-2xl
  bg-white
  shadow-lg
  hover:shadow-xl
  transition-shadow duration-200
">
  {/* Content */}
</div>
```

---

## Gradient Backgrounds

### Hero Gradient

```tsx
<div className="bg-gradient-to-b from-black via-slate-950 to-slate-900">
```

### Accent Gradient (CTA)

```tsx
<div className="bg-gradient-to-r from-blue-600 to-purple-600">
```

### Subtle Gradient (Section Divider)

```tsx
<div className="bg-gradient-to-b from-background to-background/80">
```

---

## Icon Styles

### Icon Sizes

| Context | Size | Tailwind |
|---------|------|----------|
| Inline with text | 16px | `h-4 w-4` |
| Button icon | 16-20px | `h-4 w-4` or `h-5 w-5` |
| Feature card icon | 24px | `h-6 w-6` |
| Large display icon | 32-48px | `h-8 w-8` or `h-12 w-12` |

### Icon Colors

- Default: `text-muted-foreground`
- Hover: `text-foreground`
- Accent: `text-primary`
- Disabled: `text-muted-foreground/50`

### Icon Container

```tsx
<div className="
  h-12 w-12
  rounded-xl
  bg-primary/10
  flex items-center justify-center
  group-hover:bg-primary/20
  transition-colors
">
  <Wand2 className="h-6 w-6 text-primary" />
</div>
```

---

## Responsive Breakpoints

| Name | Breakpoint | Target Devices |
|------|------------|----------------|
| xs | < 640px | Mobile phones |
| sm | 640px | Large phones |
| md | 768px | Tablets |
| lg | 1024px | Laptops |
| xl | 1280px | Desktops |
| 2xl | 1536px | Large desktops |

### Mobile-First Approach

```tsx
<h1 className="
  text-4xl      /* Mobile: 36px */
  md:text-5xl   /* Tablet: 48px */
  lg:text-[4rem] /* Desktop: 64px */
">
```

---

## Z-Index Scale

| Layer | Z-Index | Usage |
|-------|---------|-------|
| Base | 0 | Default content |
| Elevated | 10 | Cards with shadow |
| Sticky Header | 50 | Fixed navigation |
| Modal Backdrop | 40 | Modal overlay |
| Modal Content | 50 | Modal dialogs |
| Tooltip | 60 | Tooltips, popovers |
| Toast | 70 | Toast notifications |

---

## Dark/Light Mode Tokens

### CSS Custom Properties

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --border: 214.3 31.8% 91.4%;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --card-foreground: 210 40% 98%;
  --primary: 217.2 91.2% 59.8%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
}
```

---

## Implementation Checklist

### Typography
- [ ] Import Google Fonts (Space Grotesk + DM Sans)
- [ ] Configure Tailwind font families
- [ ] Apply consistent heading styles
- [ ] Ensure proper line heights

### Colors
- [ ] Verify all colors use semantic tokens
- [ ] Test dark mode contrast ratios
- [ ] Test light mode contrast ratios
- [ ] Ensure focus states are visible

### Spacing
- [ ] Use consistent spacing scale
- [ ] Verify responsive padding/margins
- [ ] Check section spacing consistency

### Components
- [ ] Standardize button styles
- [ ] Standardize card styles
- [ ] Standardize icon usage
- [ ] Add hover/focus states to all interactive elements

### Accessibility
- [ ] Verify color contrast (WCAG AA minimum)
- [ ] Test with reduced motion preference
- [ ] Ensure all text is readable
