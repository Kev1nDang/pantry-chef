"""
Upload validation for photos of groceries (POST /api/pantry/detect).

Photos are recognized by their leading bytes, not by the name or type the browser sends. The web
app shrinks every photo to a JPEG before uploading; HEIC/AVIF straight from a phone are refused.
"""

from fastapi import status

MAX_FILE_BYTES = 5 * 1024 * 1024

# Image formats the detector reads, by their leading bytes. WebP is "RIFF<size>WEBP".
IMAGE_SIGNATURES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
}


class DocumentError(Exception):
    """An upload we can't read, with the HTTP status the API should answer with."""

    def __init__(self, message: str, status_code: int = status.HTTP_400_BAD_REQUEST) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def image_media_type(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    for signature, media_type in IMAGE_SIGNATURES.items():
        if data.startswith(signature):
            return media_type
    return None


def require_image(data: bytes) -> str:
    """Validate an upload that must be a photo; returns its media type."""
    if not data:
        raise DocumentError("That file is empty")
    if len(data) > MAX_FILE_BYTES:
        raise DocumentError(
            f"Photos can be at most {MAX_FILE_BYTES // (1024 * 1024)} MB",
            status.HTTP_413_CONTENT_TOO_LARGE,
        )
    media_type = image_media_type(data)
    if media_type is None:
        raise DocumentError(
            "That isn't a photo; upload a JPEG, PNG, WebP or GIF",
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )
    return media_type
