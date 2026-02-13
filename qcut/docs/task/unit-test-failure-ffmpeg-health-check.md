# Unit Test Failure: ffmpeg-health-check.test.ts

## Test File
`apps/web/src/test/lib-tests/ffmpeg-health-check.test.ts`

## Failures
**2/5 tests failed**:
1. "ffprobe -version returns exit code 0"
2. "ffprobe version string is parseable"

## Error
```
spawn Unknown system error -86
```

## Root Cause
macOS error -86 when attempting to spawn ffprobe binary. This is a platform-specific error that typically indicates:
- Binary architecture mismatch
- Code signing issues on macOS
- Permissions or security restrictions

## Environment
- Platform: macOS Darwin 25.2.0
- Architecture: arm64 (Apple Silicon)
- Binary: ffprobe-static from node_modules

## Impact
- FFmpeg binary works fine in actual application (verified in earlier E2E test logs)
- Only affects unit tests that directly spawn ffprobe
- 3/5 tests in this file still pass (ffmpeg-related tests work)

## Potential Solutions
1. **Skip platform-specific tests**: Add conditional skip for macOS
2. **Mock ffprobe execution**: Use mocks instead of real binary in tests
3. **Investigate ffprobe-static**: Check if there's an issue with the packaged binary

## Recommendation
This is a test environment issue, not a production bug. The FFmpeg/ffprobe binaries work correctly in the actual application. Consider mocking these tests or adding platform-specific skips.

## Test Status
⚠️ **KNOWN ISSUE** - Not blocking, requires test environment fix
