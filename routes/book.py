from fastapi import APIRouter, HTTPException

router = APIRouter()

@router.api_route("/{path:path}", methods=["GET","POST","PUT","DELETE"])
async def deprecated_route(path: str):
    raise HTTPException(status_code=404, detail="Booking routes moved to reserve endpoints")
