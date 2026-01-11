# Navigation & Header UI/UX Improvements

## Current State Analysis

**File:** `apps/web/src/components/header.tsx`

### Current Implementation
- Floating header with rounded corners (`rounded-2xl`)
- Left: Logo + "QCut" text
- Right: Theme toggle, Blog link, Contributors link, Projects button
- Positioned with `mt-4` margin and `max-w-3xl` constraint
- Background: `bg-background` with border

### Issues Identified

| Issue | Severity | Impact |
|-------|----------|--------|
| Limited navigation options | Medium | Users can't quickly access key pages |
| No sticky behavior on scroll | Low | Header disappears when scrolling |
| Missing GitHub/Download links | Medium | Key actions not accessible |
| Logo hidden on mobile (`hidden md:block`) | Low | Reduced brand visibility |

---

## Recommended Improvements

### 1. Expand Navigation Links

**Priority:** P2 (Medium)

**Current Links:**
- Blog
- Contributors
- Projects (CTA button)

**Recommended Links:**
- Features
- Docs (Documentation)
- Blog
- GitHub (external)
- Download / Get Started (Primary CTA)

**Suggested Structure:**
```
[Logo] QCut     Features  Docs  Blog  GitHub  [Download] [Theme]
```

**Code Example:**
```tsx
const rightContent = (
  <nav className="flex items-center gap-1">
    <div className="hidden md:flex items-center gap-4">
      <Link to="/features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        Features
      </Link>
      <Link to="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        Docs
      </Link>
      <Link to="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        Blog
      </Link>
      <a
        href="https://github.com/donghaozhang/qcut"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        GitHub
      </a>
    </div>
    <div className="flex items-center gap-2 ml-4">
      <ThemeToggle />
      <Link to="/projects">
        <Button size="sm">
          Get Started
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </Link>
    </div>
  </nav>
);
```

---

### 2. Add Sticky Header Behavior

**Priority:** P2 (Medium)

**Options:**

#### Option A: Always Sticky
```tsx
<HeaderBase className="fixed top-4 left-4 right-4 z-50 ..." />
```

#### Option B: Sticky on Scroll Up (Recommended)
Hide header when scrolling down, show when scrolling up.

```tsx
const [isVisible, setIsVisible] = useState(true);
const [lastScrollY, setLastScrollY] = useState(0);

useEffect(() => {
  const handleScroll = () => {
    const currentScrollY = window.scrollY;
    setIsVisible(currentScrollY < lastScrollY || currentScrollY < 100);
    setLastScrollY(currentScrollY);
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  return () => window.removeEventListener('scroll', handleScroll);
}, [lastScrollY]);
```

**Animation:**
```tsx
<motion.div
  initial={{ y: 0 }}
  animate={{ y: isVisible ? 0 : -100 }}
  transition={{ duration: 0.2 }}
>
  <HeaderBase ... />
</motion.div>
```

---

### 3. Mobile Navigation Menu

**Priority:** P1 (High)

**Current Issue:** Navigation links are hidden on mobile with no alternative access.

**Recommended Solution:** Add hamburger menu for mobile.

```tsx
// Mobile menu trigger
<Button
  variant="ghost"
  size="icon"
  className="md:hidden"
  onClick={() => setMobileMenuOpen(true)}
  aria-label="Open navigation menu"
>
  <Menu className="h-5 w-5" />
</Button>

// Mobile menu (Sheet/Drawer)
<Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
  <SheetContent side="right">
    <nav className="flex flex-col gap-4 mt-8">
      <Link to="/features" onClick={() => setMobileMenuOpen(false)}>
        Features
      </Link>
      <Link to="/docs" onClick={() => setMobileMenuOpen(false)}>
        Docs
      </Link>
      <Link to="/blog" onClick={() => setMobileMenuOpen(false)}>
        Blog
      </Link>
      <a href="https://github.com/donghaozhang/qcut" target="_blank">
        GitHub
      </a>
      <hr />
      <Link to="/projects">
        <Button className="w-full">Get Started</Button>
      </Link>
    </nav>
  </SheetContent>
</Sheet>
```

---

### 4. Improve Logo Visibility

**Priority:** P3 (Low)

**Current Issue:** "QCut" text is hidden on mobile (`hidden md:block`).

**Recommendations:**
- Keep logo image visible on all screen sizes
- Consider using a wordmark logo that works at small sizes
- Ensure logo has proper alt text for accessibility

```tsx
<Link to="/" className="flex items-center gap-2">
  <img
    src={getAssetPath("assets/logo-v4.png")}
    alt="QCut - AI Video Editor"
    className="h-8 w-8"
  />
  <span className="text-lg font-semibold">QCut</span>
</Link>
```

---

### 5. Add GitHub Stars Badge

**Priority:** P2 (Medium)

**Rationale:** Social proof increases trust. GitHub stars show project popularity.

```tsx
<a
  href="https://github.com/donghaozhang/qcut"
  target="_blank"
  rel="noopener noreferrer"
  className="hidden md:flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
>
  <FaGithub className="h-4 w-4" />
  <span>{starCount}</span>
</a>
```

**Note:** The footer already fetches GitHub stars (`getStars()`). Consider moving this to a shared context or store.

---

### 6. Header Animation on Load

**Priority:** P3 (Low)

**Current:** No entrance animation for header.

**Recommended:**
```tsx
<motion.div
  initial={{ y: -20, opacity: 0 }}
  animate={{ y: 0, opacity: 1 }}
  transition={{ duration: 0.5, ease: "easeOut" }}
>
  <HeaderBase ... />
</motion.div>
```

---

## Accessibility Improvements

### Required Fixes

| Issue | Fix |
|-------|-----|
| Logo link needs better aria-label | Add `aria-label="Go to homepage"` |
| Theme toggle needs aria-label | Ensure toggle has descriptive label |
| Mobile menu needs focus management | Focus first item when opened |
| Skip to main content link missing | Add skip link for keyboard users |

### Add Skip Link
```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground"
>
  Skip to main content
</a>
```

---

## Z-Index Management

Following UX best practices for z-index scale:

| Element | Z-Index | Tailwind Class |
|---------|---------|----------------|
| Header | 50 | `z-50` |
| Mobile Menu Overlay | 40 | `z-40` |
| Mobile Menu Panel | 50 | `z-50` |
| Dropdown Menus | 50 | `z-50` |

**Important:** Define a consistent z-index scale across the application.

---

## Implementation Checklist

### Navigation Structure
- [ ] Add "Features" link
- [ ] Add "Docs" link
- [ ] Add GitHub link with icon
- [ ] Update CTA button text to "Get Started" or "Download"

### Sticky Behavior
- [ ] Implement sticky header on scroll
- [ ] Add hide-on-scroll-down option
- [ ] Add backdrop blur when sticky

### Mobile Navigation
- [ ] Add hamburger menu icon (hidden on desktop)
- [ ] Create mobile menu sheet/drawer
- [ ] Ensure all navigation links are accessible on mobile
- [ ] Add close button with proper focus management

### Accessibility
- [ ] Add skip link
- [ ] Add proper aria-labels to all interactive elements
- [ ] Ensure focus states are visible
- [ ] Test keyboard navigation

### Animation
- [ ] Add entrance animation
- [ ] Add smooth scroll-hide animation
- [ ] Respect `prefers-reduced-motion`

---

## Mobile Breakpoint Strategy

| Breakpoint | Navigation Display |
|------------|-------------------|
| < 640px (sm) | Logo + Hamburger menu |
| 640px - 768px | Logo + Hamburger menu |
| 768px+ (md) | Full navigation bar |

---

## Design Specifications

### Header Dimensions
- Height: 56px (`h-14`)
- Max width: `max-w-3xl` (keep current)
- Border radius: `rounded-2xl` (keep current)
- Margin: `mt-4 mx-4` (keep current)

### Spacing
- Logo to nav items: `gap-4`
- Between nav items: `gap-4`
- Nav items to CTA: `ml-4`

### Colors
- Background: `bg-background` with border
- Text: `text-muted-foreground` default
- Hover: `text-foreground` on hover
- CTA: Primary button style

### Transitions
- Color transitions: `transition-colors duration-200`
- Position transitions: `transition-transform duration-200`
