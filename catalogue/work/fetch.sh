#!/usr/bin/env bash
# fetch.sh <url> <out-path> — download an image with a polite User-Agent.
# Prints the detected type and width; exits 1 if it is not a usable image.
set -euo pipefail
url="$1"; out="$2"
curl -sSL --max-time 40 -A "FAA-Hospet-catalogue/1.0 (grocery app for Hospet; contact via github.com/thanush12200)" "$url" -o "$out"
type=$(file -b --mime-type "$out")
case "$type" in image/jpeg|image/png|image/webp) ;; *) echo "not an image: $type"; rm -f "$out"; exit 1;; esac
w=$(sips -g pixelWidth "$out" 2>/dev/null | awk '/pixelWidth/{print $2}')
echo "$type width=$w $out"
[ "${w:-0}" -ge 300 ] || { echo "too small (<300px)"; exit 1; }
