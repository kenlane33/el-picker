#!/usr/bin/env python3
"""
Compare file sizes and names between two directories.
"""

import os
import sys
from pathlib import Path
from collections import defaultdict

def get_file_info(directory):
    """Get file info (name and size) from a directory."""
    files = {}
    try:
        for filename in os.listdir(directory):
            filepath = os.path.join(directory, filename)
            if os.path.isfile(filepath):
                size = os.path.getsize(filepath)
                files[filename] = size
    except Exception as e:
        print(f"Error reading {directory}: {e}", file=sys.stderr)
        return None
    return files

def compare_directories(dir1, dir2):
    """Compare files between two directories."""
    files1 = get_file_info(dir1)
    files2 = get_file_info(dir2)

    if files1 is None or files2 is None:
        return

    names1 = set(files1.keys())
    names2 = set(files2.keys())

    # Find differences
    only_in_dir1 = names1 - names2
    only_in_dir2 = names2 - names1
    common = names1 & names2

    # Check size differences in common files
    size_mismatches = []
    for filename in common:
        if files1[filename] != files2[filename]:
            size_mismatches.append((filename, files1[filename], files2[filename]))

    # Report results
    print("=" * 80)
    print(f"Directory 1: {dir1}")
    print(f"Directory 2: {dir2}")
    print("=" * 80)

    if only_in_dir1:
        print(f"\n❌ Files ONLY in Directory 1 ({len(only_in_dir1)}):")
        for f in sorted(only_in_dir1):
            size = files1[f]
            print(f"  - {f} ({size:,} bytes)")

    if only_in_dir2:
        print(f"\n❌ Files ONLY in Directory 2 ({len(only_in_dir2)}):")
        for f in sorted(only_in_dir2):
            size = files2[f]
            print(f"  - {f} ({size:,} bytes)")

    if size_mismatches:
        print(f"\n⚠️  Size MISMATCHES for common files ({len(size_mismatches)}):")
        for filename, size1, size2 in sorted(size_mismatches):
            diff = abs(size1 - size2)
            print(f"  - {filename}")
            print(f"    Dir1: {size1:,} bytes")
            print(f"    Dir2: {size2:,} bytes")
            print(f"    Diff: {diff:,} bytes")

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY:")
    print(f"  Total files in Directory 1: {len(files1)}")
    print(f"  Total files in Directory 2: {len(files2)}")
    print(f"  Matching files: {len(common)}")
    print(f"  Only in Directory 1: {len(only_in_dir1)}")
    print(f"  Only in Directory 2: {len(only_in_dir2)}")
    print(f"  Size mismatches: {len(size_mismatches)}")

    if not only_in_dir1 and not only_in_dir2 and not size_mismatches:
        print("\n✅ All files match! Directories are identical.")
    else:
        print("\n❌ Directories do NOT match.")

    print("=" * 80)

if __name__ == "__main__":
    dir1 = "/Volumes/TangerineHD/Akaso_Videos/VIDEO"
    dir2 = "/Volumes/AKASO/VIDEO"

    compare_directories(dir1, dir2)
