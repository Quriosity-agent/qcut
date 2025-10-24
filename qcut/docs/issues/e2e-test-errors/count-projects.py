#!/usr/bin/env python3
"""
Count projects in QCut database before/after E2E tests
This helps understand if cleanup is actually working

Usage: python count-projects.py
"""

import os
import json
from pathlib import Path

def count_projects():
    # QCut data directory
    qcut_dir = Path.home() / "AppData" / "Roaming" / "qcut"

    print("=" * 70)
    print("QCut Project Counter - Understanding Database State")
    print("=" * 70)
    print(f"\nChecking directory: {qcut_dir}\n")

    # Check if directory exists
    if not qcut_dir.exists():
        print("❌ QCut directory does not exist - no projects found")
        return

    # Count JSON files in projects folder
    projects_folder = qcut_dir / "projects"
    project_files = 0
    if projects_folder.exists():
        project_files = len(list(projects_folder.glob("*.json")))
        print(f"📁 Projects folder: {project_files} JSON files")
    else:
        print(f"📁 Projects folder: does not exist")

    # Check IndexedDB
    indexeddb_dir = qcut_dir / "IndexedDB"
    if indexeddb_dir.exists():
        # Count database files
        db_files = list(indexeddb_dir.rglob("*"))
        db_dirs = [f for f in db_files if f.is_dir()]
        db_regular_files = [f for f in db_files if f.is_file()]

        print(f"💾 IndexedDB exists:")
        print(f"   - {len(db_dirs)} directories")
        print(f"   - {len(db_regular_files)} files")

        # Try to estimate size
        total_size = sum(f.stat().st_size for f in db_regular_files if f.exists())
        size_mb = total_size / (1024 * 1024)
        print(f"   - Total size: {size_mb:.2f} MB")
    else:
        print(f"💾 IndexedDB: does not exist (clean)")

    # Check other storage
    storage_dirs = ["Local Storage", "Session Storage", "blob_storage", "File System"]
    for storage in storage_dirs:
        storage_path = qcut_dir / storage
        if storage_path.exists():
            files = list(storage_path.rglob("*"))
            file_count = len([f for f in files if f.is_file()])
            print(f"📦 {storage}: {file_count} files")

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)

    if project_files == 0 and not indexeddb_dir.exists():
        print("✅ DATABASE IS CLEAN - No projects found")
    elif project_files == 0 and indexeddb_dir.exists():
        print(f"⚠️  PARTIALLY CLEAN - No project files, but IndexedDB exists")
        print(f"   This means cleanup deleted files but not the database")
    else:
        print(f"❌ DATABASE HAS DATA - {project_files} project files found")
        print(f"   Cleanup may not be working correctly")

    print("=" * 70)
    print("\n💡 TIP: Run this script BEFORE and AFTER tests to verify cleanup")
    print("   Before: python count-projects.py > before.txt")
    print("   After:  python count-projects.py > after.txt")
    print("   Compare: diff before.txt after.txt\n")

if __name__ == "__main__":
    count_projects()
