#!/usr/bin/env bash
# Lifecycle rule bucket backup DompetKu. Dijalankan pemilik di OCI Cloud Shell. Menimpa policy lifecycle bucket.
# WAL-G tidak pernah menghapus; pembersihan hanya lewat aturan ini (selalu lebih lama dari retention 30 hari).
set -euo pipefail
REGION=ap-batam-1
BUCKET=dompetku-backup

oci os object-lifecycle-policy put --region "$REGION" --bucket-name "$BUCKET" --force --items '[
  {"name":"harian-35-hari","action":"DELETE","timeAmount":35,"timeUnit":"DAYS","isEnabled":true,
   "target":"objects","objectNameFilter":{"inclusionPrefixes":["pg17/"]}},
  {"name":"bulanan-400-hari","action":"DELETE","timeAmount":400,"timeUnit":"DAYS","isEnabled":true,
   "target":"objects","objectNameFilter":{"inclusionPrefixes":["pg17-monthly/"]}},
  {"name":"uji-31-hari","action":"DELETE","timeAmount":31,"timeUnit":"DAYS","isEnabled":true,
   "target":"objects","objectNameFilter":{"inclusionPrefixes":["_test/"]}},
  {"name":"multipart-gagal","action":"ABORT","timeAmount":2,"timeUnit":"DAYS","isEnabled":true,
   "target":"multipart-uploads"}
]' --query 'data.items[].{nama:name,hari:"time-amount",aktif:"is-enabled"}'
