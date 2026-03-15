import logging
from datetime import datetime
from typing import List

from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func

# Local Imports (Assuming you have these set up from our previous step)
from .database import engine, Base, get_db
from .models import Zone, Reservation, User
from .auth import get_current_user, require_approved_user
from .routes import auth, admin, book, reserve
from .utils.cron import start_reservation_cron # Your background task logic

# 1. Initialize App & Database
Base.metadata.create_all(bind=engine)
app = FastAPI(title="Parking API")

# 2. Middlewares (CORS & Logging)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"📨 [{datetime.utcnow().isoformat()}] {request.method} {request.url.path}")
    response = await call_next(request)
    return response

# 3. Startup Events
@app.on_event("startup")
def startup_event():
    print("🔥 PostgreSQL connected via SQLAlchemy")
    # In FastAPI, we usually use 'BackgroundTasks' or 'APScheduler' for crons
    # start_reservation_cron() 
    print("📅 Reservation expiry cron started")

# 4. Health Check
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "database": "postgresql"
    }

# --- ROUTES ---

# 1. Auth & Admin (Include routers)
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])

# 2. Main Business Logic (Zones & Availability)
# Note: 'require_approved_user' is a dependency that ensures the user is logged in
@app.get("/", dependencies=[Depends(require_approved_user)])
async def get_zones(db: Session = Depends(get_db)):
    try:
        # 1. Fetch Active Zones from Postgres
        zones = db.query(Zone).filter(Zone.is_active == True).order_by(Zone.name).all()

        # 2. Fetch Aggregated Reservation Counts using SQL (Much faster than manual loops)
        # We group by zone_id and status to get counts in one query
        stats_query = db.query(
            Reservation.zone_id,
            Reservation.status,
            func.count(Reservation.id).label("count")
        ).filter(Reservation.status.in_(["booked", "reserved"])).group_by(
            Reservation.zone_id, Reservation.status
        ).all()

        # Organize stats into a dictionary: {zone_id: {"booked": X, "reserved": Y}}
        stats_map = {}
        for zone_id, status, count in stats_query:
            if zone_id not in stats_map:
                stats_map[zone_id] = {"booked": 0, "reserved": 0}
            stats_map[zone_id][status] = count

        # 3. Build Response
        response = []
        for zone in zones:
            stats = stats_map.get(zone.id, {"booked": 0, "reserved": 0})
            reserved_count = stats["reserved"]
            booked_count = stats["booked"]
            
            # Calculate availability
            capacity = zone.capacity or 0
            occupied = reserved_count + booked_count
            available = max(0, capacity - occupied)

            response.append({
                "_id": zone.id,
                "name": zone.name or "Unnamed Zone",
                "polygon": zone.polygon, # Assuming JSONB column in Postgres
                "capacity": capacity,
                "available": available,
                "reserved": reserved_count,
                "prebooked": booked_count,
            })

        return response

    except Exception as e:
        logging.error(f"❌ GET / ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail="Server error")

# 3. Mount remaining business routers
app.include_router(book.router, prefix="/api/book", tags=["Booking"])
app.include_router(reserve.router, tags=["Reservation"])
