#!/usr/bin/env python3
"""
Quick script to check E2E test progress
Compare against checkpoint at 2025-10-23 15:38:30

Location: qcut/docs/issues/e2e-test-errors/check-test-progress.py
Run from anywhere: python docs/issues/e2e-test-errors/check-test-progress.py
"""

from datetime import datetime
import os
import glob

# Checkpoint values
CHECKPOINT_TIME = "2025-10-23 15:38:30"
CHECKPOINT_COUNT = 40
TOTAL_TESTS = 66

# Get current time
current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
print(f"Current Time: {current_time}")
print(f"Checkpoint Time: {CHECKPOINT_TIME}")
print("-" * 60)

# Count test results - path relative to script location
script_dir = os.path.dirname(os.path.abspath(__file__))
# Go up from docs/issues/e2e-test-errors to docs/, then to completed/
results_dir = os.path.join(script_dir, "..", "..", "completed", "test-results-raw")
if os.path.exists(results_dir):
    test_count = len([d for d in os.listdir(results_dir) if os.path.isdir(os.path.join(results_dir, d))])
    
    print(f"Tests Completed: {test_count}/{TOTAL_TESTS} ({int(test_count/TOTAL_TESTS*100)}%)")
    print(f"Checkpoint Count: {CHECKPOINT_COUNT}/{TOTAL_TESTS} (61%)")
    print("-" * 60)
    
    if test_count > CHECKPOINT_COUNT:
        progress = test_count - CHECKPOINT_COUNT
        print(f"✅ Progress: +{progress} tests since checkpoint")
        remaining = TOTAL_TESTS - test_count
        print(f"⏳ Remaining: {remaining} tests")
    elif test_count == CHECKPOINT_COUNT:
        print("⚠️  No progress since checkpoint (tests may have stalled or be slow)")
    else:
        print("❌ Test count decreased (unexpected)")
    
    # Show most recent tests
    print("\n" + "=" * 60)
    print("Most Recent Test Results (last 5):")
    print("=" * 60)
    
    # Get all directories with their modification times
    test_dirs = []
    for d in os.listdir(results_dir):
        full_path = os.path.join(results_dir, d)
        if os.path.isdir(full_path):
            mtime = os.path.getmtime(full_path)
            test_dirs.append((d, mtime))
    
    # Sort by modification time (most recent first)
    test_dirs.sort(key=lambda x: x[1], reverse=True)
    
    # Show top 5
    for i, (test_name, mtime) in enumerate(test_dirs[:5], 1):
        time_str = datetime.fromtimestamp(mtime).strftime('%H:%M:%S')
        print(f"{i}. [{time_str}] {test_name[:70]}")

else:
    print(f"❌ Results directory not found: {results_dir}")

print("\n" + "=" * 60)
