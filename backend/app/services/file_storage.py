import io
import os
import uuid

import boto3
from fastapi import UploadFile
from PIL import Image

from app.config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"}

MAX_IMAGE_DIMENSION = 1920
JPEG_QUALITY = 80


def _get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


def _compress_image(content: bytes) -> tuple[bytes, str]:
    """Resize and compress image to JPEG. Returns (compressed_bytes, content_type)."""
    img = Image.open(io.BytesIO(content))

    # Handle EXIF rotation
    try:
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    # Convert to RGB (handles RGBA, palette, etc.)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    # Resize if too large
    w, h = img.size
    if max(w, h) > MAX_IMAGE_DIMENSION:
        ratio = MAX_IMAGE_DIMENSION / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    # Compress to JPEG
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue(), "image/jpeg"


async def save_upload(file: UploadFile) -> str:
    if file.content_type not in ALLOWED_TYPES:
        raise ValueError(f"File type {file.content_type} not allowed")
    content = await file.read()
    if len(content) > settings.max_upload_size:
        raise ValueError("File too large")

    content_type = file.content_type
    ext = file.filename.rsplit(".", 1)[-1] if file.filename else "jpg"

    # Compress images (not PDFs)
    if content_type and content_type.startswith("image/"):
        content, content_type = _compress_image(content)
        ext = "jpg"

    filename = f"{uuid.uuid4()}.{ext}"

    if settings.r2_bucket_name:
        client = _get_s3_client()
        client.put_object(
            Bucket=settings.r2_bucket_name,
            Key=filename,
            Body=content,
            ContentType=content_type,
        )
        return f"{settings.r2_public_url}/{filename}"

    path = os.path.join(settings.upload_dir, filename)
    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)
    return f"/uploads/{filename}"
