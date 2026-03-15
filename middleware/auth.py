from fastapi import Header, HTTPException, Depends, status
from firebase_admin import auth, _apps
from sqlalchemy.orm import Session
from datetime import datetime

from .database import get_db
from .models import User  # Assuming you have a User model defined

async def get_current_user(
    authorization: str = Header(None), 
    db: Session = Depends(get_db)
):
    # 1. Check if Firebase is initialized
    if not _apps:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Server auth is not configured.", "code": "AUTH_NOT_CONFIGURED"}
        )

    # 2. Check for Bearer token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: No token provided"
        )

    token = authorization.split(" ")[1]

    # 3. Verify Token
    try:
        decoded_token = auth.verify_id_token(token)
    except Exception as e:
        print(f"🔥 Token Verification Failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"message": "Unauthorized: Invalid token", "error": str(e)}
        )

    uid = decoded_token.get("uid")
    email = decoded_token.get("email") or f"no-email-{uid}@placeholder.com"

    # 4. Find or Create User in Postgres
    user = db.query(User).filter(User.uid == uid).first()

    if not user:
        print(f"👤 User not found in DB, creating new user for {uid}")
        user = User(
            uid=uid,
            email=email,
            role="user",
            approved=True,
            vehicle_plate="PENDING",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"✨ New user created: {user.email} ({uid})")

    return user

# "Middleware" functions as empty dependencies to match your JS structure
async def require_approved_user(current_user: User = Depends(get_current_user)):
    # Approval requirement removed as per user request
    return current_user

async def require_admin(current_user: User = Depends(get_current_user)):
    # Admin restriction removed as per user request
    return current_user
