# Migration Tracking Spreadsheet

## Next.js Dependencies Found

### API Routes
| File Path | Next.js Feature | Migration Target | Priority | Status |
|-----------|----------------|------------------|----------|--------|
| src/app/api/health/route.ts | NextRequest | Electron IPC Handler | Low | Pending |
| src/app/api/sounds/search/route.ts | NextRequest, NextResponse | sounds:search IPC | High | Pending |
| src/app/api/transcribe/route.ts | NextRequest, NextResponse | transcribe:audio IPC | Medium | Pending |
| src/app/api/waitlist/route.ts | NextRequest, NextResponse, cookies | waitlist:add IPC | Low | Pending |
| src/app/api/waitlist/token/route.ts | NextRequest, NextResponse, cookies | waitlist:token IPC | Low | Pending |

### Navigation & Routing
| File Path | Next.js Feature | Migration Target | Priority | Status |
|-----------|----------------|------------------|----------|--------|
| src/app/(auth)/login/page.tsx | useRouter, Link | TanStack Router | Medium | Pending |
| src/app/(auth)/signup/page.tsx | useRouter, Link | TanStack Router | Medium | Pending |
| src/app/editor/[project_id]/page.tsx | useParams, useRouter | TanStack Router | High | Pending |
| src/app/projects/page.tsx | useRouter, Link | TanStack Router | High | Pending |
| src/app/blog/page.tsx | Link | TanStack Router | Low | Pending |
| src/app/contributors/page.tsx | Link | TanStack Router | Low | Pending |
| src/app/privacy/page.tsx | Link | TanStack Router | Low | Pending |
| src/app/roadmap/page.tsx | Link | TanStack Router | Low | Pending |
| src/app/terms/page.tsx | Link | TanStack Router | Low | Pending |

### Images
| File Path | Next.js Feature | Migration Target | Priority | Status |
|-----------|----------------|------------------|----------|--------|
| src/app/blog/page.tsx | next/image | Standard img | Low | Pending |
| src/app/blog/[slug]/page.tsx | next/image | Standard img | Low | Pending |
| src/app/projects/page.tsx | next/image | Standard img | Medium | Pending |
| src/components/background-settings.tsx | next/image | Standard img | Medium | Pending |

### Metadata & Types
| File Path | Next.js Feature | Migration Target | Priority | Status |
|-----------|----------------|------------------|----------|--------|
| src/app/blog/page.tsx | Metadata | Remove/Vite equivalent | Low | Pending |
| src/app/blog/[slug]/page.tsx | Metadata, notFound | Remove/Custom handler | Low | Pending |
| src/app/contributors/page.tsx | Metadata | Remove | Low | Pending |
| src/app/metadata.ts | Metadata | Remove | Low | Pending |
| src/app/page.tsx | Metadata | Remove | Low | Pending |
| src/app/privacy/page.tsx | Metadata | Remove | Low | Pending |
| src/app/roadmap/page.tsx | Metadata | Remove | Low | Pending |
| src/app/terms/page.tsx | Metadata | Remove | Low | Pending |
| src/app/robots.ts | MetadataRoute | Remove | Low | Pending |
| src/app/sitemap.ts | MetadataRoute | Remove | Low | Pending |

### Theme & UI
| File Path | Next.js Feature | Migration Target | Priority | Status |
|-----------|----------------|------------------|----------|--------|
| src/app/layout.tsx | ThemeProvider, Script | Vite equivalents | Medium | Pending |
| src/components/ui/sonner.tsx | next-themes | Vite equivalent | Low | Pending |
| src/components/ui/theme-toggle.tsx | next-themes | Vite equivalent | Low | Pending |
| src/routes/__root.tsx | ThemeProvider | Vite equivalent | Medium | Pending |

### Middleware
| File Path | Next.js Feature | Migration Target | Priority | Status |
|-----------|----------------|------------------|----------|--------|
| src/middleware.ts | NextResponse, NextRequest | Remove/Electron handler | Low | Pending |

## Migration Summary

**Total Files to Migrate**: 32
**High Priority**: 3 files
**Medium Priority**: 8 files  
**Low Priority**: 21 files

**Critical API Routes**: 2 (sounds/search, transcribe)
**Critical Navigation**: 2 (editor, projects pages)

## Next Steps

1. Complete Phase 1 assessment
2. Begin API route migration (sounds/search first)
3. Set up feature flags
4. Create parallel implementations