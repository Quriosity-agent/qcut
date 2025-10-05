# Caption Implementation Documentation

This folder contains comprehensive documentation about QCut's caption and transcription system.

## Documents

### 📖 [Caption System Architecture](./caption-system-architecture.md)

Complete technical documentation covering:

1. **System Architecture** - Visual diagrams and component relationships
2. **Core Components** - Detailed breakdown of stores, UI, and backend
3. **Data Flow** - Step-by-step transcription and caption workflows
4. **File Structure** - Complete file tree with descriptions
5. **Export Formats** - SRT, VTT, ASS, TTML specifications
6. **API Integration** - Modal Whisper API and R2 storage
7. **Security** - Zero-knowledge encryption implementation
8. **Testing** - E2E test locations and coverage

## Quick Reference

### Key Files

| Component | File Path | Purpose |
|-----------|-----------|---------|
| **Store** | `apps/web/src/stores/captions-store.ts` | State management |
| **UI View** | `apps/web/src/components/editor/media-panel/views/captions.tsx` | Main caption interface |
| **Display** | `apps/web/src/components/captions/captions-display.tsx` | Video overlay renderer |
| **Export** | `apps/web/src/lib/captions/caption-export.ts` | Format conversion |
| **IPC Handler** | `electron/transcribe-handler.ts` | Backend processing |
| **Types** | `apps/web/src/types/captions.ts` | TypeScript definitions |

### Data Flow Summary

```
User Upload → FFmpeg Extraction → Client Encryption →
R2 Upload → Modal Whisper API → Parse Results →
Caption Track Creation → Timeline Integration → Export (SRT/VTT/ASS/TTML)
```

### Environment Variables Required

```bash
MODAL_TOKEN_ID          # Modal API authentication
MODAL_TOKEN_SECRET      # Modal API authentication
R2_ACCOUNT_ID          # Cloudflare R2 account
R2_ACCESS_KEY_ID       # R2 storage access
R2_SECRET_ACCESS_KEY   # R2 storage secret
R2_BUCKET_NAME         # R2 bucket for audio uploads
```

### Supported Languages

Auto-detect, English, Spanish, French, German, Italian, Portuguese, Russian, Japanese, Korean, Chinese, Arabic, Hindi

### Export Formats

- **SRT** (`.srt`) - Most compatible
- **VTT** (`.vtt`) - Web standard
- **ASS** (`.ass`) - Advanced styling
- **TTML** (`.ttml`) - Professional broadcast

## Common Tasks

### Adding a New Language

1. Edit `apps/web/src/types/captions.ts`
2. Add language to `SUPPORTED_LANGUAGES` array
3. Update language select component

### Adding a New Export Format

1. Create export function in `lib/captions/caption-export.ts`
2. Add format to `CaptionFormat` type
3. Update `exportCaptions()` switch statement
4. Add MIME type and extension mappings

### Debugging Transcription Issues

1. Check environment config: `isTranscriptionConfigured()`
2. Enable Electron logging: Check `electron-log` output
3. Monitor network requests in DevTools
4. Verify R2 bucket permissions

## Architecture Diagrams

See the main documentation for:
- System architecture diagram
- Component relationship graph (Mermaid)
- Data flow diagrams
- File structure tree

## Testing

### E2E Tests
```bash
# Run caption transcription tests
bun run test:e2e ai-transcription-caption-generation
```

### Unit Tests
```typescript
// Test utilities
import { resetCaptionsStore } from '@/test/helpers/reset-captions-store';
```

## Related Documentation

- [Timeline System](../../timeline-system/) *(if exists)*
- [Media Panel Architecture](../../media-panel/) *(if exists)*
- [FFmpeg Integration](../../ffmpeg-integration/) *(if exists)*

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-10-05 | 1.0 | Initial documentation created |

## Contributing

When modifying the caption system:

1. Update relevant sections in `caption-system-architecture.md`
2. Add new components to file structure
3. Document API changes
4. Update diagrams if architecture changes
5. Add examples for new features

## Support

For questions or issues:
- Check the [main documentation](./caption-system-architecture.md)
- Review E2E tests for usage examples
- Examine component source code
- Check Electron logs for backend issues
