#!/usr/bin/env bash
set -euo pipefail
"$(dirname "$(dirname "$(readlink -f "$0")")")/install-one.sh" aur nvibrant-bin
