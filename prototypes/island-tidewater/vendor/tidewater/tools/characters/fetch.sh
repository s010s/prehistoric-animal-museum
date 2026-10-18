#!/bin/sh
# fetch.sh <repo path> : one file of the Rocketbox repo (LFS media URL, raw fallback), keeping its repo path
p="$1"; out="$(echo "$p" | sed 's#.*/Assets/##')"; mkdir -p "$(dirname "$out")"
u=$(printf '%s' "$p" | sed 's/ /%20/g')
curl -sfL -o "$out" "https://media.githubusercontent.com/media/microsoft/Microsoft-Rocketbox/master/$u" || curl -sfL -o "$out" "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/$u"
