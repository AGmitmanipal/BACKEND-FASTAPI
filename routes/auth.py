from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from ..database import get_db
from ..models import User
from ..auth import get_current_user

router = APIRouter()

# Pydantic model for request validation (ensures clean data)
class ProfileUpdate(BaseModel):
    vehicle_plate: Optional[str] = None

# GET /me - Returns current user
@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

# POST /update-profile
@router.post("/update-profile")
async def update_profile(
    data: ProfileUpdate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        # Update fields if provided
        if data.vehicle_plate:
            current_user.vehicle_plate = data.vehicle_plate
            
        # Commit the changes to PostgreSQL
        db.commit()
        db.refresh(current_user)
        
        return current_user
        
    except Exception as e:
        db.rollback() # Important: Undo changes if database update fails
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server error updating profile"
        )
