import os
import uuid

from fastapi import UploadFile

from app.config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


async def save_upload(file: UploadFile) -> str:
    if file.content_type not in ALLOWED_TYPES:
        raise ValueError(f"File type {file.content_type} not allowed")
    content = await file.read()
    if len(content) > settings.max_upload_size:
        raise ValueError("File too large")
    ext = file.filename.rsplit(".", 1)[-1] if file.filename else "jpg"
    filename = f"{uuid.uuid4()}.{ext}"
    path = os.path.join(settings.upload_dir, filename)
    os.makedirs(settings.upload_dir, exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)
    return f"/uploads/{filename}"
