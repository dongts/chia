#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
remote_host="root@chia.dongtran.asia"
output_base="/home/zuzu/.local/share/chia-migration/2026-09-18"
backend_container="chia-backend-1"
database_container="chia-db-1"

usage() {
  echo "Usage: $0 [--host USER@HOST] [--output-dir DIR] [--backend-container NAME] [--database-container NAME]" >&2
}

while (($#)); do
  case "$1" in
    --host)
      remote_host=${2:?missing value for --host}
      shift 2
      ;;
    --output-dir)
      output_base=${2:?missing value for --output-dir}
      shift 2
      ;;
    --backend-container)
      backend_container=${2:?missing value for --backend-container}
      shift 2
      ;;
    --database-container)
      database_container=${2:?missing value for --database-container}
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ $remote_host == -* || ! $backend_container =~ ^[A-Za-z0-9_.-]+$ || ! $database_container =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "Invalid host or container name" >&2
  exit 2
fi

for command_name in ssh python3 sha256sum tar; do
  command -v "$command_name" >/dev/null || {
    echo "Required command not found: $command_name" >&2
    exit 1
  }
done

mkdir -p -- "$output_base"
chmod 700 -- "$output_base"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot_name="chia-production-${timestamp}"
staging_dir="$output_base/.${snapshot_name}.incomplete"
final_dir="$output_base/$snapshot_name"

if [[ -e $staging_dir || -e $final_dir ]]; then
  echo "Snapshot destination already exists: $snapshot_name" >&2
  exit 1
fi

mkdir -m 700 -- "$staging_dir"

on_error() {
  echo "Snapshot failed; private partial artifacts remain in: $staging_dir" >&2
}
trap on_error ERR

ssh_options=(-o BatchMode=yes -o ConnectTimeout=15)

echo "Streaming a consistent PostgreSQL custom-format dump..." >&2
ssh "${ssh_options[@]}" "$remote_host" \
  "docker exec '$database_container' sh -c 'export PGOPTIONS=\"-c default_transaction_read_only=on\"; exec pg_dump --username=\"\$POSTGRES_USER\" --dbname=\"\$POSTGRES_DB\" --format=custom --compress=9 --no-owner --no-privileges --serializable-deferrable'" \
  >"$staging_dir/database.dump"

echo "Streaming the read-only JSON data, schema, and balance snapshot..." >&2
ssh "${ssh_options[@]}" "$remote_host" \
  "docker exec -i '$backend_container' python - export" \
  <"$script_dir/snapshot_export.py" \
  >"$staging_dir/data.json"

echo "Streaming the uploads archive..." >&2
ssh "${ssh_options[@]}" "$remote_host" \
  "docker exec '$backend_container' tar --create --file=- --directory=/data/uploads ." \
  >"$staging_dir/uploads.tar"

chmod 600 -- "$staging_dir/database.dump" "$staging_dir/data.json" "$staging_dir/uploads.tar"

echo "Validating artifacts and building the manifest..." >&2
ssh "${ssh_options[@]}" "$remote_host" \
  "docker exec -i '$database_container' pg_restore --list" \
  <"$staging_dir/database.dump" \
  >/dev/null
tar --list --file="$staging_dir/uploads.tar" >/dev/null
python3 "$script_dir/snapshot_export.py" manifest \
  --root "$staging_dir" \
  --output "$staging_dir/manifest.json" \
  database.dump data.json uploads.tar

(
  cd -- "$staging_dir"
  sha256sum database.dump data.json uploads.tar manifest.json >SHA256SUMS
  sha256sum --check SHA256SUMS >/dev/null
)
chmod 600 -- "$staging_dir/manifest.json" "$staging_dir/SHA256SUMS"

mv -- "$staging_dir" "$final_dir"
trap - ERR

echo "Snapshot complete: $final_dir" >&2

