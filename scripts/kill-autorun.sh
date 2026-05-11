#!/bin/sh
for p in /proc/[0-9]*; do
  if [ -r "$p/cmdline" ]; then
    c=$(tr '\0' ' ' < "$p/cmdline")
    case "$c" in
      *auto-run*|*test-aliexpress*|*wait-and-test*)
        pid=$(basename "$p")
        echo "killing $pid $c"
        kill -9 "$pid" 2>/dev/null
        ;;
    esac
  fi
done
echo done
