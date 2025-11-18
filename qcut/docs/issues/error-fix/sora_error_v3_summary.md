# Sora 2 Video Generation Error Summary

## Overview

Multiple errors occurred when attempting to generate video using FAL AI's Sora 2 Text-to-Video service. This document details two separate error incidents.

---

## Error #1: Network Resolution Failure

**Error Type**: Network Resolution Failure
**Error ID**: `ERR-1763430008004-Z0V929`
**Timestamp**: 2025-11-18T01:40:08.004Z
**Severity**: MEDIUM
**Category**: `ai_service`
**Operation**: AI Video Generation

### Primary Error

```
net::ERR_NAME_NOT_RESOLVED
TypeError: Failed to fetch
```

**Failed Endpoint**: `fal.run/fal-ai/sora-2/text-to-video`

### Error Description

The application attempted to generate a video using FAL AI's Sora 2 Text-to-Video service but failed due to a DNS resolution error. The endpoint `fal.run/fal-ai/sora-2/text-to-video` could not be resolved, resulting in a failed fetch operation.

---

## Error #2: Invalid Duration Parameter (CRITICAL)

**Error Type**: HTTP 422 - Unprocessable Content
**Error IDs**:
- `ERR-1763430874008-HG0MR5` (Queue Submit Error)
- `ERR-1763430874010-EXGUVV` (Invalid Parameters)

**Timestamp**: 2025-11-18T01:54:34.008Z
**Severity**: MEDIUM
**Category**: `ai_service`
**Operation**: Submit FAL AI request to queue / AI Video Generation

### Primary Error

```
POST https://fal.run/fal-ai/sora-2/text-to-video 422 (Unprocessable Content)
```

### Validation Error Details

```json
{
  "detail": [{
    "loc": ["body", "duration"],
    "msg": "unexpected value; permitted: 4, 8, 12",
    "type": "value_error.const",
    "ctx": {
      "given": 6,
      "permitted": [4, 8, 12]
    }
  }]
}
```

### Error Description

The API request was successfully sent to FAL AI but was rejected with a 422 status code due to **invalid `duration` parameter**. The application sent `duration: 6`, but the API only accepts values of `4`, `8`, or `12` seconds.

### Error Message

```
Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
```

---

## Relevant File Paths & Code Locations

### Common Flow (Both Errors)

#### **AI Generation Hook** - `use-ai-generation.ts`
- **Lines 636-643**: Input parameter logging
  - Active tab: text
  - Selected model: Sora 2 Text-to-Video
  - Active project ID: `91792c80-b639-4b2a-bf54-6b7da08e2ff1`

- **Line 701**: Validation passed
  ```
  ✅ Validation passed, starting generation...
  ```

- **Lines 714-725**: Pre-generation state check
  - Active project validation
  - Media store loading state check

- **Line 770**: Generation start
  ```
  📦 Starting generation for 1 models
  ```

- **Line 794**: Text-to-video processing
  ```
  📝 Processing text-to-video model sora2_text_to_video...
  ```

- **Line 902**: **Error catch point** (Both errors caught here)
  ```javascript
  at use-ai-generation.ts:902:30
  ```

- **Line 1797**: Additional error handling
- **Line 1799**: onError callback

#### **AI Video Client** - `ai-video-client.ts`
- **Line 460**: FAL API Key validation
  ```
  🔑 FAL API Key present: Yes (length: 69)
  ```
- **Line 479**: Video generation initiation
  ```
  🎬 Generating video with FAL AI: fal-ai/sora-2/text-to-video
  ```
- **Line 559**: Payload preparation
  ```
  📤 Sending request to fal-ai/sora-2/text-to-video with payload
  ```
- **Line 575**: Queue submission attempt
  ```
  📤 Attempting queue submission with payload
  ```

### Error #1 Specific Locations

#### **AI Video Client** - `ai-video-client.ts`
- **Line 577**: **Error origin point** - Network fetch fails
  ```javascript
  at mx (ai-video-client.ts:577:33)
  ```

#### **Blob URL Debug** - `blob-url-debug.ts`
- **Line 96**: Error throw location
  ```javascript
  at e (blob-url-debug.ts:96:26)
  POST https://fal.run/fal-ai/sora-2/text-to-video (failed DNS)
  ```

#### **AI View Component** - `ai.tsx`
- **Line 508**: Progress updates and error display
  ```
  [AI View] Progress: 0% - Failed to fetch
  [AI View] Error occurred: Failed to fetch
  ```

#### **Error Handler** - `error-handler.ts`
- **Lines 145-161**: Error logging and metadata capture
  ```
  🚨 Error ERR-1763430008004-Z0V929 [MEDIUM]
  Timestamp: 2025-11-18T01:40:08.004Z
  Operation: AI Video Generation
  Category: ai_service
  Severity: medium
  ```

### Error #2 Specific Locations (Invalid Duration)

#### **AI Video Client** - `ai-video-client.ts`
- **Line 593**: **Queue submit error throw** (422 error)
  ```javascript
  at mx (ai-video-client.ts:593:9)
  Error: FAL Queue Submit Error: 422
  ```

- **Line 607**: **Invalid parameters error throw**
  ```javascript
  at mx (ai-video-client.ts:607:13)
  Error: Invalid request parameters: {...}
  ```

- **Line 780**: Additional error reference
  ```javascript
  at mx (ai-video-client.ts:780)
  ```

#### **Blob URL Debug** - `blob-url-debug.ts`
- **Line 96**: POST request that returned 422
  ```javascript
  POST https://fal.run/fal-ai/sora-2/text-to-video 422 (Unprocessable Content)
  ```

#### **AI View Component** - `ai.tsx`
- **Line 508**: Progress update with error details
  ```
  [AI View] Progress: 0% - Invalid request parameters: {"detail":[...]}
  ```

- **Line 512**: onError handler
  ```javascript
  onError @ ai.tsx:512
  [AI View] Error occurred: Invalid request parameters: {...}
  ```

#### **Error Handler** - `error-handler.ts`
- **Lines 145-161**: Multiple error logs
  ```
  🚨 Error ERR-1763430874008-HG0MR5 [MEDIUM]
  Timestamp: 2025-11-18T01:54:34.008Z
  Operation: Submit FAL AI request to queue

  🚨 Error ERR-1763430874010-EXGUVV [MEDIUM]
  Timestamp: 2025-11-18T01:54:34.010Z
  Operation: AI Video Generation

  Metadata: {status: 422, statusText: '', errorData: {...},
             endpoint: 'fal-ai/sora-2/text-to-video',
             operation: 'queueSubmit'}
  ```

---

## Error Stack Traces

### Error #1 Stack Trace (Network Failure)

```
TypeError: Failed to fetch
  at e (blob-url-debug.ts:96:26)
  at mx (ai-video-client.ts:577:33)
  at use-ai-generation.ts:902:30
  at HTMLUnknownElement.qe (react-dom.development.js:4164:14)
  at Object.vR (react-dom.development.js:4213:16)
  at Iv (react-dom.development.js:4277:31)
  at Sk (react-dom.development.js:4291:25)
  at DE (react-dom.development.js:9041:3)
  at pI (react-dom.development.js:9073:7)
  at PE (react-dom.development.js:9086:5)
```

### Error #2 Stack Trace (Invalid Duration Parameter)

```
Error: FAL Queue Submit Error: 422
  at mx (ai-video-client.ts:593:9)
  at async use-ai-generation.ts:902:24

Error: Invalid request parameters: {"detail":[{"loc":["body","duration"],...}]}
  at mx (ai-video-client.ts:607:13)
  at async use-ai-generation.ts:902:24
```

**Full Stack:**
```
at mx (ai-video-client.ts:780)
at use-ai-generation.ts:902
at use-ai-generation.ts:1797
at use-ai-generation.ts:1799
at qe (react-dom.development.js:4164)
at vR (react-dom.development.js:4213)
at Iv (react-dom.development.js:4277)
at Sk (react-dom.development.js:4291)
at DE (react-dom.development.js:9041)
at pI (react-dom.development.js:9073)
at PE (react-dom.development.js:9086)
```

---

## Context Details

**Model**: `sora2_text_to_video` (Sora 2 Text-to-Video)
**FAL Endpoint**: `fal-ai/sora-2/text-to-video`
**API Key Status**: Present (69 characters)

**User Input Prompt**:
```
#### 镜头6.8：逃脱 | Shot 6.8: Escape
**时长 Duration**: 15秒

**分镜描述 (中文)**:
白光消散。蒙面人已经上了货车，疾驰而去。
星璇和唐悦恢复视力，但为时已晚。
地上只留下一张黑色名片。

**Storyboard Description (English)**:
White light fades. Masked figures already in van, speeding away.
Star and Joy recover vision, but too late.
Only a black business card left on ground.
```

---

## Root Cause Analysis

### Error #1 Root Cause
The error `ERR_NAME_NOT_RESOLVED` indicates that:
1. The DNS lookup for `fal.run` failed
2. Possible network connectivity issue
3. Possible incorrect endpoint URL
4. Firewall or proxy blocking the request

### Error #2 Root Cause (PRIMARY ISSUE)
The error `422 Unprocessable Content` with invalid duration parameter is the **MAIN ISSUE**:

**Problem**: The application is sending `duration: 6` (likely derived from user input "15秒" / 15 seconds)

**API Constraint**: FAL AI's Sora 2 API only accepts duration values of `4`, `8`, or `12` seconds

**Where the issue occurs**: The duration parameter is being set somewhere in the code flow before reaching `ai-video-client.ts:577` (queue submission point)

**Need to investigate**:
- Where is the duration parameter being calculated or extracted from the user prompt?
- Is there a duration mapping/conversion function that needs to be updated?
- Should the UI prevent users from entering invalid durations?
- Should there be validation before the API call?

---

## Potential Fixes

### For Error #1 (Network Issue)
1. **Verify endpoint URL** - Check if `fal.run` is the correct domain for FAL AI API
2. **Network connectivity** - Ensure internet connection is stable
3. **Firewall settings** - Check if the application has network permissions
4. **CORS configuration** - Verify CORS headers if running in browser context
5. **API endpoint update** - Verify FAL AI hasn't changed their API endpoint structure

### For Error #2 (Duration Parameter) - CRITICAL FIX NEEDED

**Immediate Action Required:**

1. **Fix duration parameter validation in `ai-video-client.ts`**
   - Add validation before API call to ensure duration is one of: `4`, `8`, or `12`
   - Map user input durations to closest valid value
   - Example mapping:
     - 0-6 seconds → 4
     - 7-10 seconds → 8
     - 11+ seconds → 12

2. **Update duration extraction logic**
   - Find where the prompt "**时长 Duration**: 15秒" is being parsed
   - Ensure the parsed duration is validated against allowed values
   - Consider rounding to nearest allowed value

3. **Add UI validation**
   - Display allowed duration values (4, 8, 12 seconds) in the UI
   - Prevent users from entering invalid durations
   - Add helpful message explaining the constraint

4. **Code locations to fix**:
   - `ai-video-client.ts:559-577` - Add duration validation before queue submission
   - Look for duration parsing logic (likely in `use-ai-generation.ts` or prompt parsing utility)
   - Add validation in the generation hook before calling the video client

**Example Fix:**
```typescript
// In ai-video-client.ts before queue submission
const validDurations = [4, 8, 12];
const requestedDuration = payload.duration || 6;

// Map to closest valid duration
const duration = validDurations.reduce((prev, curr) =>
  Math.abs(curr - requestedDuration) < Math.abs(prev - requestedDuration) ? curr : prev
);

payload.duration = duration;
```

---

## How to Identify and Debug the Problem

### Step-by-Step Debugging with Console Messages

To identify where the duration issue originates and track the data flow, add console messages at key points in the code:

#### 1. **In `use-ai-generation.ts` - Track Initial Input**

**Location**: Around line 638-643 (where parameters are logged)

**Add console messages:**
```typescript
// use-ai-generation.ts:638
console.log('🔍 [DEBUG] Input parameters:');
console.log('  - activeTab:', activeTab);
console.log('  - prompt:', prompt);
console.log('  - selectedModels:', selectedModels);

// Add this new debug line
console.log('🔍 [DEBUG] Parsing duration from prompt...');
const durationMatch = prompt.match(/时长\s*Duration[:\s]*(\d+)/i);
console.log('  - Duration match found:', durationMatch);
console.log('  - Extracted duration value:', durationMatch ? durationMatch[1] : 'none');
```

**Expected Output:**
```
🔍 [DEBUG] Parsing duration from prompt...
  - Duration match found: ["时长 Duration**: 15", "15"]
  - Extracted duration value: 15
```

#### 2. **In `use-ai-generation.ts` - Before Model Processing**

**Location**: Around line 794 (before processing text-to-video model)

**Add console messages:**
```typescript
// use-ai-generation.ts:794
console.log('📝 Processing text-to-video model:', modelId);

// Add these debug lines
console.log('🔍 [DEBUG] Model configuration:');
console.log('  - Model ID:', modelId);
console.log('  - Model config:', JSON.stringify(model, null, 2));

// If there's a duration parameter being prepared
console.log('🔍 [DEBUG] Duration parameter being sent:');
console.log('  - Duration value:', duration); // wherever it's defined
console.log('  - Duration type:', typeof duration);
```

**Expected Output:**
```
🔍 [DEBUG] Duration parameter being sent:
  - Duration value: 6
  - Duration type: number
```

#### 3. **In `ai-video-client.ts` - At Payload Preparation**

**Location**: Line 559 (before sending request)

**Add console messages:**
```typescript
// ai-video-client.ts:559
console.log('📤 Sending request to fal-ai/sora-2/text-to-video with payload:', payload);

// Add detailed debugging
console.log('🔍 [DEBUG] Payload Details:');
console.log('  - Full payload:', JSON.stringify(payload, null, 2));
console.log('  - Duration in payload:', payload.duration);
console.log('  - Duration type:', typeof payload.duration);
console.log('  - Valid durations:', [4, 8, 12]);
console.log('  - Is duration valid?', [4, 8, 12].includes(payload.duration));

// Add validation warning
if (payload.duration && ![4, 8, 12].includes(payload.duration)) {
  console.warn('⚠️ [WARNING] Invalid duration detected!');
  console.warn('  - Given:', payload.duration);
  console.warn('  - Permitted:', [4, 8, 12]);
  console.warn('  - This will cause a 422 error!');
}
```

**Expected Output (Problem Case):**
```
🔍 [DEBUG] Payload Details:
  - Full payload: {
      "prompt": "...",
      "duration": 6,
      ...
    }
  - Duration in payload: 6
  - Duration type: number
  - Valid durations: [4, 8, 12]
  - Is duration valid? false
⚠️ [WARNING] Invalid duration detected!
  - Given: 6
  - Permitted: [4, 8, 12]
  - This will cause a 422 error!
```

#### 4. **In `ai-video-client.ts` - At Queue Submission**

**Location**: Line 575 (attempting queue submission)

**Add console messages:**
```typescript
// ai-video-client.ts:575
console.log('📤 Attempting queue submission with payload:', payload);

// Add pre-submission validation
console.log('🔍 [DEBUG] Pre-submission validation:');
console.log('  - Endpoint:', 'fal-ai/sora-2/text-to-video');
console.log('  - Payload keys:', Object.keys(payload));
console.log('  - Payload.duration:', payload.duration);

// Validate duration before submission
const VALID_DURATIONS = [4, 8, 12];
if (!VALID_DURATIONS.includes(payload.duration)) {
  console.error('❌ [ERROR] Duration validation failed!');
  console.error('  - Current duration:', payload.duration);
  console.error('  - Allowed durations:', VALID_DURATIONS);
  console.error('  - Correcting to nearest valid value...');

  // Auto-correct logic
  const correctedDuration = VALID_DURATIONS.reduce((prev, curr) =>
    Math.abs(curr - payload.duration) < Math.abs(prev - payload.duration) ? curr : prev
  );
  console.log('  - Corrected duration:', correctedDuration);
  payload.duration = correctedDuration;
}
```

#### 5. **In `ai-video-client.ts` - Error Handling**

**Location**: Line 593 (queue submit error) and Line 607 (invalid parameters error)

**Add console messages:**
```typescript
// ai-video-client.ts:593
catch (error) {
  console.error('🚨 [ERROR] Queue submission failed!');
  console.error('  - Error type:', error.constructor.name);
  console.error('  - Error message:', error.message);
  console.error('  - Status code:', error.status || 'N/A');

  if (error.status === 422) {
    console.error('🚨 [422 ERROR] Unprocessable Content');
    console.error('  - This usually means invalid parameters');
    console.error('  - Check the payload that was sent');
    console.error('  - Payload sent:', JSON.stringify(payload, null, 2));
  }

  throw new Error(`FAL Queue Submit Error: ${error.status}`);
}

// ai-video-client.ts:607
if (errorData?.detail) {
  console.error('🚨 [ERROR] Invalid request parameters detected!');
  console.error('  - Error details:', JSON.stringify(errorData.detail, null, 2));

  // Check if it's a duration error
  const durationError = errorData.detail.find(
    (err: any) => err.loc && err.loc.includes('duration')
  );

  if (durationError) {
    console.error('🚨 [DURATION ERROR] Invalid duration parameter!');
    console.error('  - Given value:', durationError.ctx?.given);
    console.error('  - Permitted values:', durationError.ctx?.permitted);
    console.error('  - Error message:', durationError.msg);
    console.error('  - Location:', durationError.loc);
  }

  throw new Error(`Invalid request parameters: ${JSON.stringify(errorData)}`);
}
```

**Expected Output (When Error Occurs):**
```
🚨 [ERROR] Queue submission failed!
  - Error type: Error
  - Error message: Request failed with status 422
  - Status code: 422
🚨 [422 ERROR] Unprocessable Content
  - This usually means invalid parameters
  - Check the payload that was sent
  - Payload sent: {
      "prompt": "...",
      "duration": 6,
      ...
    }
🚨 [ERROR] Invalid request parameters detected!
  - Error details: [
      {
        "loc": ["body", "duration"],
        "msg": "unexpected value; permitted: 4, 8, 12",
        "type": "value_error.const",
        "ctx": {
          "given": 6,
          "permitted": [4, 8, 12]
        }
      }
    ]
🚨 [DURATION ERROR] Invalid duration parameter!
  - Given value: 6
  - Permitted values: [4, 8, 12]
  - Error message: unexpected value; permitted: 4, 8, 12
  - Location: ["body", "duration"]
```

---

## Debug Checklist

Use this checklist to systematically identify where the duration issue originates:

- [ ] **Step 1**: Add console logs in `use-ai-generation.ts:638` to see raw prompt input
- [ ] **Step 2**: Add console logs to find where duration is parsed from "15秒" text
- [ ] **Step 3**: Add console logs to see what duration value is calculated (why it becomes 6 instead of 15)
- [ ] **Step 4**: Add console logs in `ai-video-client.ts:559` to verify payload before sending
- [ ] **Step 5**: Add validation console warnings to catch invalid durations before API call
- [ ] **Step 6**: Add detailed error logging in catch blocks to understand API response
- [ ] **Step 7**: Trace the data flow from prompt → parsing → payload → API call

---

## Key Questions to Answer with Console Logs

1. **Where does "15秒" become "6"?**
   - Add logs at every function that processes the prompt
   - Look for duration calculation or conversion logic

2. **Is there a duration extraction function?**
   - Search for functions with names like: `parseDuration`, `extractDuration`, `getDuration`
   - Add logs before and after duration processing

3. **Is duration being divided?**
   - Check if 15 seconds is being divided (15 / 2.5 = 6)
   - Look for any duration normalization logic

4. **Where is the payload constructed?**
   - Find where the request payload object is created
   - Log the payload at construction time and before sending

5. **Are there model-specific duration constraints?**
   - Check if different models have different duration mappings
   - Log model configuration and constraints

---

## Recommended Debugging Workflow

1. **Add all console messages** from sections 1-5 above
2. **Run the application** and trigger the Sora 2 video generation
3. **Reproduce the error** with the same prompt
4. **Check browser console** (F12 → Console tab)
5. **Trace the logs** to see where duration changes from 15 to 6
6. **Identify the conversion logic** that needs to be fixed
7. **Implement the fix** using the example code provided
8. **Test again** and verify duration is now one of: 4, 8, or 12

---

## Files to Add Debug Logging

| File | Lines | Purpose |
|------|-------|---------|
| `use-ai-generation.ts` | 638-643 | Track initial prompt input |
| `use-ai-generation.ts` | 794 | Track model processing start |
| `use-ai-generation.ts` | 902 | Track error catch point |
| `ai-video-client.ts` | 559 | Track payload before sending |
| `ai-video-client.ts` | 575 | Validate before queue submission |
| `ai-video-client.ts` | 593 | Track queue submit errors |
| `ai-video-client.ts` | 607 | Track parameter validation errors |
| `ai-video-client.ts` | 780 | Track additional error handling |

---

## Quick Fix Implementation (With Debug Logs)

```typescript
// ai-video-client.ts - Add this before line 575 (queue submission)

// Validate and correct duration parameter
const VALID_SORA_DURATIONS = [4, 8, 12] as const;

console.log('🔍 [DURATION VALIDATION] Checking duration parameter...');
console.log('  - Original duration:', payload.duration);

if (payload.duration && !VALID_SORA_DURATIONS.includes(payload.duration)) {
  const originalDuration = payload.duration;

  console.warn('⚠️ [DURATION WARNING] Invalid duration detected!');
  console.warn('  - Given:', originalDuration);
  console.warn('  - Permitted:', VALID_SORA_DURATIONS);

  // Map to closest valid duration
  payload.duration = VALID_SORA_DURATIONS.reduce((prev, curr) =>
    Math.abs(curr - originalDuration) < Math.abs(prev - originalDuration) ? curr : prev
  );

  console.log('✅ [DURATION FIXED] Corrected to nearest valid value:');
  console.log('  - Original:', originalDuration);
  console.log('  - Corrected:', payload.duration);
} else {
  console.log('✅ [DURATION VALID]', payload.duration);
}

console.log('📤 Attempting queue submission with validated payload...');
```

This will output:
```
🔍 [DURATION VALIDATION] Checking duration parameter...
  - Original duration: 6
⚠️ [DURATION WARNING] Invalid duration detected!
  - Given: 6
  - Permitted: [4, 8, 12]
✅ [DURATION FIXED] Corrected to nearest valid value:
  - Original: 6
  - Corrected: 4
✅ [DURATION VALID] 4
📤 Attempting queue submission with validated payload...
```
