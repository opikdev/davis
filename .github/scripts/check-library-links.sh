#!/usr/bin/env bash
# Checks that every download in the library catalog still answers, without
# downloading it: a one-byte range request is enough.
set -euo pipefail

catalog="crates/library/catalog.json"
failed=0

while IFS=$'\t' read -r dataset url; do
  status=$(curl --silent --location --max-time 60 --range 0-0 \
    --user-agent "Davis library check (+https://github.com/opikdev/davis)" \
    --output /dev/null --write-out "%{http_code}" "$url" || echo "000")
  if [[ "$status" == "200" || "$status" == "206" ]]; then
    echo "ok   $status $dataset $url"
  else
    echo "FAIL $status $dataset $url"
    failed=1
  fi
done < <(jq -r '.[] | .id as $id | .steps[] | select(.do == "download") | [$id, .url] | @tsv' "$catalog")

exit "$failed"
