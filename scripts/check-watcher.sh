#!/bin/sh
echo '--- watcher processes ---'
for p in /proc/[0-9]*; do
  if [ -r "$p/cmdline" ]; then
    cmd=$(tr '\0' ' ' < "$p/cmdline")
    case "$cmd" in
      *wait-and-test*) echo "$(basename $p) $cmd" ;;
    esac
  fi
done
echo '--- watch log ---'
cat /app/aliexpress-watch.log 2>/dev/null || echo 'no log yet'
