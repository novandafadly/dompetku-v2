#!/usr/bin/env bash
# Siapkan akses backup WAL-G ke bucket OCI. Dijalankan pemilik di OCI Cloud Shell (sudah login).
# Idempoten: yang sudah ada dilewati. Bucket harus sudah dibuat (Standard, versioning mati).
# Hasil: group + user khusus (hanya customer secret key), policy tanpa izin hapus,
# retention rule 30 hari TIDAK dikunci, satu Customer Secret Key (secret tampil sekali).
set -euo pipefail

REGION=ap-batam-1
BUCKET=dompetku-backup
NAME=dompetku-backup
EMAIL=novandafadly+dkbackup@gmail.com
KEY_NAME=walg-dompetku

T=${OCI_TENANCY:?Jalankan di OCI Cloud Shell}
HOME_REGION=$(oci iam region-subscription list --query 'data[?"is-home-region"]|[0]."region-name"' --raw-output)
NS=$(oci os ns get --region "$REGION" --query data --raw-output)
iam() { oci --region "$HOME_REGION" "$@"; }
first() { "$@" 2>/dev/null | grep -v '^null$' || true; }

echo "Home region: $HOME_REGION, namespace: $NS"

oci os bucket get --region "$REGION" -bn "$BUCKET" --query 'data.{tier:"storage-tier",versioning:versioning}' \
	|| { echo "Bucket $BUCKET tidak ada di $REGION"; exit 1; }

GID=$(first iam iam group list --compartment-id "$T" --name "$NAME" --query 'data[0].id' --raw-output)
if [ -z "$GID" ]; then
	GID=$(iam iam group create --compartment-id "$T" --name "$NAME" \
		--description "DompetKu: akses backup WAL-G" --query data.id --raw-output)
	echo "Group dibuat"
else echo "Group sudah ada"; fi

USER_ID=$(first iam iam user list --compartment-id "$T" --name "$NAME" --query 'data[0].id' --raw-output)
if [ -z "$USER_ID" ]; then
	USER_ID=$(iam iam user create --compartment-id "$T" --name "$NAME" --email "$EMAIL" \
		--description "DompetKu: WAL-G ke bucket $BUCKET, tanpa login Console" --query data.id --raw-output)
	echo "User dibuat"
else echo "User sudah ada"; fi

MEMBER=$(first iam iam group list-users --group-id "$GID" --query "data[?name=='$NAME']|[0].id" --raw-output)
[ -n "$MEMBER" ] || { iam iam group add-user --group-id "$GID" --user-id "$USER_ID" >/dev/null; echo "User masuk group"; }
# Tanpa keanggotaan, policy group tidak berlaku: login S3 diterima tapi semua akses 403.
MEMBER=$(first iam iam group list-users --group-id "$GID" --query "data[?name=='$NAME']|[0].id" --raw-output)
[ -n "$MEMBER" ] || { echo "User belum tercatat di group $NAME"; exit 1; }

iam iam user update-user-capabilities --user-id "$USER_ID" --can-use-console-password false \
	--can-use-api-keys false --can-use-auth-tokens false --can-use-smtp-credentials false \
	--can-use-customer-secret-keys true >/dev/null
echo "Capability: hanya customer secret key"

POL=$(first iam iam policy list --compartment-id "$T" --name "$NAME" --query 'data[0].id' --raw-output)
if [ -z "$POL" ]; then
	iam iam policy create --compartment-id "$T" --name "$NAME" \
		--description "DompetKu: baca/tulis bucket backup tanpa hapus; lifecycle oleh service" \
		--statements "[
\"Allow group $NAME to read buckets in tenancy where target.bucket.name='$BUCKET'\",
\"Allow group $NAME to manage objects in tenancy where all {target.bucket.name='$BUCKET', any {request.permission='OBJECT_CREATE', request.permission='OBJECT_INSPECT', request.permission='OBJECT_READ'}}\",
\"Allow service objectstorage-$REGION to manage object-family in tenancy where target.bucket.name='$BUCKET'\"
]" >/dev/null
	echo "Policy dibuat"
else echo "Policy sudah ada (tidak diubah)"; fi

RR=$(first oci os retention-rule list --region "$REGION" -bn "$BUCKET" \
	--query "data.items[?\"display-name\"=='min-30-hari']|[0].id" --raw-output)
if [ -z "$RR" ]; then
	oci os retention-rule create --region "$REGION" -bn "$BUCKET" --display-name min-30-hari \
		--time-amount 30 --time-unit DAYS >/dev/null
	echo "Retention rule 30 hari dibuat (belum dikunci)"
else echo "Retention rule sudah ada"; fi

KEY=$(first iam iam customer-secret-key list --user-id "$USER_ID" \
	--query "data[?\"display-name\"=='$KEY_NAME']|[0].id" --raw-output)
if [ -z "$KEY" ]; then
	OUT=$(iam iam customer-secret-key create --user-id "$USER_ID" --display-name "$KEY_NAME" \
		--query 'data.{a:id,s:key}' --raw-output)
	echo
	echo "=== SIMPAN KE PASSWORD MANAGER, JANGAN DITEMPEL KE CHAT ==="
	echo "$OUT"
	echo "=== secret tidak bisa dilihat lagi ==="
else echo "Customer secret key $KEY_NAME sudah ada (secret tidak bisa ditampilkan ulang)"; fi

echo
echo "=== Boleh ditempel ke chat ==="
echo "namespace: $NS"
echo "endpoint:  https://$NS.compat.objectstorage.$REGION.oraclecloud.com"
echo "region:    $REGION"
echo "bucket:    $BUCKET"
