#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INCLUDE_DEBUG=0
OUTPUT_ZIP=""

print_usage() {
  cat <<'EOF'
Usage:
  scripts/package-extension.sh [--include-debug] [output-zip]

Examples:
  scripts/package-extension.sh
  scripts/package-extension.sh dist/custom-extension.zip
  scripts/package-extension.sh --include-debug
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-debug)
      INCLUDE_DEBUG=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      if [[ -n "${OUTPUT_ZIP}" ]]; then
        echo "Only one output zip path can be provided." >&2
        print_usage >&2
        exit 1
      fi
      OUTPUT_ZIP="$1"
      shift
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to read manifest.json version." >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required to build the extension archive." >&2
  exit 1
fi

VERSION="$(cd "${REPO_ROOT}" && node -p "require('./manifest.json').version")"

if [[ -z "${OUTPUT_ZIP}" ]]; then
  OUTPUT_ZIP="${REPO_ROOT}/dist/AI-Compare-extension-v${VERSION}.zip"
elif [[ "${OUTPUT_ZIP}" != /* ]]; then
  OUTPUT_ZIP="${REPO_ROOT}/${OUTPUT_ZIP}"
fi

OUTPUT_DIR="$(dirname "${OUTPUT_ZIP}")"
mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_ZIP}"

PACKAGE_ITEMS=(
  "manifest.json"
  "background.js"
  "_locales"
  "config"
  "contact"
  "content-scripts"
  "docs/release-notes"
  "favorites"
  "firebase"
  "history"
  "homepage"
  "icons"
  "iframe"
  "options"
  "remote"
  "shared"
  "siteIcons"
)

if [[ "${INCLUDE_DEBUG}" -eq 1 ]]; then
  PACKAGE_ITEMS+=("debug")
fi

(
  cd "${REPO_ROOT}"
  zip -r -X "${OUTPUT_ZIP}" "${PACKAGE_ITEMS[@]}" \
    -x "*.DS_Store" "__MACOSX/*"
)

echo "Created ${OUTPUT_ZIP}"
