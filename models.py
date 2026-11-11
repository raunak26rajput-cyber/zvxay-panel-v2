from datetime import datetime, date
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey, Date
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class KeyValue(Base):
    __tablename__ = "key_values"
    id = Column(Integer, primary_key=True)
    k = Column(String(100), unique=True, nullable=False)
    v = Column(Text, nullable=True)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False, index=True)
    password_hash = Column(Text, nullable=False)
    role = Column(String(20), default="user")
    approved = Column(Boolean, default=False)
    expiry = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    bots = relationship("Bot", back_populates="owner", cascade="all, delete-orphan")

    def is_expired(self):
        if not self.expiry:
            return False
        try:
            return date.today() > self.expiry
        except Exception:
            return False

class Bot(Base):
    __tablename__ = "bots"
    id          = Column(Integer, primary_key=True)
    uid         = Column(String(40), unique=True, nullable=False, index=True)
    filename    = Column(String(255), nullable=False)   # original uploaded filename
    filepath    = Column(Text, nullable=False)           # full path of .py to execute
    main_file   = Column(String(255), nullable=True)    # relative display name of entry point
    bot_dir     = Column(Text, nullable=True)           # extracted zip directory

    owner_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    owner       = relationship("User", back_populates="bots")

    status       = Column(String(30), default="stopped")  # running|stopped|pending|rejected|setup
    pid          = Column(Integer, nullable=True)
    token        = Column(Text, nullable=True)
    auto_restart = Column(Boolean, default=False)
    logpath      = Column(Text, nullable=True)

    restart_count = Column(Integer, default=0)
    started_at    = Column(DateTime, nullable=True)
    req_installed = Column(Boolean, default=False)

    created_at  = Column(DateTime, default=datetime.utcnow)

    def uptime_str(self):
        if not self.started_at or self.status != "running":
            return "-"
        delta = datetime.utcnow() - self.started_at
        h, rem = divmod(int(delta.total_seconds()), 3600)
        m, s   = divmod(rem, 60)
        if h:
            return f"{h}h {m}m {s}s"
        if m:
            return f"{m}m {s}s"
        return f"{s}s"

    def file_size_str(self):
        try:
            p = Path(self.filepath)
            if p.exists():
                size = p.stat().st_size
                if size > 1_048_576:
                    return f"{size/1_048_576:.1f} MB"
                if size > 1024:
                    return f"{size/1024:.1f} KB"
                return f"{size} B"
        except Exception:
            pass
        return "-"

# Make Path available in models
from pathlib import Path
