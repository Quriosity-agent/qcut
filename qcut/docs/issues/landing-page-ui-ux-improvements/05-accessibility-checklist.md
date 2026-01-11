# Accessibility Checklist for Landing Page

## Overview

This document provides a comprehensive accessibility checklist for the QCut landing page, based on WCAG 2.1 guidelines and the project's established accessibility rules in CLAUDE.md.

---

## Priority 1: Critical Issues

### 1. Keyboard Navigation

| Requirement | Status | Notes |
|-------------|--------|-------|
| All interactive elements are keyboard accessible | - | Check buttons, links, handlebars |
| Tab order follows visual layout | - | Verify logical flow |
| No keyboard traps | - | Ensure escape works in modals |
| Focus visible on all interactive elements | - | Add focus rings |

**Implementation:**
```tsx
// Ensure focus visible
<button className="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
```

### 2. Screen Reader Support

| Requirement | Status | Notes |
|-------------|--------|-------|
| All images have meaningful alt text | - | Logo, screenshots |
| Headings follow proper hierarchy | - | h1 > h2 > h3 |
| Links have descriptive text | - | Avoid "click here" |
| Buttons have accessible names | - | Use aria-label if needed |

**Current Issues:**
- Logo image has `alt="QCut Logo"` - Good
- Social icons need aria-labels - Check footer

### 3. Color Contrast

| Element | Requirement | Current | WCAG |
|---------|-------------|---------|------|
| Body text | 4.5:1 | Check `text-muted-foreground` | AA |
| Large text (18px+) | 3:1 | Check hero headline | AA |
| Interactive elements | 3:1 | Check button colors | AA |
| Focus indicators | 3:1 | Check ring color | AA |

**Test Tools:**
- Chrome DevTools > Lighthouse > Accessibility
- axe DevTools extension
- WebAIM Contrast Checker

---

## Priority 2: High Importance

### 4. Semantic HTML

| Rule | Do | Don't |
|------|----|----- |
| Buttons | `<button type="button">` | `<div onClick>` |
| Navigation | `<nav>` | `<div className="nav">` |
| Main content | `<main>` | `<div className="main">` |
| Footer | `<footer>` | `<div className="footer">` |
| Headings | `<h1>`, `<h2>`, etc. | `<div className="h1">` |

**Current Code Review:**
- `hero.tsx`: Uses `<h1>` correctly
- `header.tsx`: Uses `<nav>` correctly
- `footer.tsx`: Uses `<footer>` correctly

### 5. Skip Links

Add a skip link for keyboard users to bypass navigation:

```tsx
// At the top of the page
<a
  href="#main-content"
  className="
    sr-only
    focus:not-sr-only
    focus:absolute
    focus:top-4
    focus:left-4
    focus:z-[100]
    focus:px-4
    focus:py-2
    focus:bg-background
    focus:text-foreground
    focus:rounded-lg
    focus:shadow-lg
  "
>
  Skip to main content
</a>

// Main content wrapper
<main id="main-content" tabIndex={-1}>
  {/* Page content */}
</main>
```

### 6. Reduced Motion

Respect user's motion preferences:

```tsx
import { useReducedMotion } from "framer-motion";

function HeroAnimation() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.8
      }}
    >
      {/* Content */}
    </motion.div>
  );
}
```

**CSS Alternative:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Priority 3: Important

### 7. Form Accessibility (if forms added)

| Requirement | Implementation |
|-------------|----------------|
| Labels for all inputs | `<label htmlFor="email">` |
| Error messages announced | `aria-describedby="email-error"` |
| Required fields marked | `aria-required="true"` |
| Invalid state indicated | `aria-invalid="true"` |

### 8. ARIA Usage

| When to Use | Example |
|-------------|---------|
| Custom widgets | `role="slider"` on handlebars |
| Dynamic content | `aria-live="polite"` for updates |
| Expanded/collapsed | `aria-expanded="true/false"` |
| Current page in nav | `aria-current="page"` |

**Handlebars Component Review:**
The handlebars component is a custom interactive element that may need ARIA attributes:

```tsx
<motion.div
  role="slider"
  aria-label="Content selection slider"
  aria-valuemin={0}
  aria-valuemax={width}
  aria-valuenow={leftHandle}
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'ArrowLeft') leftHandleX.set(leftHandleX.get() - 10);
    if (e.key === 'ArrowRight') leftHandleX.set(leftHandleX.get() + 10);
  }}
>
```

### 9. Interactive Element States

All interactive elements need visible state changes:

| State | Visual Indicator |
|-------|------------------|
| Hover | Color/background change |
| Focus | Ring outline (2px) |
| Active | Slight scale/color change |
| Disabled | Reduced opacity (50%) |

```tsx
<button
  className="
    transition-colors
    hover:bg-primary/90
    focus:outline-none
    focus-visible:ring-2
    focus-visible:ring-primary
    focus-visible:ring-offset-2
    active:scale-[0.98]
    disabled:opacity-50
    disabled:cursor-not-allowed
  "
>
```

---

## Top 10 Accessibility Rules (from CLAUDE.md)

| # | Rule | Landing Page Check |
|---|------|-------------------|
| 1 | Meaningful `alt` text for images | Check logo, screenshots |
| 2 | No `aria-hidden="true"` on focusable | Verify in all components |
| 3 | `type` attribute on all buttons | Add `type="button"` |
| 4 | Links have meaningful content + valid href | Check all nav links |
| 5 | `onClick` + keyboard support | Add to handlebars |
| 6 | SVG icons have `<title>` | Check all icons |
| 7 | No `tabIndex` on non-interactive | Review implementation |
| 8 | Semantic elements over roles | Using `<nav>`, `<footer>` |
| 9 | Headings contain visible text | Verify h1, h2 |
| 10 | Table headers have `scope` | N/A for landing page |

---

## Testing Checklist

### Automated Testing

- [ ] Run Lighthouse accessibility audit
- [ ] Run axe DevTools scan
- [ ] Run WAVE browser extension
- [ ] Validate HTML with W3C validator

### Manual Testing

- [ ] Navigate entire page with keyboard only
- [ ] Test with screen reader (NVDA/VoiceOver)
- [ ] Test with 200% zoom
- [ ] Test with Windows High Contrast mode
- [ ] Test with prefers-reduced-motion enabled
- [ ] Test on mobile with TalkBack/VoiceOver

### Color Testing

- [ ] Test with color blindness simulators
- [ ] Verify information isn't conveyed by color alone
- [ ] Check contrast in both light and dark modes

---

## Component-Specific Checklist

### Header Component

- [ ] Logo link has aria-label or accessible name
- [ ] Theme toggle has aria-label
- [ ] Navigation links are in `<nav>`
- [ ] Current page marked with aria-current
- [ ] Mobile menu trigger has aria-expanded

### Hero Component

- [ ] H1 is the first heading
- [ ] Animations respect reduced motion
- [ ] Handlebars are keyboard accessible
- [ ] CTA buttons have type="button"
- [ ] Focus order is logical

### Features Section (when added)

- [ ] Section has descriptive heading (h2)
- [ ] Feature cards are not interactive or properly accessible
- [ ] Icons have aria-hidden if decorative
- [ ] Or icons have accessible name if meaningful

### Footer Component

- [ ] Links have accessible names
- [ ] Social icons have aria-labels
- [ ] Link groups have headings
- [ ] External links indicated

---

## Remediation Tasks

### Immediate Fixes

1. **Add type="button" to all buttons**
   ```tsx
   <Button type="button" ...>
   ```

2. **Add aria-labels to icon-only buttons**
   ```tsx
   <ThemeToggle aria-label="Toggle dark mode" />
   ```

3. **Add skip link**
   - Add at top of page
   - Link to main content

4. **Verify heading hierarchy**
   - Hero: h1
   - Features: h2
   - Feature cards: h3

### Short-term Fixes

1. **Add keyboard support to handlebars**
   - Arrow keys for position
   - Tab to focus each handle

2. **Add reduced motion support**
   - Use Framer Motion's useReducedMotion
   - Apply to all animations

3. **Add focus-visible styles**
   - Consistent ring on focus
   - 2px offset from element

### Long-term Improvements

1. **Add prefers-contrast support**
2. **Add comprehensive screen reader testing**
3. **Create accessibility test suite**

---

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/TR/WCAG21/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/TR/wai-aria-practices-1.2/)
- [Inclusive Components](https://inclusive-components.design/)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)

---

## Audit Log

| Date | Auditor | Findings | Resolved |
|------|---------|----------|----------|
| - | - | - | - |

Track accessibility fixes and regression testing here.
