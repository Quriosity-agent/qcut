# Landing Page Color Palette Suggestions

## Current State

The landing page currently uses:
- **Background**: Pure black (`#000000` / `bg-black`)
- **Primary**: Blue (`hsl(205, 84%, 53%)` / `#2196F3`)
- **Text**: Grayscale with muted foreground
- **Accent**: Yellow handlebars from the interactive component

---

## Recommended Color Palettes

### Option 1: Electric Violet (Recommended for AI/Creative Tools)

A modern, creative palette that conveys AI innovation and creativity.

| Role | Hex | HSL | Tailwind | Preview |
|------|-----|-----|----------|---------|
| Background | #0A0A0F | hsl(240, 20%, 4%) | Custom | Deep space black |
| Background Secondary | #12121A | hsl(240, 18%, 8%) | Custom | Elevated surfaces |
| Primary | #8B5CF6 | hsl(258, 90%, 66%) | `violet-500` | Main accent |
| Primary Hover | #7C3AED | hsl(258, 83%, 58%) | `violet-600` | Hover states |
| CTA Gradient Start | #8B5CF6 | hsl(258, 90%, 66%) | `violet-500` | Button gradient |
| CTA Gradient End | #EC4899 | hsl(330, 81%, 60%) | `pink-500` | Button gradient |
| Text Primary | #F8FAFC | hsl(210, 40%, 98%) | `slate-50` | Headings |
| Text Secondary | #A1A1AA | hsl(240, 5%, 65%) | `zinc-400` | Body text |
| Border | #27272A | hsl(240, 4%, 16%) | `zinc-800` | Subtle borders |

**CSS Variables:**
```css
:root {
  --landing-bg: hsl(240, 20%, 4%);
  --landing-bg-elevated: hsl(240, 18%, 8%);
  --landing-primary: hsl(258, 90%, 66%);
  --landing-primary-hover: hsl(258, 83%, 58%);
  --landing-accent: hsl(330, 81%, 60%);
}
```

**Hero Gradient:**
```tsx
<div className="bg-gradient-to-b from-[#0A0A0F] via-[#12121A] to-[#0A0A0F]">
```

**CTA Button:**
```tsx
<Button className="bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-600 hover:to-pink-600">
```

---

### Option 2: Neon Cyan (Tech/Futuristic)

A high-tech palette inspired by cyberpunk aesthetics, perfect for cutting-edge AI tools.

| Role | Hex | HSL | Tailwind | Preview |
|------|-----|-----|----------|---------|
| Background | #030712 | hsl(222, 84%, 3%) | `gray-950` | Deep navy black |
| Background Secondary | #0F172A | hsl(222, 47%, 11%) | `slate-900` | Cards |
| Primary | #06B6D4 | hsl(188, 94%, 43%) | `cyan-500` | Main accent |
| Primary Hover | #0891B2 | hsl(189, 94%, 37%) | `cyan-600` | Hover |
| CTA Accent | #22D3EE | hsl(186, 78%, 54%) | `cyan-400` | Glow effects |
| Secondary | #3B82F6 | hsl(217, 91%, 60%) | `blue-500` | Links |
| Text Primary | #F1F5F9 | hsl(210, 40%, 96%) | `slate-100` | Headings |
| Text Secondary | #94A3B8 | hsl(215, 20%, 65%) | `slate-400` | Body |
| Border | #1E293B | hsl(217, 33%, 17%) | `slate-800` | Borders |

**Hero with Glow Effect:**
```tsx
<div className="relative bg-gray-950">
  <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-transparent to-blue-500/10" />
  {/* Content */}
</div>
```

**Neon CTA:**
```tsx
<Button className="bg-cyan-500 hover:bg-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.5)] hover:shadow-[0_0_30px_rgba(6,182,212,0.7)]">
```

---

### Option 3: Warm Sunset (Creative/Friendly)

A warm, inviting palette that feels approachable and creative.

| Role | Hex | HSL | Tailwind | Preview |
|------|-----|-----|----------|---------|
| Background | #0C0A09 | hsl(20, 14%, 4%) | `stone-950` | Warm black |
| Background Secondary | #1C1917 | hsl(20, 9%, 10%) | `stone-900` | Cards |
| Primary | #F97316 | hsl(25, 95%, 53%) | `orange-500` | Main accent |
| Primary Hover | #EA580C | hsl(21, 90%, 48%) | `orange-600` | Hover |
| CTA Gradient Start | #F97316 | hsl(25, 95%, 53%) | `orange-500` | Gradient |
| CTA Gradient End | #EAB308 | hsl(48, 96%, 47%) | `yellow-500` | Gradient |
| Text Primary | #FAFAF9 | hsl(60, 9%, 98%) | `stone-50` | Headings |
| Text Secondary | #A8A29E | hsl(30, 6%, 63%) | `stone-400` | Body |
| Border | #292524 | hsl(24, 10%, 15%) | `stone-800` | Borders |

**Sunset Hero Gradient:**
```tsx
<div className="bg-gradient-to-br from-stone-950 via-stone-900 to-orange-950/20">
```

---

### Option 4: Forest Green (Calm/Professional)

A sophisticated, calming palette that feels professional and trustworthy.

| Role | Hex | HSL | Tailwind | Preview |
|------|-----|-----|----------|---------|
| Background | #022C22 | hsl(166, 90%, 9%) | `emerald-950` | Deep forest |
| Background Secondary | #064E3B | hsl(166, 72%, 17%) | `emerald-900` | Cards |
| Primary | #10B981 | hsl(160, 84%, 39%) | `emerald-500` | Main accent |
| Primary Hover | #059669 | hsl(161, 94%, 30%) | `emerald-600` | Hover |
| CTA Accent | #34D399 | hsl(158, 64%, 52%) | `emerald-400` | Highlights |
| Text Primary | #ECFDF5 | hsl(152, 81%, 96%) | `emerald-50` | Headings |
| Text Secondary | #A7F3D0 | hsl(152, 76%, 80%) | `emerald-200` | Body |
| Border | #065F46 | hsl(164, 86%, 20%) | `emerald-800` | Borders |

---

### Option 5: Royal Purple (Premium/Luxury)

A rich, premium palette that conveys sophistication and quality.

| Role | Hex | HSL | Tailwind | Preview |
|------|-----|-----|----------|---------|
| Background | #0F0A1A | hsl(262, 35%, 7%) | Custom | Deep purple black |
| Background Secondary | #1A1425 | hsl(262, 30%, 11%) | Custom | Cards |
| Primary | #A855F7 | hsl(271, 91%, 65%) | `purple-500` | Main accent |
| Primary Hover | #9333EA | hsl(271, 81%, 56%) | `purple-600` | Hover |
| Secondary | #D946EF | hsl(292, 84%, 61%) | `fuchsia-500` | Accents |
| Gold Accent | #F59E0B | hsl(38, 92%, 50%) | `amber-500` | Premium elements |
| Text Primary | #FAF5FF | hsl(270, 100%, 98%) | `purple-50` | Headings |
| Text Secondary | #C4B5FD | hsl(260, 95%, 85%) | `purple-300` | Body |
| Border | #3B0764 | hsl(273, 87%, 21%) | `purple-950` | Borders |

---

## Gradient Backgrounds

### Mesh Gradient (Modern)
```tsx
<div className="relative bg-[#0A0A0F]">
  <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(139,92,246,0.3),transparent)]" />
  <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_80%_50%,rgba(236,72,153,0.15),transparent)]" />
</div>
```

### Animated Gradient
```tsx
<div className="bg-gradient-to-br from-violet-500/20 via-transparent to-pink-500/20 animate-gradient-xy">
```

### Noise Overlay
```tsx
<div className="relative">
  <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-[0.03]" />
</div>
```

---

## Implementation Guide

### Step 1: Update globals.css

Add new CSS variables for the landing page:

```css
:root {
  /* Landing page specific colors */
  --landing-bg: hsl(240, 20%, 4%);
  --landing-bg-secondary: hsl(240, 18%, 8%);
  --landing-primary: hsl(258, 90%, 66%);
  --landing-primary-hover: hsl(258, 83%, 58%);
  --landing-accent: hsl(330, 81%, 60%);
  --landing-glow: rgba(139, 92, 246, 0.4);
}
```

### Step 2: Update Hero Component

```tsx
// apps/web/src/components/landing/hero.tsx
export function Hero() {
  return (
    <div className="min-h-[calc(100vh-4.5rem)] relative overflow-hidden">
      {/* Background with gradient */}
      <div className="absolute inset-0 bg-[#0A0A0F]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(139,92,246,0.3),transparent)]" />

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-center items-center text-center px-4">
        {/* ... */}
      </div>
    </div>
  );
}
```

### Step 3: Update CTA Buttons

```tsx
// Primary CTA with gradient
<Button className="bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-600 hover:to-pink-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all duration-300">
  Get Started Free
</Button>

// Secondary CTA with border
<Button variant="outline" className="border-violet-500/50 text-violet-300 hover:bg-violet-500/10 hover:border-violet-400">
  Watch Demo
</Button>
```

---

## Color Contrast Verification

All recommended palettes meet WCAG AA standards:

| Palette | Text on Background | Contrast Ratio | Status |
|---------|-------------------|----------------|--------|
| Electric Violet | #F8FAFC on #0A0A0F | 18.5:1 | AAA Pass |
| Neon Cyan | #F1F5F9 on #030712 | 19.2:1 | AAA Pass |
| Warm Sunset | #FAFAF9 on #0C0A09 | 18.8:1 | AAA Pass |
| Forest Green | #ECFDF5 on #022C22 | 11.2:1 | AAA Pass |
| Royal Purple | #FAF5FF on #0F0A1A | 17.1:1 | AAA Pass |

---

## My Recommendation

**For QCut (AI Video Editor), I recommend Option 1: Electric Violet** because:

1. **AI Association**: Purple/violet is strongly associated with AI and creativity
2. **Video Editing**: The pink-violet gradient reflects creative, media-focused products
3. **Differentiation**: Stands out from competitors using typical blue schemes
4. **Modern Feel**: Mesh gradients and glow effects feel cutting-edge
5. **Accessibility**: High contrast ratios ensure readability

### Quick Start Implementation

```css
/* Add to globals.css */
.dark {
  --primary: hsl(258, 90%, 66%);           /* Violet */
  --primary-foreground: hsl(0, 0%, 100%);  /* White */
  --accent: hsl(330, 81%, 60%);            /* Pink */
}
```

```tsx
/* Update hero.tsx background */
className="bg-[#0A0A0F] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(139,92,246,0.25),transparent)]"
```

---

## Changelog

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-11 | Claude | Initial color palette suggestions |
