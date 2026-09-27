#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$backend_dir/.."

command -v gcloud >/dev/null || { echo 'Install the Google Cloud CLI first.' >&2; exit 1; }
command -v curl >/dev/null || { echo 'Install curl first.' >&2; exit 1; }
[[ -f backend/.env.cloudrun ]] || {
  echo 'Copy backend/.env.cloudrun.example to backend/.env.cloudrun and fill in its values.' >&2
  exit 1
}

project="$(gcloud config get-value project 2>/dev/null)"
[[ -n "$project" && "$project" != '(unset)' ]] || {
  echo 'Select the target project with gcloud config set project PROJECT_ID.' >&2
  exit 1
}

# gcloud recognizes dotenv syntax only when the filename ends in .env.
# Keep the temporary copy outside the source upload, private and short-lived.
umask 077
deploy_tmp_dir="$(mktemp -d)"
trap 'rm -f -- "$deploy_tmp_dir/runtime.env"; rmdir -- "$deploy_tmp_dir"' EXIT
cp backend/.env.cloudrun "$deploy_tmp_dir/runtime.env"

# Preserve commas without shell evaluation or secret values in arguments.
gcloud run deploy proofread-api \
  --source backend \
  --region us-east4 \
  --allow-unauthenticated \
  --timeout 3600 \
  --min-instances 1 \
  --project "$project" \
  --env-vars-file "$deploy_tmp_dir/runtime.env" \
  --quiet

service_url="$(gcloud run services describe proofread-api \
  --project "$project" --region us-east4 --format='value(status.url)')"
[[ "$service_url" == https://*.run.app ]] || {
  echo 'Cloud Run did not return a run.app service URL.' >&2
  exit 1
}

for route in config protocols; do
  curl --fail --silent --show-error --retry 5 --retry-delay 2 --max-time 30 \
    "$service_url/$route" --output /dev/null
  echo "GET /$route passed" >&2
done
printf '%s\n' "$service_url"
