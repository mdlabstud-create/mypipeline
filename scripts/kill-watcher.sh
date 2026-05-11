#!/bin/sh
for p in /proc/[0-9]*; do
  if [ -r "$p/cmdline" ]; then
    c=$(tr '\0' ' ' < "$p/cmdline")
    case "$c" in
      *test-aliexpress*|*wait-and-test*|*tsx*test-aliexpress*)
        pid=$(basename "$p")
        echo "killing $pid $c"
        kill -9 "$pid" 2>/dev/null
        ;;
    esac
  fi
done
echo done
