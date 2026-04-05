import os
import uuid

import boto3
from fastapi import UploadFile

from app.config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"}


def _get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


async def save_upload(file: UploadFile) -> str:
    if file.content_type not in ALLOWED_TYPES:
        raise ValueError(f"File type {file.content_type} not allowed")
    content = await file.read()
    if len(content) > settings.max_upload_size:
        raise ValueError("File too large")
    ext = file.filename.rsplit(".", 1)[-1] if file.filename else "jpg"
    filename = f"{uuid.uuid4()}.{ext}"

    if settings.r2_bucket_name:
        client = _get_s3_client()
        client.put_object(
            Bucket=settings.r2_bucket_name,
            Key=filename,
            Body=content,
            ContentType=file.content_type,
        )
        return f"{settings.r2_public_url}/{filename}"

    path = os.path.join(settings.upload_dir, filename)
    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)
    return f"/uploads/{filename}"
