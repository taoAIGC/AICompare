#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_CONFIG_PATH="${SCRIPT_DIR}/package-extension.config.js"

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

if [[ ! -f "${PACKAGE_CONFIG_PATH}" ]]; then
  echo "Missing package config: ${PACKAGE_CONFIG_PATH}" >&2
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

PACKAGE_ITEMS_OUTPUT="$(
  PACKAGE_INCLUDE_DEBUG="${INCLUDE_DEBUG}" PACKAGE_CONFIG_PATH="${PACKAGE_CONFIG_PATH}" node <<'EOF'
const {
  defaultEntries,
  optionalEntries
} = require(process.env.PACKAGE_CONFIG_PATH);

const includeDebug = process.env.PACKAGE_INCLUDE_DEBUG === '1';
const packageItems = [...defaultEntries];

if (includeDebug) {
  packageItems.push(...(optionalEntries.debug || []));
}

for (const item of packageItems) {
  console.log(item);
}
EOF
)
"

PACKAGE_ITEMS=()
while IFS= read -r packageItem; do
  if [[ -n "${packageItem}" ]]; then
    PACKAGE_ITEMS+=("${packageItem}")
  fi
done <<EOF
${PACKAGE_ITEMS_OUTPUT}
EOF

(
  cd "${REPO_ROOT}"
  zip -r -X "${OUTPUT_ZIP}" "${PACKAGE_ITEMS[@]}" \
    -x "*.DS_Store" "__MACOSX/*"
)

echo "Created ${OUTPUT_ZIP}"
